// control-plane 入口：装配各子系统并起 API 服务。
// 现仅骨架——把模块接线关系立起来，实现待后续细化协议时填。

import { loadConfig } from './config.ts';
import { startApi } from './api/http.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  startApi(config);
  // TODO: 优雅退出、健康检查、恢复未完成进程的快照。
}

main().catch((err) => {
  console.error('[control-plane] fatal', err);
  process.exit(1);
});
