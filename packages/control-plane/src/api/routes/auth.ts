// 路由 · 鉴权。POST /auth/login（公开）、POST /auth/logout（需登录）。

import type { Router } from '../router.ts';
import type { ReqCtx, AuthCtx } from '../context.ts';
import { withErrors } from '../errors.ts';
import { withAuth } from '../middleware/auth.ts';

/** POST /auth/login — 用户名密码换 token（见 docs/api.html#r-token）。 */
async function login(ctx: ReqCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: POST /auth/login');
}

/** POST /auth/logout — 失效当前 token。 */
async function logout(ctx: AuthCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: POST /auth/logout');
}

export function mount(r: Router): void {
  r.add('POST', '/auth/login', withErrors(login)); // 无需 token
  r.add('POST', '/auth/logout', withErrors(withAuth(logout)));
}
