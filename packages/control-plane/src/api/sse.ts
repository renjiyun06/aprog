// 事件流订阅的 SSE 端点。客户端带 ?from=<游标 seq>，服务端在同一条响应里
// 先 resync（seq > from）再续 live——交给 stream/resync.resyncThenLive。
//
// 每条 SSE message 是一个 @aprog/protocol 的 Event(JSON)。前端按 id 幂等合并。

import type { Subscribe } from '@aprog/protocol';

export interface SseEndpoint {
  /** 把 resyncThenLive 的事件序列写成 SSE 流。 */
  handle(pid: number, req: Subscribe): Response;
}
