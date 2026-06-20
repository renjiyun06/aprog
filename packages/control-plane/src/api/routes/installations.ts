// 路由 · 安装。当前用户在桌面上装了哪些智能程序（模型见 docs/data-model.html）。
//   GET    /installations               → 已装程序 id 列表
//   POST   /installations  {programId}  → 安装（幂等）
//   DELETE /installations/:programId     → 卸载（幂等）

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors, validation } from '../errors.ts';
import { withAuth } from '../middleware/auth.ts';
import { paged, noContent, created, readJson } from '../respond.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** GET /installations — 当前用户已安装的程序 id。 */
async function list(ctx: AuthCtx): Promise<Response> {
  return paged(ctx.deps.installs.listFor(ctx.user.id));
}

/** POST /installations {programId} — 安装到桌面。 */
async function install(ctx: AuthCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const programId = str(b.programId).trim();
  if (programId === '') throw validation('缺少 programId');
  if (!ctx.deps.catalog.has(programId)) throw validation(`未知程序 ${programId}`);
  ctx.deps.installs.install(ctx.user.id, programId);
  return created({ programId });
}

/** DELETE /installations/:programId — 从桌面卸载。 */
async function uninstall(ctx: AuthCtx): Promise<Response> {
  ctx.deps.installs.uninstall(ctx.user.id, ctx.params.programId!);
  return noContent();
}

export function mount(r: Router): void {
  r.add('GET', '/installations', withErrors(withAuth(list)));
  r.add('POST', '/installations', withErrors(withAuth(install)));
  r.add('DELETE', '/installations/:programId', withErrors(withAuth(uninstall)));
}
