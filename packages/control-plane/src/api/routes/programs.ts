// 路由 · 程序。GET /programs?scope=store|installed —— 列出可装 / 已安装程序（见 docs/api.html#r-program）。

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors } from '../errors.ts';
import { withAuth } from '../middleware/auth.ts';

/** GET /programs — 程序商店全部 / 当前用户已安装。 */
async function list(ctx: AuthCtx): Promise<Response> {
  void ctx;
  // 入参：scope=store|installed、q?、cursor?、limit? → 分页信封（item=Program）
  throw new Error('not implemented: GET /programs');
}

export function mount(r: Router): void {
  r.add('GET', '/programs', withErrors(withAuth(list)));
}
