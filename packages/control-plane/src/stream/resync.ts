// 事件流中枢 · 断线恢复。把 store 的回放与 hub 的 live 拼成「同一条有序订阅」：
// 先吐 seq > 游标 的历史，紧接着无缝续 live delta（原子交接，不漏不重）。
//
// 陷阱：resync 与 live 必须走同一条订阅，别拆成「HTTP 拿全量 + 另开 WS 收增量」。
// 投递 at-least-once，前端按 id 幂等去重（见 docs/protocol.html#recover）。

import type { Event, Subscribe } from '@aprog/protocol';
import type { StreamStore } from './store.ts';
import type { StreamHub } from './hub.ts';

export async function* resyncThenLive(
  store: StreamStore,
  hub: StreamHub,
  pid: number,
  req: Subscribe,
): AsyncIterable<Event> {
  // 1) 回放游标之后的历史。 2) 在交接点续 live。
  // 实现待补——此处定下契约：单一有序流。
  void store; void hub; void pid; void req;
  throw new Error('not implemented');
}
