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

/** 项完成，带 coalesced 全量。压实后老段只保留此事件。 */
export interface ItemEnd extends Envelope {
  kind: 'item.end';
  id: ItemId;
  value: ItemValue;
}

/** 回合结束。 */
export interface TurnEnd extends Envelope {
  kind: 'turn.end';
  turn: TurnId;
  usage?: TokenUsage;
}

/** 错误。 */
export interface ErrorEvent extends Envelope {
  kind: 'error';
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
  | ErrorEvent;

export type EventKind = Event['kind'];
