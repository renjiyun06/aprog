// 凭证签发（issuer）—— CP 的主密钥金库 + 短票工厂。
//
// 与 auth/(终端用户登录)严格分开:两者是不同信任域(用户会话 vs 沙箱凭证),混用是类别错误。
//
// 主密钥:GitHub App 私钥(长寿,**永不出 CP**)。对沙箱只发一种短命、窄权的票:
//   · mintRepoToken(repo)    仅「该一个进程仓」contents 读写的 installation token(~1h) —— driver clone/push 进程态
//
// 为什么必须是 GitHub App、而非 PAT:PAT 的权限是账号级(所有仓),无法按需窄化到「仅这一个进程仓」;
// 只有 App 的 installation token 能用 API 现签、按仓按权限窄化、短 TTL。
//
// 程序包(GHCR)不在此发票:程序包是【公有】共享基础设施,拉取链路上无 per-user 秘密,driver 匿名拉、按 digest
// 校验完整性即可——故无 mintPullToken。(实测:用户账号名下的私有 GHCR 包,App installation token 也读不动 →
// 403;若将来要私有,须把包迁到 org 名下再用 App 短票。)即「公有代码 + 私有数据」。
//
// 下发纪律:经 bindToken 闸门确认沙箱身份后,由 driver-channel 的 seedFor 调本模块、把票塞进 Seed;
// 沙箱不留长期凭证,大块字节(OCI blob / git objects)由 driver 直连 GitHub/GHCR 拉,不走通道。

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** 进程态 git 仓库的短票(仅该仓 contents 读写,~1h)。 */
export interface RepoCredential {
  /** 带凭证的 clone URL:https://x-access-token:<token>@github.com/<owner>/<repo>.git */
  url: string;
  token: string;
  /** 过期时刻(ISO)。 */
  expiresAt: string;
}

export interface Issuer {
  /** 为某进程仓签一张「仅其可 contents 读写」的短票。repo = 仓名(不含 owner)。 */
  mintRepoToken(repo: string): Promise<RepoCredential>;
}

export interface GithubAppConfig {
  appId: string;
  privateKeyPath: string;
  /** 仓库属主(= config.github.owner),用于定位 installation 与拼 clone URL。 */
  owner: string;
  /** 安装 id;不给则首次用 App JWT 自动发现并缓存。 */
  installationId?: string;
}

const API = 'https://api.github.com';
const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');

/** 用 GitHub App 私钥现签 per-process 短票的 issuer。 */
export class GithubAppIssuer implements Issuer {
  private readonly pem: string;
  private installationId: string | undefined;

  constructor(private readonly cfg: GithubAppConfig) {
    this.pem = readFileSync(cfg.privateKeyPath, 'utf8');
    this.installationId = cfg.installationId;
  }

  /** App JWT(RS256,~9 分钟):iss=appId,用 App 私钥签。node:crypto 直接吃 PKCS#1 PEM,无需额外库。 */
  private appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: this.cfg.appId }));
    const signingInput = `${header}.${payload}`;
    const sig = createSign('RSA-SHA256').update(signingInput).sign(this.pem);
    return `${signingInput}.${b64url(sig)}`;
  }

  private async ghApp<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.appJwt()}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'aprog-control-plane',
        // 带 body 的请求显式声明 JSON，否则 GitHub 可能忽略 body（→ 退化成全仓票，窄化失效）。
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub App API ${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async getInstallationId(): Promise<string> {
    if (this.installationId !== undefined) return this.installationId;
    const insts = await this.ghApp<{ id: number; account: { login: string } | null }[]>('/app/installations');
    const mine = insts.find((i) => i.account?.login?.toLowerCase() === this.cfg.owner.toLowerCase()) ?? insts[0];
    if (mine === undefined) throw new Error('GitHub App 未在任何账号安装');
    this.installationId = String(mine.id);
    return this.installationId;
  }

  async mintRepoToken(repo: string): Promise<RepoCredential> {
    const instId = await this.getInstallationId();
    // installation token 限定到「这一个仓」+ contents 读写(App 已授权范围内的子集)。TTL 由 GitHub 固定 ~1h。
    const r = await this.ghApp<{ token: string; expires_at: string }>(
      `/app/installations/${instId}/access_tokens`,
      { method: 'POST', body: JSON.stringify({ repositories: [repo], permissions: { contents: 'write' } }) },
    );
    return {
      url: `https://x-access-token:${r.token}@github.com/${this.cfg.owner}/${repo}.git`,
      token: r.token,
      expiresAt: r.expires_at,
    };
  }
}
