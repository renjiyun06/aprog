// aprog 事件流的事件种类。把任何引擎的产出归一成这几类（harness-neutral）。
//
// 一个「项(item)」= 一条思考 / 一条回复 / 一次工具调用 / 一次命令执行 / 一次文件改动，
// 生命周期为 start → delta* → end。与 docs/protocol.html 的「事件种类」表一一对应。

import type { Envelope, ItemId, TurnId } from './envelope.ts';

/** 一个项的类别。 */
export type ItemType = 'thinking' | 'reply' | 'tool' | 'command' | 'file_change';

/** item.delta 的增量载荷，按项类别区分。 */
export type ItemPatch =
  | { kind: 'text'; text: string }                         // thinking / reply 的文本增量
  | { kind: 'tool_args'; partial_json: string }            // tool 的入参 JSON 分片
  | { kind: 'command_output'; chunk: string }              // command 的输出分片
  | { kind: 'file_change'; diff: string };                 // file_change 的补丁分片

/** item.end 的 coalesced 全量，按项类别区分。 */
export type ItemValue =
  | { item: 'thinking'; text: string; signature?: string }
  | { item: 'reply'; text: string }
  | { item: 'tool'; name: string; args: unknown; result?: unknown }
  | { item: 'command'; command: string; output: string; exit_code?: number }
  | { item: 'file_change'; path: string; diff: string };

export interface TokenUsage {
  input?: number;
  output?: number;
  /** 上下文窗口已用占比所需：当前已占用 token 数（引擎提供时）。UI 的「ctx 73%」仪表用它。 */
  context_window?: number;
  /** 引擎多出的遥测（限流、credit/budget、cached/reasoning tokens、model 名等）——携带不建模。
   *  用户不据此行动的细节进这里，只在检视器/详情露出，绝不进结构。 */
  extra?: Record<string, unknown>;
}

/** 一个 agent 回合开始（用户提交后引擎开干）。 */
export interface TurnStart extends Envelope {
  kind: 'turn.start';
  turn: TurnId;
}

/** 用户输入（完整、非流式）。由 Driver echo 进流——见 docs/protocol.html#echo。 */
export interface UserEvent extends Envelope {
  kind: 'user';
  id: ItemId;
  content: string;
}

/** 一个项开始。 */
export interface ItemStart extends Envelope {
  kind: 'item.start';
  id: ItemId;
  item_type: ItemType;
}

/** 项的增量（实时「正在打字」）。 */
export interface ItemDelta extends Envelope {
  kind: 'item.delta';
  id: ItemId;
  patch: ItemPatch;
}

/** 项完成，带 coalesced 全量。流不删 delta（原始流持久化）；看历史时直接读此处的合并全量，跳过 delta。 */
export interface ItemEnd extends Envelope {
  kind: 'item.end';
  id: ItemId;
  value: ItemValue;
}

/**
 * 回合结束的原因——归一成「用户不同反应」的小集，与引擎无关。
 * 取值粒度 = 用户会做出的不同动作的数量，不再细；引擎原词进 `raw_stop_reason`。
 *
 * 归一映射：
 *   Claude: end_turn→completed、max_tokens/max_turns→limit、stop_sequence→completed、
 *           refusal→refused、error_during_execution→error。
 *   Codex:  TurnComplete→completed、Interrupted→interrupted、
 *           BudgetLimited→limit、Replaced/ReviewEnded→interrupted、Error→error。
 * 注：max_tokens 与 max_turns 都塌进 limit——用户的反应都是「可能没说完，要不要继续」，
 *    *哪种*上限留给 raw_stop_reason 的调试视图。
 */
export type StopReason =
  | 'completed'    // 正常说完，轮到用户
  | 'interrupted'  // 被打断/取代（用户中断、被新回合取代）
  | 'limit'        // 撞到某个上限（输出 token / agent loop 回合 / 额度预算）——可能没说完
  | 'refused'      // 安全拒答
  | 'error';       // 执行中出错

/** 回合结束。 */
export interface TurnEnd extends Envelope {
  kind: 'turn.end';
  turn: TurnId;
  stop_reason: StopReason;
  /** 引擎原始停止原因（归一前）。typed 的 stop_reason 是投影，这里留原词供检视/调试。 */
  raw_stop_reason?: string;
  usage?: TokenUsage;
}

/**
 * 引擎上下文压缩边界：harness 把它自己的历史上下文做了一次摘要压缩（context compaction）。
 * 注意这与“流的合并/读时投影”无关——事件流本身永不删减；这条只是如实记录“此处之前的引擎上下文已被压缩”，
 * 让用户在历史里看到这一刻。取自 Claude 的 `compact_boundary` / `SDKCompactBoundaryMessage`。
 */
export interface CompactionEvent extends Envelope {
  kind: 'compaction';
  /** 触发方式：自动（接近上下文上限）或手动。 */
  trigger: 'auto' | 'manual';
  /** 压缩前的 token 数（引擎提供时）。 */
  pre_tokens?: number;
}

/**
 * 错误 / 非致命提示。带严重级别——UI 据此区别对待：
 *   fatal     致命，回合无法继续（红色挂了）。取自 Codex `Error`。
 *   transient 瞬时，系统正在自愈（黄色「重连中…」，不该报死）。取自 Codex `StreamError`。
 *   warning   继续了但需提示用户（黄色提示行）。取自 Codex `Warning`。
 */
export interface ErrorEvent extends Envelope {
  kind: 'error';
  severity: 'fatal' | 'transient' | 'warning';
  message: string;
}

/** 流上的事件全集（discriminated union on `kind`）。 */
export type Event =
  | TurnStart
  | UserEvent
  | ItemStart
  | ItemDelta
  | ItemEnd
  | TurnEnd
  | CompactionEvent
  | ErrorEvent;

export type EventKind = Event['kind'];
