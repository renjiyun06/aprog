// control-plane 运行配置。从环境变量读（占位默认值便于本地起）。
// provider 各自的细配置（imageId / driver bundle 路径 / apiKey）由 buildSandboxGateway 直接读环境变量，
// 这里只保留「选哪个 provider」这一选择器——多供应商的形态体现在这个可扩展的选择上。

import type { GitHubRepoConfig } from './process/repo-gateway.ts';
import type { GithubAppConfig } from './credentials/issuer.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 沙箱 provider 选择。多供应商是设计形态；当前唯一落地是 PPIO（E2B 同构托管），外加 mock 兜底。
 *  AgentBay 暂时下线，需要时在此加回 'agentbay' 并补对应分支。 */
export type SandboxProviderKind = 'ppio' | 'mock';

export interface Config {
  /** API 监听端口。 */
  port: number;
  /** 进程目录、快照、控制平面库的统一根。默认 ~/.aprog（对齐进程目录 ~/.aprog/&lt;pid&gt;/ 约定，
   *  本机开发免 root；生产用 APROG_DATA_DIR 覆盖到 /var/lib/aprog 等）。 */
  dataDir: string;
  /** driver 拨回的控制平面地址（注入沙箱环境，driver 据此回连）。https:// 即走 TLS 回拨。 */
  controlPlaneUrl: string;
  /** 回拨入口 TLS 的 CA 证书路径（PEM，公开非密）。配了它则把证书注入沙箱、driver 经 NODE_EXTRA_CA_CERTS
   *  信任自签证书（配合 https controlPlaneUrl）。未设 = 明文 http 回拨（开发态/内网）。 */
  controlPlaneCaCertPath?: string;
  /** 注入沙箱、供引擎(Claude Code→GLM)鉴权的密钥（= 沙箱内 ANTHROPIC_AUTH_TOKEN）。
   *  非密钥路由配置（base_url/模型映射）已烘进镜像 settings.json，唯独这把 token 运行时注入、不烘入快照。
   *  未设则不注入（沙箱里的 claude 会缺鉴权）。 */
  engineAuthToken?: string;
  /** 前端基址：邮件里的验证链接指向它（<url>/?token=…）。 */
  webUrl: string;
  /** SMTP 发信配置；未设则回退到 console 打印（开发态）。 */
  smtp?: SmtpConfig;
  /** 沙箱提供方选择。未显式设 APROG_SANDBOX_PROVIDER 时：有 PPIO_API_KEY 走 ppio，否则 mock。 */
  sandbox: {
    provider: SandboxProviderKind;
  };
  /** 进程仓库提供方（GitHub）。未配 GITHUB_TOKEN 则为 undefined（→ MockRepoGateway，造假 URL）。 */
  github?: GitHubRepoConfig;
  /** 凭证签发主密钥（GitHub App）。配齐 APROG_GH_APP_ID + 私钥则启用 issuer：给 driver 签 per-process
   *  仓库短票 / 程序包拉取凭证（见 credentials/issuer.ts）。未配则不签票（driver 占位阶段不消费）。 */
  githubApp?: GithubAppConfig;
  /** 程序包 registry 基址（含命名空间），如 ghcr.io/kybera。driver 据此拉 OCI 程序闭包。 */
  registry: string;
  /** 沙箱出网代理（沙箱在国内，访问被墙的 github/ghcr 等需经代理）。配了 SS 节点则注入沙箱：
   *  driver 用这把 SS 起本地 v2ray http 代理，并令 node/git/引擎经它出网；NO_PROXY 放行 CP 回拨 +
   *  bypass 列表（默认含 GLM 国内端点 open.bigmodel.cn，避免国内→美国绕路）。未配则沙箱直连出网。 */
  proxy?: ProxyConfig;
}

/** 沙箱出网代理配置。 */
export interface ProxyConfig {
  /** shadowsocks 上游节点（密钥）——注入 driver，起 v2ray。 */
  ss: { server: string; port: number; password: string; method: string };
  /** 不走代理的主机（国内/内网），追加进 NO_PROXY。CP 回拨主机由 controlPlaneUrl 自动放行，此列表额外追加
   *  （默认 GLM 端点）。 */
  bypass: string[];
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true=隐式 TLS（一般 465）；false=STARTTLS（一般 587）。 */
  secure: boolean;
  user: string;
  pass: string;
  /** 发件人（可含显示名，如 `aprog <no-reply@x.com>`）；缺省用 user。 */
  from: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APROG_PORT ?? 8099),
    dataDir: process.env.APROG_DATA_DIR ?? join(homedir(), '.aprog'),
    controlPlaneUrl: process.env.APROG_CONTROL_PLANE_URL ?? 'https://localhost:8099',
    controlPlaneCaCertPath: process.env.APROG_CP_CA_CERT || undefined,
    engineAuthToken: process.env.APROG_ENGINE_AUTH_TOKEN || undefined,
    webUrl: process.env.APROG_WEB_URL ?? 'https://localhost:5174',
    smtp: loadSmtp(),
    github: loadGithub(),
    githubApp: loadGithubApp(),
    registry: process.env.APROG_REGISTRY ?? 'ghcr.io/kybera',
    proxy: loadProxy(),
    sandbox: {
      provider: resolveSandboxProvider(),
    },
  };
}

/** 从环境变量读沙箱出网代理（SS 节点）。未配 APROG_PROXY_SS_SERVER/PASSWORD 则返回 undefined（沙箱直连出网）。
 *  APROG_PROXY_BYPASS：逗号分隔的额外直连主机，默认 open.bigmodel.cn（GLM 国内端点，避免绕美国代理增延迟）。 */
function loadProxy(): ProxyConfig | undefined {
  const server = process.env.APROG_PROXY_SS_SERVER;
  const password = process.env.APROG_PROXY_SS_PASSWORD;
  if (!server || !password) return undefined;
  return {
    ss: {
      server,
      port: Number(process.env.APROG_PROXY_SS_PORT ?? 0),
      password,
      method: process.env.APROG_PROXY_SS_METHOD ?? 'aes-256-gcm',
    },
    bypass: (process.env.APROG_PROXY_BYPASS ?? 'open.bigmodel.cn')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

/** 凭证签发主密钥（GitHub App）。需 APROG_GH_APP_ID + APROG_GH_APP_KEY_PATH（PKCS#1/PKCS#8 PEM 路径）。
 *  owner 复用 GITHUB_OWNER。任一缺失则返回 undefined（不启用 issuer）。 */
function loadGithubApp(): GithubAppConfig | undefined {
  const appId = process.env.APROG_GH_APP_ID;
  const privateKeyPath = process.env.APROG_GH_APP_KEY_PATH;
  const owner = process.env.GITHUB_OWNER;
  if (!appId || !privateKeyPath || !owner) return undefined;
  return {
    appId,
    privateKeyPath,
    owner,
    installationId: process.env.APROG_GH_APP_INSTALLATION_ID || undefined,
  };
}

/** 选 provider：显式 APROG_SANDBOX_PROVIDER 优先；未设时有 PPIO_API_KEY 走 ppio，否则 mock。 */
function resolveSandboxProvider(): SandboxProviderKind {
  const want = process.env.APROG_SANDBOX_PROVIDER;
  if (want === 'ppio' || want === 'mock') return want;
  return process.env.PPIO_API_KEY ? 'ppio' : 'mock';
}

/** 从环境变量读 GitHub 仓库配置；未设 GITHUB_TOKEN 则返回 undefined（回退 MockRepoGateway）。
 *  GITHUB_OWNER：org 名或用户名；GITHUB_OWNER_IS_ORG：是否组织（默认 true）。 */
function loadGithub(): GitHubRepoConfig | undefined {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token === '') return undefined;
  return {
    token,
    owner: process.env.GITHUB_OWNER ?? '',
    ownerIsOrg: (process.env.GITHUB_OWNER_IS_ORG ?? 'true') === 'true',
  };
}

/** 从环境变量读 SMTP；未设 APROG_SMTP_HOST 则返回 undefined（回退 console）。 */
function loadSmtp(): SmtpConfig | undefined {
  const host = process.env.APROG_SMTP_HOST;
  if (host === undefined || host === '') return undefined;
  const user = process.env.APROG_SMTP_USER ?? '';
  return {
    host,
    port: Number(process.env.APROG_SMTP_PORT ?? 465),
    secure: (process.env.APROG_SMTP_SECURE ?? 'true') === 'true',
    user,
    pass: process.env.APROG_SMTP_PASS ?? '',
    from: process.env.APROG_SMTP_FROM ?? user,
  };
}
