// EngineAdapter · 引擎适配（引擎相关，唯一要为每款引擎重写的模块）。docs/harness.html。
// 两个方向：
//   下行  引擎原生输出流 → aprog 事件（翻译 / 合成 user 回显）
//   上行  aprog input/interrupt → 引擎原生动作（流式输入消息 / query.interrupt()）
//
// 无审批：所有操作默认放行，不留任何配置项。引擎在 start 时即以「最大权限 / 跳过许可」
// 模式拉起（Claude: permissionMode:'bypassPermissions'，不触发 canUseTool；Codex: 全自动、
// 不问），隔离完全交给沙箱兜底。因此没有 respond、没有 ApprovalPolicy，协议也不需要
// requires_action 事件——许可这件事在启动姿势里就解决了，不在运行期往返。

import type { Event } from '@aprog/protocol';
import type { HarnessSupervisor } from './supervisor.ts';
import type { InputItem } from './channel.ts';

export interface EngineContext {
  /** 用它拉起/读写引擎子进程（进程机制归 supervisor，见讨论①）。 */
  supervisor: HarnessSupervisor;
}

export interface EngineAdapter {
  readonly name: 'claude' | 'codex';

  /** 启动引擎（以最大权限/跳过许可模式）并把其原生输出翻成 aprog 事件（未盖全局 seq、未盖 localSeq——交 Sequencer）。 */
  start(ctx: EngineContext): AsyncIterable<Omit<Event, 'seq'>>;

  /** 上行→引擎：注入一条用户输入（机制引擎特定）。 */
  submit(item: InputItem): Promise<void>;

  /** 上行→引擎：打断当前回合（带内 interrupt，非进程信号）。 */
  interrupt(): Promise<void>;
}
