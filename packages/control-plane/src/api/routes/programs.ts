// 路由 · 程序目录。GET /programs —— 列出可安装的智能程序（商店目录）。
// 系统应用（商店/设置）是前端 chrome，不在目录里。模型见 docs/data-model.html。

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors } from '../errors.ts';
import { withAuth } from '../middleware/auth.ts';
import { paged } from '../respond.ts';

/** GET /programs — 程序商店目录（全部智能程序）。 */
async function list(ctx: AuthCtx): Promise<Response> {
  return paged(ctx.deps.catalog.list());
}

export function mount(r: Router): void {
  r.add('GET', '/programs', withErrors(withAuth(list)));
}
