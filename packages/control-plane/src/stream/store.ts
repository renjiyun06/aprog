// 事件流中枢 · 存储。每进程一条 append-only 流，是唯一数据源。
//
// - append: Driver 来的事件，盖单调递增 seq 后落库。
// - readFrom: 回放 seq > from 的事件——老段给压实后的 item.end，尾部给原始 delta。
// - compact: 项完成后把同 id 的 delta 折叠进 item.end，丢碎 delta。
// session.aprog.jsonl 只是这条流压实后的投影，可随时重建（见 docs/protocol.html）。

import type { Event, Seq } from '@aprog/protocol';

export interface StreamStore {
  /** 追加一个（尚未盖 seq 的）事件，返回盖好 seq 的事件。 */
  append(pid: number, event: Omit<Event, 'seq'>): Promise<Event>;
  /** 从游标之后回放：压实段→item.end，尾部→delta。 */
  readFrom(pid: number, from: Seq): AsyncIterable<Event>;
  /** 折叠已完成项的碎 delta。 */
  compact(pid: number): Promise<void>;
  /** 当前流的末端 seq。 */
  head(pid: number): Promise<Seq>;
}
