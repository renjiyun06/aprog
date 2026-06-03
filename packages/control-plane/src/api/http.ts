// 给 mica 的 HTTP API。REST 动词对应 CLI：spawn / ps / kill / cat / ls …
// 事件流订阅走 SSE（见 api/sse.ts），挂在同一个 server 上。

import type { Config } from '../config.ts';
import type { ProcessManager } from '../process/manager.ts';

export function startApi(config: Config, procs: ProcessManager): void {
  // 占位：用 Bun.serve 起 HTTP；路由示意：
  //   GET  /api/processes            ps
  //   POST /api/processes            spawn
  //   POST /api/processes/:pid/hibernate | /wake | /kill
  //   GET  /api/processes/:pid/stream?from=<seq>   订阅事件流（SSE）
  void config; void procs;
  console.log(`[control-plane] api listening on :${config.port} (stub)`);
}
