// 事件流中枢 · 断线恢复。把 store 的回放与 hub 的 live 拼成「同一条有序订阅」：
// 先吐 seq > 游标 的历史，紧接着无缝续 live delta（原子交接，不漏不重）。
//
// 陷阱：resync 与 live 必须走同一条订阅，别拆成「HTTP 拿全量 + 另开 WS 收增量」。
// 投递 at-least-once，前端按 id 幂等去重（见 docs/protocol.html#recover）。

import type { Event, Subscribe } from '@aprog/protocol';
import type { StreamStore } from './store.ts';
import type { StreamHub } from './hub.ts';

/**
 * 单一有序流 = 回放历史 + 续 live。不漏不重的关键时序：
 *  1) 先订阅 hub——回放期间到达的 live 事件先入缓冲队列，绝不丢；
 *  2) 回放 store 中 seq > from 的历史，记下回放到的最大 seq；
 *  3) 续 live：丢弃缓冲里 seq ≤ 已回放最大值的（与回放重叠的那段），其余按序吐，之后纯 live。
 * 消费方（SSE）断开 → 生成器被 .return() → finally 退订。
 */
export async function* resyncThenLive(
  store: StreamStore,
  hub: StreamHub,
  pid: number,
  req: Subscribe,
): AsyncIterable<Event> {
  const queue: Event[] = [];
  let wake: (() => void) | null = null;
  // 1) 先订阅：此刻起的 live 事件入队，保证回放与 live 之间无缝（不丢交接点的事件）。
  const unsub = hub.subscribe(pid, (e) => {
    queue.push(e);
    wake?.();
    wake = null;
  });
  try {
    let last = req.from;
    // 2) 回放历史。
    for await (const e of store.readFrom(pid, req.from)) {
      yield e;
      last = e.seq;
    }
    // 3) 续 live：去重（seq ≤ last 是与回放重叠的）。队列空则 await 唤醒。
    for (;;) {
      const e = queue.shift();
      if (e === undefined) {
        await new Promise<void>((r) => (wake = r));
        continue;
      }
      if (e.seq <= last) continue;
      last = e.seq;
      yield e;
    }
  } finally {
    unsub();
  }
}
