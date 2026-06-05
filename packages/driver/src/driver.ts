// Driver · 顶层编排（引擎无关）。把脊柱模块 + 一个 EngineAdapter 接起来，
// 跑完一个进程在一次运行内的全生命周期。常驻沙箱，是「引擎差异的吸收层」——
// control-plane / 前端只认 @aprog/protocol。
//
// 模块构成（本会话讨论的 7 模块分解；锚点见 docs/harness.html、docs/interaction.html#schema）：
//   Channel 链路 · Sequencer 定序 · HarnessSupervisor 进程监管
//   · FsServer 目录服务 · BundleIO 大块 · EngineAdapter 引擎适配（唯一引擎相关）
//   （帧路由 Dispatcher 是 Channel 的内部职责，未单列接口。）

import type { DriverChannel } from './channel.ts';
import type { Sequencer } from './sequencer.ts';
import type { HarnessSupervisor } from './supervisor.ts';
import type { FsServer } from './fs.ts';
import type { BundleIO } from './bundle.ts';
import type { EngineAdapter } from './engine.ts';

/** Driver 组装所需的全部模块。 */
export interface DriverDeps {
  channel: DriverChannel;
  sequencer: Sequencer;
  supervisor: HarnessSupervisor;
  fs: FsServer;
  bundle: BundleIO;
  adapter: EngineAdapter;
}

export interface Driver {
  /**
   * 跑完整生命周期：
   *   dial 握手 → (resume: 重放缓冲 | restore: 收 bundle 灌注) → 起 harness
   *   → 泵事件上行 + 路由下行（input/control/fs）→ 直到连接终结
   *     （hibernate-prepare 落末次 checkpoint 后正常断 / 意外断 = 下次唤醒恢复到上一检查点）。
   */
  run(): Promise<void>;
}
