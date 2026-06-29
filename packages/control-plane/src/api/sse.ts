// 路由 · SSE 流式端点（自成一路，因长连 + text/event-stream，plumbing 异于普通请求/响应）。
//   GET /proc/stream                  账号级进程生命周期流：状态变更（waking/running/…）实时推送
//   GET /proc/:pid/stream?from=<seq>  单进程事件流：resync→live 同一条订阅（见 docs/api.html#stream）
//   GET /notifications/stream         消息中心实时推送
// 每帧 `data: <JSON>\n\n`。事件流帧体是 @aprog/protocol 的 Event；前端按 id 幂等合并。

import type { Router } from './router.ts';
import type { AuthCtx, ReqCtx } from './context.ts';
import { withErrors, unauthorized } from './errors.ts';
import { withAuth, authorize } from './middleware/auth.ts';
import { parsePid } from './respond.ts';
import { resyncThenLive } from '../stream/resync.ts';
import type { LifecycleHub } from '../process/lifecycle.ts';
import type { ProcessRecord } from '../process/manager.ts';

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

/** 进程生命周期 SSE：push-based（hub 回调）→ ReadableStream。客户端断开经 cancel() 退订，定时心跳保活。
 *  与 sseResponse 分开：那条是 pull-based（异步迭代器），这条是订阅式推送。 */
function lifecycleResponse(hub: LifecycleHub, userId: string): Response {
  const enc = new TextEncoder();
  let unsub = (): void => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string): void => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          // 流已关闭：忽略（cancel 会清理）。
        }
      };
      write(': connected\n\n'); // 注释帧：立即建立流
      unsub = hub.subscribe(userId, (rec: ProcessRecord) => write(`data: ${JSON.stringify(rec)}\n\n`));
      heartbeat = setInterval(() => write(': ping\n\n'), 25000); // 心跳防代理/网关掐断空闲连接
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      unsub();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}

/** GET /proc/stream — 账号级进程生命周期流（状态变更实时推送）。
 *  EventSource 不能设 Authorization 头，故从 query token 鉴权（与 withAuth 等价的最小校验）。 */
async function streamLifecycle(ctx: ReqCtx): Promise<Response> {
  const token = ctx.query.get('token') ?? '';
  const userId = ctx.deps.tokens.resolve(token);
  if (userId === undefined) throw unauthorized('token 无效或已过期');
  const user = ctx.deps.users.getById(userId);
  if (user === undefined) throw unauthorized('用户不存在');
  return lifecycleResponse(ctx.deps.lifecycle, user.id);
}

/** GET /proc/:pid/stream?from=<seq> — 进程事件流（需成员，viewer）。
 *  与 streamLifecycle 同理：EventSource 不能设 Authorization 头，故 token 走 query（非 withAuth）。 */
async function streamProc(ctx: ReqCtx): Promise<Response> {
  const token = ctx.query.get('token') ?? '';
  const userId = ctx.deps.tokens.resolve(token);
  if (userId === undefined) throw unauthorized('token 无效或已过期');
  const user = ctx.deps.users.getById(userId);
  if (user === undefined) throw unauthorized('用户不存在');
  const pid = parsePid(ctx);
  await authorize(user, pid, 'viewer', ctx.deps);
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
  // /proc/stream（账号级）须先于 proc.mount 的 /proc/:pid 注册：二者同为 2 段，路由首个匹配胜出。
  r.add('GET', '/proc/stream', withErrors(streamLifecycle));
  r.add('GET', '/proc/:pid/stream', withErrors(streamProc)); // query-token 鉴权（EventSource 不能设头）
  r.add('GET', '/notifications/stream', withErrors(withAuth(streamNotifications)));
}
