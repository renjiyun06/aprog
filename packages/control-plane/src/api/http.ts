// 北面 HTTP API 的「组装根」：起 Bun.serve、建路由表、mount 各 route 模块、统一分发。
// 它故意很薄——只把请求路由到对应处理器。业务逻辑住在 deps 指向的子系统里（见 context.ts、
// docs/api-impl.html）。命令走 REST，事件流走 SSE（api/sse.ts），二者挂在同一个 server。

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
import { MockSandboxGateway } from '../process/sandbox-gateway.ts';
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
  // 进程编排：PCB 走 DB；沙箱动作当前用 mock（未对接真实 provider）。
  const procs = new ProcessManager(db, new MockSandboxGateway());
  console.log('[control-plane] 沙箱：mock（未对接真实 provider）');
  void seedAdmin(users);

  const deps: Deps = {
    users,
    tokens,
    codes,
    email,
    catalog,
    installs,
    procs,
    // 以下子系统尚未实现（stream/* 仍是接口）。先用 pending 占位：一旦被处理器触达即抛清晰错误。
    store: pending('StreamStore'),
    hub: pending('StreamHub'),
    channelFor: () => undefined,
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
    fetch(req): Response | Promise<Response> {
      const url = new URL(req.url);
      const hit = router.match(req.method, stripVersion(url.pathname));
      if (hit === undefined) return toErrorResponse(notFound(`无此端点 ${req.method} ${url.pathname}`));
      return hit.handler({ req, params: hit.params, query: url.searchParams, deps });
    },
  });
  console.log(`[control-plane] api listening on :${config.port}`);
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
