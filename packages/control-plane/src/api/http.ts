// 北面 HTTP API 的「组装根」：起 Bun.serve、建路由表、mount 各 route 模块、统一分发。
// 它故意很薄——只把请求路由到对应处理器。业务逻辑住在 deps 指向的子系统里（见 context.ts、
// docs/api-impl.html）。命令走 REST，事件流走 SSE（api/sse.ts），二者挂在同一个 server。

import { readFileSync } from 'node:fs';
import type { Config } from '../config.ts';
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
import { ProcessManager } from '../process/manager.ts';
import { ProviderSandboxGateway, MockSandboxGateway, type SandboxGateway } from '../process/sandbox-gateway.ts';
import { DriverRegistry } from '../driver-channel/registry.ts';
import { DriverChannelServer } from '../driver-channel/channel.ts';
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
  const catalog = new ProgramCatalog(db); // 启动时把程序目录 upsert 进表
  const installs = new InstallStore(db);
  // 进程编排：PCB 走 DB；沙箱动作经网关收口。
  // 进程仓库：配了 GITHUB_TOKEN 就真在 GitHub 建私有库，否则 mock（造假 clone URL）。
  const repos = config.github ? new GitHubRepoGateway(config.github) : new MockRepoGateway();
  // driver 握手登记簿：网关 create 时登记 bindToken，driver 拨入时认领（driver-channel/channel.ts）。
  const drivers = new DriverRegistry();
  // driver 通道服务（南面 WS）：握手 + 活连接表。http.ts 只装配，逻辑在 driver-channel/channel.ts。
  const driverChannel = new DriverChannelServer(drivers);
  // 沙箱网关：按 config.sandbox.provider 选——ppio 接真实 PPIO（注入 bindToken + 控制平面地址 + 引擎鉴权），否则 mock。
  const sandbox = buildSandboxGateway(config, drivers);
  const procs = new ProcessManager(db, sandbox, repos);
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
    // 以下子系统尚未实现（stream/* 仍是接口）。先用 pending 占位：一旦被处理器触达即抛清晰错误。
    store: pending('StreamStore'),
    hub: pending('StreamHub'),
    channelFor: (pid) => driverChannel.connectionFor(pid),
  };

  const router = new Router();
  auth.mount(router);
  programs.mount(router);
  installations.mount(router);
  proc.mount(router);
  shares.mount(router);
  notifications.mount(router);
  mountSse(router);

  Bun.serve({
    port: config.port,
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
  const engineEnv = config.engineAuthToken ? { ANTHROPIC_AUTH_TOKEN: config.engineAuthToken } : undefined;
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
    injectedEnv: engineEnv,
    driverBundlePath: bundlePath,
    defaultTemplate: template,
  });
  // PPIO 用自家模板注册表：暂把所有程序映射到一个 base/自定义模板（catalog 的 snapshot 命名不适用）。
  const resolveImageRef = (): ImageRef => ({ provider: 'ppio', id: template });
  console.log(
    `[control-plane] 沙箱：PPIO（template=${template || '(base)'}，controlPlaneUrl=${config.controlPlaneUrl}，引擎鉴权注入=${engineEnv ? '是' : '否'}）`,
  );
  return new ProviderSandboxGateway(provider, drivers, resolveImageRef, resources);
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

/** 未装配子系统的占位：被触达即抛清晰错误，避免静默 undefined。 */
function pending<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`[control-plane] 子系统「${name}」尚未装配`);
      },
    },
  ) as T;
}
