// 北面 HTTP API 的「组装根」：起 Bun.serve、建路由表、mount 各 route 模块、统一分发。
// 它故意很薄——只把请求路由到对应处理器。业务逻辑住在 deps 指向的子系统里（见 context.ts、
// docs/api-impl.html）。命令走 REST，事件流走 SSE（api/sse.ts），二者挂在同一个 server。

import type { Config } from '../config.ts';
import type { ProcessManager } from '../process/manager.ts';
import type { Deps } from './context.ts';
import { Router } from './router.ts';
import { toErrorResponse, notFound } from './errors.ts';
import * as auth from './routes/auth.ts';
import * as programs from './routes/programs.ts';
import * as proc from './routes/proc.ts';
import * as shares from './routes/shares.ts';
import * as notifications from './routes/notifications.ts';
import { mountSse } from './sse.ts';

export function startApi(config: Config, procs: ProcessManager): void {
  const deps: Deps = {
    procs,
    // 以下子系统尚未实现（stream/* 仍是接口）。先用 pending 占位：一旦被处理器触达即抛清晰错误。
    store: pending('StreamStore'),
    hub: pending('StreamHub'),
    channelFor: () => undefined,
  };

  const router = new Router();
  auth.mount(router);
  programs.mount(router);
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
