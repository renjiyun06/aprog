// driver 侧 OCI 程序包拉取——spawn 期「轻」那半（解析见 tools/publish：闭包已被 publish 拍平钉死）。
//
// 沙箱 base 镜像【没有 oras】（只有 git/curl/node/tar），故这里直接走 OCI Distribution v2 的 HTTP：
//   1) GET 本程序 manifest（<registry>/<program.id>:<version>）→ 取 config digest
//   2) GET config blob（= lockfile，media type vnd.aprog.program.manifest）→ 取 closure 列表
//   3) 逐闭包成员：去各自包仓 <registry>/<成员名> 按 digest 拉「层」blob → sha256 校验 → untar 到 <procDir>/<target>
// 分开布局：成员的层各在自己包仓，driver 按 lockfile 的 digest 跨仓取（确定性打包保证跨仓 digest 一致）。
//
// 程序包【公有】→ 匿名拉：走标准 401 + WWW-Authenticate 挑战流程（GHCR 即便公有也先换一张匿名 pull token），
// 故 ghcr.io / Docker Hub / 本地 registry:2 一套代码通吃。无需 CP 下发任何拉取凭证。
// （若将来把包迁 org 私有，再在 token 端点加 Basic 凭证即可——当前不预设。）

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sh } from './exec.ts';

/** publish 产物的 media type（见 tools/publish/src/publish.ts）。 */
const LAYER_MT = 'application/vnd.aprog.skill.layer.v1.tar+gzip';
/** manifest 拉取的 Accept：oras push 默认产 OCI image manifest；带上 docker v2 兜底。 */
const MANIFEST_ACCEPT =
  'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

/** config blob（lockfile）结构——只取 driver 拉取要用的字段（见 publish 的 config 写法）。 */
interface Lockfile {
  name: string;
  version: string;
  closure: { name: string; version: string; target: string; layer: string }[];
}

/** 把 registry 基址拆成 host + 命名空间。`ghcr.io/renjiyun06` → { host:'ghcr.io', ns:'renjiyun06' }。 */
export function splitRegistry(registry: string): { host: string; ns: string } {
  const i = registry.indexOf('/');
  return i === -1 ? { host: registry, ns: '' } : { host: registry.slice(0, i), ns: registry.slice(i + 1) };
}

/** 解析 401 的 WWW-Authenticate 挑战头：Bearer realm="…",service="…",scope="…"。 */
export function parseChallenge(header: string | null): { realm: string; service?: string; scope?: string } | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.*)$/i.exec(header.trim());
  if (!m) return undefined;
  const out: Record<string, string> = {};
  for (const part of m[1]!.matchAll(/(\w+)="([^"]*)"/g)) out[part[1]!] = part[2]!;
  if (!out.realm) return undefined;
  return { realm: out.realm, service: out.service, scope: out.scope };
}

/** 极简 OCI 匿名拉取客户端：按 repo 缓存 bearer，自动跑 401 → token 端点换匿名票 → 重试。 */
export class OciClient {
  private readonly bearers = new Map<string, string>();
  private readonly scheme: string;

  constructor(private readonly host: string) {
    this.scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https';
  }

  /** GET /v2/<repo>/<path>；首发带已缓存 bearer，遇 401 则按挑战换票后重试一次。 */
  async get(repo: string, path: string, accept: string): Promise<Response> {
    const url = `${this.scheme}://${this.host}/v2/${repo}/${path}`;
    const cached = this.bearers.get(repo);
    let res = await fetch(url, { headers: { accept, ...(cached ? { authorization: `Bearer ${cached}` } : {}) } });
    if (res.status === 401 && cached === undefined) {
      const bearer = await this.bearerFor(repo, res.headers.get('www-authenticate'));
      if (bearer !== undefined) {
        this.bearers.set(repo, bearer);
        res = await fetch(url, { headers: { accept, authorization: `Bearer ${bearer}` } });
      }
    }
    return res;
  }

  /** 据挑战头去 token 端点换匿名 bearer（公有包无需凭证）。 */
  private async bearerFor(repo: string, challenge: string | null): Promise<string | undefined> {
    const ch = parseChallenge(challenge);
    const realm = ch?.realm ?? `${this.scheme}://${this.host}/token`;
    const u = new URL(realm);
    if (ch?.service) u.searchParams.set('service', ch.service);
    u.searchParams.set('scope', ch?.scope ?? `repository:${repo}:pull`);
    const res = await fetch(u);
    if (!res.ok) return undefined;
    const j = (await res.json()) as { token?: string; access_token?: string };
    return j.token ?? j.access_token;
  }
}

/**
 * 拉取程序闭包并铺设到进程目录。
 * @returns 落地的闭包成员（名@版本 → target）。
 */
export async function pullProgram(opts: {
  /** registry 基址（含命名空间），由 CP 经 Seed.registry 下发，如 ghcr.io/renjiyun06。 */
  registry: string;
  program: { id: string; version: string | null };
  /** 落地根：闭包 target（skills/<名>）相对它解开。driver 用 ~/.claude（→ ~/.claude/skills/<名>）。 */
  installRoot: string;
}): Promise<{ name: string; version: string; target: string }[]> {
  const { registry, program, installRoot } = opts;
  if (!program.version) throw new Error(`程序 ${program.id} 版本缺失，无法定位 OCI 程序包`);
  const { host, ns } = splitRegistry(registry);
  const client = new OciClient(host);
  const repoOf = (name: string): string => (ns ? `${ns}/${name}` : name);

  // 1) 本程序 manifest → config digest。
  const rootRepo = repoOf(program.id);
  const mres = await client.get(rootRepo, `manifests/${program.version}`, MANIFEST_ACCEPT);
  if (!mres.ok) throw new Error(`拉 manifest ${rootRepo}:${program.version} → ${mres.status} ${await safeText(mres)}`);
  const manifest = (await mres.json()) as { config?: { digest?: string } };
  const configDigest = manifest.config?.digest;
  if (!configDigest) throw new Error(`${rootRepo} manifest 无 config.digest`);

  // 2) config blob（lockfile）→ 闭包。
  const cres = await client.get(rootRepo, `blobs/${configDigest}`, '*/*');
  if (!cres.ok) throw new Error(`拉 config blob ${rootRepo}@${configDigest} → ${cres.status}`);
  const lockfile = (await cres.json()) as Lockfile;
  if (!Array.isArray(lockfile.closure) || lockfile.closure.length === 0) {
    throw new Error(`${rootRepo} lockfile 闭包为空`);
  }
  console.log(`[driver] OCI 闭包(${lockfile.closure.length})：${lockfile.closure.map((c) => `${c.name}@${c.version}`).join(', ')}`);

  // 3) 逐成员：去各自包仓按 digest 拉层 → 校验 → untar 到 procDir/target。
  for (const m of lockfile.closure) {
    const memRepo = repoOf(m.name);
    const bres = await client.get(memRepo, `blobs/${m.layer}`, LAYER_MT);
    if (!bres.ok) throw new Error(`拉层 ${memRepo}@${m.layer} → ${bres.status} ${await safeText(bres)}`);
    const buf = Buffer.from(await bres.arrayBuffer());
    const got = `sha256:${createHash('sha256').update(buf).digest('hex')}`;
    if (got !== m.layer) throw new Error(`层 digest 不符 ${m.name}@${m.version}：期望 ${m.layer} 实得 ${got}`);
    const dest = join(installRoot, m.target);
    await mkdir(dest, { recursive: true });
    const tmp = join(tmpdir(), `aprog-layer-${m.name}-${m.version}.tgz`);
    await writeFile(tmp, buf);
    try {
      await sh('tar', ['-xzf', tmp, '-C', dest]);
    } finally {
      await rm(tmp, { force: true });
    }
    console.log(`[driver] 程序层就位 ${m.name}@${m.version} → ${m.target}（${buf.length} 字节）`);
  }
  return lockfile.closure.map((c) => ({ name: c.name, version: c.version, target: c.target }));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
