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

/**
 * 内存实现（第一批）：每进程一条 append-only 数组。盖全局单调 seq（覆盖 driver 的本地占位 seq）。
 * 关键不变量：append 同步盖 seq——调用方按 WS 到达顺序逐条 append，seq 即与到达序一致（保序）。
 * 持久化（落 session.aprog.jsonl / 检查点）与压实（compact）留作后续；CP 重启会丢内存流——批一接受。
 */
export class MemoryStreamStore implements StreamStore {
  private readonly streams = new Map<number, Event[]>();
  private readonly heads = new Map<number, Seq>();

  async append(pid: number, event: Omit<Event, 'seq'>): Promise<Event> {
    const seq = (this.heads.get(pid) ?? 0) + 1;
    this.heads.set(pid, seq);
    const stamped = { ...event, seq } as Event; // 覆盖入参里 driver 的本地 seq，盖 CP 全局 seq
    let arr = this.streams.get(pid);
    if (arr === undefined) {
      arr = [];
      this.streams.set(pid, arr);
    }
    arr.push(stamped);
    return stamped;
  }

  async *readFrom(pid: number, from: Seq): AsyncIterable<Event> {
    const arr = this.streams.get(pid);
    if (arr === undefined) return;
    // 快照当前长度：回放途中的并发 append 由 hub 的 live 续，不在此处重复吐。
    const snapshot = arr.slice();
    for (const e of snapshot) {
      if (e.seq > from) yield e;
    }
  }

  async compact(pid: number): Promise<void> {
    // 第一批不压实：回放仍吐原始 delta（at-least-once，前端按 id 幂等去重）。留待后续优化。
    void pid;
  }

  async head(pid: number): Promise<Seq> {
    return this.heads.get(pid) ?? 0;
  }
}
