// 路由 · 共享与权限（仅 owner 可操作，见 docs/api.html#sharing）。
// 列出成员 / 分享 / 改档 / 撤回。

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors } from '../errors.ts';
import { withAuth, authorize } from '../middleware/auth.ts';
import { parsePid } from '../respond.ts';

/** GET /proc/:pid/shares — 列出分享给谁 + 各角色。 */
async function list(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  throw new Error('not implemented: GET /proc/:pid/shares');
}

/** POST /proc/:pid/shares — 分享给某用户 { userId, role }。 */
async function add(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  throw new Error('not implemented: POST /proc/:pid/shares');
}

/** PATCH /proc/:pid/shares/:userId — 改某成员角色 { role }。 */
async function patch(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  throw new Error('not implemented: PATCH /proc/:pid/shares/:userId');
}

/** DELETE /proc/:pid/shares/:userId — 撤回某成员访问。 */
async function remove(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  throw new Error('not implemented: DELETE /proc/:pid/shares/:userId');
}

export function mount(r: Router): void {
  r.add('GET', '/proc/:pid/shares', withErrors(withAuth(list)));
  r.add('POST', '/proc/:pid/shares', withErrors(withAuth(add)));
  r.add('PATCH', '/proc/:pid/shares/:userId', withErrors(withAuth(patch)));
  r.add('DELETE', '/proc/:pid/shares/:userId', withErrors(withAuth(remove)));
}
