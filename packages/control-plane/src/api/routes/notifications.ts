// 路由 · 消息中心（用户级、跨进程，见 docs/api.html#notifications）。
// 拉取列表 + 标已读。实时推送 GET /notifications/stream 在 sse.ts。

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors } from '../errors.ts';
import { withAuth } from '../middleware/auth.ts';

/** GET /notifications?unread=&cursor= — 当前用户的通知（分页，可只看未读）。 */
async function list(ctx: AuthCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: GET /notifications');
}

/** POST /notifications/read — 标记已读 { ids? }（缺省=全部）。 */
async function read(ctx: AuthCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: POST /notifications/read');
}

export function mount(r: Router): void {
  r.add('GET', '/notifications', withErrors(withAuth(list)));
  r.add('POST', '/notifications/read', withErrors(withAuth(read)));
}
