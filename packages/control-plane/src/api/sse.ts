// 路由 · SSE 流式端点（自成一路，因长连 + text/event-stream，plumbing 异于普通请求/响应）。
//   GET /proc/:pid/stream?from=<seq>  事件流：resync→live 同一条订阅（见 docs/api.html#stream）
//   GET /notifications/stream         消息中心实时推送
// 每帧 `data: <JSON>\n\n`。事件流帧体是 @aprog/protocol 的 Event；前端按 id 幂等合并。

import type { Router } from './router.ts';
import type { AuthCtx } from './context.ts';
import { withErrors } from './errors.ts';
import { withAuth, authorize } from './middleware/auth.ts';
import { parsePid } from './respond.ts';
import { resyncThenLive } from '../stream/resync.ts';

/** 把一个异步事件序列写成 SSE 响应。源迭代出错时补一帧 `event: error` 再收尾。 */
function sseResponse(events: AsyncIterable<unknown>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of events) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
      } catch (err) {
        controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}

/** GET /proc/:pid/stream — 进程事件流（需成员）。 */
async function streamProc(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'viewer', ctx.deps);
  const from = Number(ctx.query.get('from') ?? '0');
  const events = resyncThenLive(ctx.deps.store, ctx.deps.hub, pid, { from });
  return sseResponse(events);
}

/** GET /notifications/stream — 用户的实时通知。 */
async function streamNotifications(ctx: AuthCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: GET /notifications/stream');
}

export function mountSse(r: Router): void {
  r.add('GET', '/proc/:pid/stream', withErrors(withAuth(streamProc)));
  r.add('GET', '/notifications/stream', withErrors(withAuth(streamNotifications)));
}
