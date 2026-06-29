// 北面 HTTP API 的「组装根」：起 Bun.serve、建路由表、mount 各 route 模块、统一分发。
// 它故意很薄——只把请求路由到对应处理器。业务逻辑住在 deps 指向的子系统里（见 context.ts、
// docs/api-impl.html）。命令走 REST，事件流走 SSE（api/sse.ts），二者挂在同一个 server。

import { readFileSync } from 'node:fs';
import type { Config, ProxyConfig } from '../config.ts';
import type { Deps } from './context.ts';
import { Router } from './router.ts';
import { toErrorResponse, notFound } from './errors.ts';
import { openDb } from '../db/index.ts';
import { UserStore } from '../auth/users.ts';
import { TokenStore } from '../auth/tokens.ts';
import { CodeStore } from '../auth/codes.ts';
import { ConsoleEmailSender, SmtpEmailSender } from '../auth/email.ts';
import { ProgramCatalog } from '../catalog/programs.ts';
import { InstallStore } from '../catalog/installs.ts';
import { ProcessManager, type ProcessRecord } from '../process/manager.ts';
import { LifecycleHub } from '../process/lifecycle.ts';
import { GithubAppIssuer, type Issuer, type RepoCredential } from '../credentials/issuer.ts';
import { ProviderSandboxGateway, MockSandboxGateway, type SandboxGateway } from '../process/sandbox-gateway.ts';
import { DriverRegistry } from '../driver-channel/registry.ts';
import { DriverChannelServer } from '../driver-channel/channel.ts';
import { MemoryStreamStore } from '../stream/store.ts';
import { MemoryStreamHub } from '../stream/hub.ts';
import { PPIOProvider, type ImageRef, type Resources, type SandboxProvider } from '@aprog/sandbox';
import { GitHubRepoGateway, MockRepoGateway } from '../process/repo-gateway.ts';
import * as auth from './routes/auth.ts';
import * as programs from './routes/programs.ts';
import * as installations from './routes/installations.ts';
import * as proc from './routes/proc.ts';
import * as shares from './routes/shares.ts';
import * as notifications from './routes/notifications.ts';
import { mountSse } from './sse.ts';

export function startApi(config: Config): void {
  const db = openDb(config.dataDir);
  const users = new UserStore(db);
  const tokens = new TokenStore(db);
  const codes = new CodeStore(db);
  const email = config.smtp
    ? new SmtpEmailSender(config.smtp, config.webUrl)
    : new ConsoleEmailSender(config.webUrl);
  console.log(`[control-plane] 邮件发送：${config.smtp ? `SMTP ${config.smtp.host}` : 'console（开发态）'}`);
  const catalog = new ProgramCatalog(db); // 程序目录只读查询；DB 为权威源（发布时显式登记，无自动 seed）
  const installs = new InstallStore(db);
  // 进程编排：PCB 走 DB；沙箱动作经网关收口。
  // 进程仓库：配了 GITHUB_TOKEN 就真在 GitHub 建私有库，否则 mock（造假 clone URL）。
  const repos = config.github ? new GitHubRepoGateway(config.github) : new MockRepoGateway();
  // driver 握手登记簿：网关 create 时登记 bindToken，driver 拨入时认领（driver-channel/channel.ts）。
  const drivers = new DriverRegistry();
  // 进程生命周期扇出：状态变更（waking/running/…）广播给该用户的 SSE 订阅（异步唤醒 running 回流）。
  const lifecycle = new LifecycleHub();
  // 事件流中枢：driver 上行的引擎事件 → store 盖全局 seq + 落库 → hub 扇出给 /proc/:pid/stream 的 SSE 订阅。
  const store = new MemoryStreamStore();
  const hub = new MemoryStreamHub();
  // 沙箱网关：按 config.sandbox.provider 选——ppio 接真实 PPIO（注入 bindToken + 控制平面地址 + 引擎鉴权），否则 mock。
  const sandbox = buildSandboxGateway(config, drivers);
  // 进程编排：PCB 走 DB；沙箱动作经网关收口；状态变更经 lifecycle.publish 扇出。
  const procs = new ProcessManager(db, sandbox, repos, (rec) => lifecycle.publish(rec));
  // 凭证签发主密钥（GitHub App）：给 driver 现签 per-process 短票。未配则不签票（driver 占位阶段不消费）。
  const issuer: Issuer | undefined = config.githubApp ? new GithubAppIssuer(config.githubApp) : undefined;
  console.log(
    issuer
      ? `[control-plane] 凭证签发：GitHub App（appId=${config.githubApp!.appId}，registry=${config.registry}）`
      : '[control-plane] 凭证签发：未配 GitHub App（不签票）',
  );
  // 为某进程现签仓库短票（Seed 首发 + RenewRepo 续签共用）。无 issuer / 无 repoUrl / 签票失败 → undefined。
  // 仓名从 repoUrl 末段取（RepoGateway 约定 aprog-proc-<pid>）。bindToken 已在握手验过，此刻才现签（防冒认闸门）。
  const mintRepoCred = async (rec: ProcessRecord): Promise<RepoCredential | undefined> => {
    if (issuer === undefined || rec.repoUrl === null) return undefined;
    const repo = rec.repoUrl.replace(/\.git$/, '').split('/').pop()!;
    return issuer.mintRepoToken(repo).catch((e: unknown) => {
      console.warn(`[seed] mintRepoToken(${repo}) 失败:`, e);
      return undefined;
    });
  };
  // driver 通道服务（南面 WS）：握手 + 下发 Seed（PCB + issuer 现签的短票）+ 收 Ready 翻 running + 应 RenewRepo 续签。
  const driverChannel = new DriverChannelServer(
    drivers,
    async (pid) => {
      const rec = procs.get(pid);
      if (rec === undefined) return undefined;
      // registry 始终下发（driver 据此匿名拉公有程序包）；repoCredential 仅在配了 issuer + 有 repoUrl 时现签。
      return {
        pid: String(pid),
        program: { id: rec.programId, version: rec.programVersion },
        registry: config.registry,
        repoUrl: rec.repoUrl,
        mode: 'restore' as const,
        repoCredential: await mintRepoCred(rec),
      };
    },
    (pid) => {
      procs.markReady(pid);
    },
    // RenewRepo：driver 临过期前求新票 → 据连接绑定的 pid 重签（与 Seed 首发同一签发路径）。
    async (pid) => {
      const rec = procs.get(pid);
      return rec === undefined ? undefined : mintRepoCred(rec);
    },
    // 引擎事件上行：append 同步盖 seq（保序）→ then 微任务 publish 扇出（FIFO，顺序保持）。
    (pid, event) => {
      void store.append(pid, event).then((stamped) => hub.publish(pid, stamped));
    },
  );
  console.log(
    `[control-plane] 进程仓库：${config.github ? `GitHub（owner=${config.github.owner}）` : 'mock（未配 GITHUB_TOKEN）'}`,
  );
  void seedAdmin(users);

  const deps: Deps = {
    users,
    tokens,
    codes,
    email,
    catalog,
    installs,
    procs,
    drivers,
    lifecycle,
    store,
    hub,
    channelFor: (pid) => driverChannel.connectionFor(pid),
  };

  const router = new Router();
  // SSE 先注册：账号级 /proc/stream 与 /proc/:pid 同为 2 段，路由首个匹配胜出——静态路由须先于参数路由。
  mountSse(router);
  auth.mount(router);
  programs.mount(router);
  installations.mount(router);
  proc.mount(router);
  shares.mount(router);
  notifications.mount(router);

  Bun.serve({
    port: config.port,
    // SSE 事件流 / driver WS 都是长连接，必须关掉 Bun 默认的 10s 空闲超时（否则撑不到心跳就被掐断，
    // 生命周期 waking→running 推送与 harness 事件流都会断）。0 = 禁用空闲超时。
    idleTimeout: 0,
    fetch(req, server): Response | Promise<Response> | undefined {
      const url = new URL(req.url);
      // 南面：driver WS 升级（先于北面 REST 路由判定）。
      if (driverChannel.matches(req.method, url.pathname)) {
        if (server.upgrade(req, { data: driverChannel.newSessionData() })) return undefined;
        return new Response('WebSocket upgrade 失败', { status: 400 });
      }
      // 北面：REST。
      const hit = router.match(req.method, stripVersion(url.pathname));
      if (hit === undefined) return toErrorResponse(notFound(`无此端点 ${req.method} ${url.pathname}`));
      return hit.handler({ req, params: hit.params, query: url.searchParams, deps });
    },
    websocket: driverChannel.websocket,
  });
  console.log(`[control-plane] api listening on :${config.port}`);
}

/**
 * 装配沙箱网关。按 config.sandbox.provider 选：'ppio' → 真实 PPIO；'mock' → mock 兜底。
 * 多供应商是设计形态（网关本体 ProviderSandboxGateway provider-中立）；当前唯一真实 provider 是 PPIO
 * （AgentBay 暂时下线）。
 *  · PPIO：E2B 同构托管，国内出站开放（回拨 CP / GLM 均通，无需 VPN）。driver 不烘镜像、运行时经
 *    files.write 推入 + 后台 node 启动；注入 controlPlaneUrl（driver 回连地址）+ engineAuthToken
 *    （沙箱内 ANTHROPIC_AUTH_TOKEN，路由配置由自定义模板的 settings.json 带）。
 *  · 换/加厂商：实现一个 SandboxProvider，在此加一个分支注入它 + 对应 resolveImageRef，网关不动。
 */
function buildSandboxGateway(config: Config, drivers: DriverRegistry): SandboxGateway {
  if (config.sandbox.provider !== 'ppio') {
    console.log('[control-plane] 沙箱：mock（未配 PPIO_API_KEY，也未指定 APROG_SANDBOX_PROVIDER=ppio）');
    return new MockSandboxGateway();
  }

  const bundlePath = process.env.APROG_DRIVER_BUNDLE;
  if (!bundlePath) {
    throw new Error('沙箱 provider=ppio 需设 APROG_DRIVER_BUNDLE（node-target driver.mjs 路径）');
  }
  // 注入 driver 的 env：引擎鉴权（ANTHROPIC_AUTH_TOKEN）+ 出网代理（配了 SS 节点才注入）。
  const injectedEnv: Record<string, string> = {};
  if (config.engineAuthToken) injectedEnv.ANTHROPIC_AUTH_TOKEN = config.engineAuthToken;
  if (config.proxy) Object.assign(injectedEnv, buildProxyEnv(config.proxy, config.controlPlaneUrl));
  const resources: Resources = { cpu: 2, memory: 4, disk: 10 };
  // 空字符串 → 用 SDK 默认 base 镜像（code-interpreter）；设 APROG_PPIO_TEMPLATE 用自定义模板（claude+GLM）。
  const template = process.env.APROG_PPIO_TEMPLATE ?? '';
  // 回拨走 TLS：读 CA 证书（公开非密）注入沙箱，driver 据此信任自签证书。未配则明文回拨。
  let caCertPem: string | undefined;
  if (config.controlPlaneCaCertPath) {
    caCertPem = readFileSync(config.controlPlaneCaCertPath, 'utf8');
  }
  const provider: SandboxProvider = new PPIOProvider({
    controlPlaneUrl: config.controlPlaneUrl,
    caCertPem,
    injectedEnv,
    driverBundlePath: bundlePath,
    defaultTemplate: template,
  });
  // PPIO 用自家模板注册表：暂把所有程序映射到一个 base/自定义模板（catalog 的 snapshot 命名不适用）。
  const resolveImageRef = (): ImageRef => ({ provider: 'ppio', id: template });
  console.log(
    `[control-plane] 沙箱：PPIO（template=${template || '(base)'}，controlPlaneUrl=${config.controlPlaneUrl}，引擎鉴权注入=${config.engineAuthToken ? '是' : '否'}，出网代理=${config.proxy ? `是(SS ${config.proxy.ss.server}:${config.proxy.ss.port})` : '否(直连)'}）`,
  );
  return new ProviderSandboxGateway(provider, drivers, resolveImageRef, resources);
}

/** 本地 http 代理地址（driver 在沙箱内起的 v2ray http 入站）。driver 据 HTTP_PROXY 的端口把 v2ray
 *  监听到同一端口（见 driver/proxy.ts），故这里的端口是「代理在哪」的唯一真相。 */
const LOCAL_PROXY_URL = 'http://127.0.0.1:1081';

/**
 * 据出网代理配置，产出注入 driver 的「代理 env」。三组：
 *  ① SS 节点密钥（APROG_PROXY_SS_*）→ driver 据此起 v2ray；APROG_ 前缀 → scrubEngineEnv 自动从引擎剥除。
 *  ② Node 出网开关 + 代理地址（NODE_USE_ENV_PROXY=1 + HTTP(S)_PROXY，大小写各一套兼顾 node/git/curl）→
 *     driver 自身 fetch（拉 ghcr）、git 子进程、引擎子进程一律经本地代理出网。
 *  ③ NO_PROXY 放行：localhost/127.0.0.1（本地代理自身）+ CP 回拨主机（国内、阿里云，且代理起来前就要拨）
 *     + bypass 列表（默认 GLM 国内端点）→ 这些直连，不绕代理。
 * CP 回拨主机从 controlPlaneUrl 自动取——driver 的 WebSocket 回拨据此直连（已验证原生 WS 认 NO_PROXY）。
 */
function buildProxyEnv(proxy: ProxyConfig, controlPlaneUrl: string): Record<string, string> {
  let cpHost = '';
  try {
    cpHost = new URL(controlPlaneUrl).hostname;
  } catch {
    // controlPlaneUrl 非法 → 不自动放行（NO_PROXY 仍含 localhost + bypass）
  }
  const noProxy = ['localhost', '127.0.0.1', cpHost, ...proxy.bypass].filter((h) => h.length > 0).join(',');
  return {
    // ① SS 密钥（引擎不可见）
    APROG_PROXY_SS_SERVER: proxy.ss.server,
    APROG_PROXY_SS_PORT: String(proxy.ss.port),
    APROG_PROXY_SS_PASSWORD: proxy.ss.password,
    APROG_PROXY_SS_METHOD: proxy.ss.method,
    // ② 出网开关 + 代理地址（node 在启动时读 NODE_USE_ENV_PROXY；故必须随启动 env 注入）
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: LOCAL_PROXY_URL,
    HTTPS_PROXY: LOCAL_PROXY_URL,
    http_proxy: LOCAL_PROXY_URL,
    https_proxy: LOCAL_PROXY_URL,
    // ③ 直连放行
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

/** 去掉 /v1 版本前缀（端点表省略它，见 docs/api.html#shape）。 */
function stripVersion(path: string): string {
  return path.replace(/^\/v\d+(?=\/)/, '');
}

/** 库里没有任何用户时，按环境变量种一个已激活管理员（便于首次把系统跑起来）。无 env 则跳过并提示。 */
async function seedAdmin(users: UserStore): Promise<void> {
  if (users.count() > 0) return;
  const name = process.env.APROG_ADMIN_USER;
  const mail = process.env.APROG_ADMIN_EMAIL;
  const pass = process.env.APROG_ADMIN_PASSWORD;
  if (name === undefined || mail === undefined || pass === undefined) {
    console.log('[control-plane] 暂无用户；设 APROG_ADMIN_USER / APROG_ADMIN_EMAIL / APROG_ADMIN_PASSWORD 可自动建管理员');
    return;
  }
  const u = users.createPending(name, mail);
  await users.setPassword(u.id, pass); // 直接激活，跳过邮箱验证
  console.log(`[control-plane] 已创建初始用户 ${name} <${mail}>`);
}
