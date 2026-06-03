// Driver 抽象。常驻沙箱，是「引擎差异的吸收层」——control-plane/前端只认 @aprog/protocol。
//
// 四项职责（见 docs/harness.html）：
//   ① 翻译   把引擎原生事件映射成 aprog 的 turn/user/item.* 事件
//   ② 盖 seq  两家 CLI 都不提供全局 seq → Driver 合成单调递增序号
//   ③ 映射 id 取引擎稳定标识（message.id:block / tool_use.id / item_id）作 ItemId
//   ④ 兜策略  auto-approve 审批、echo 用户输入、in-flight 快照

import type { Event } from '@aprog/protocol';

/** 一个引擎适配器：消费某 harness 的原生事件，产出 aprog 事件（未盖 seq）。 */
export interface EngineAdapter {
  readonly name: 'claude' | 'codex';
  /** 启动引擎并把其事件流翻译为 aprog 事件。 */
  run(prompt: string): AsyncIterable<Omit<Event, 'seq'>>;
}

/** Driver 把 adapter 的输出盖上单调递增 seq，再经 Bridge 上行给 control-plane。 */
export interface Driver {
  attach(adapter: EngineAdapter): void;
  /** control-plane 下发的用户输入；Driver 把它 echo 成 user 事件注入流。 */
  submitInput(content: string): void;
}
