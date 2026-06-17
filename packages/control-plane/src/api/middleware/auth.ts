// 鉴权 + 授权中间件。
//   authenticate  token → User（无效抛 unauthorized）
//   authorize     校验 User 对某 pid 的角色 ≥ 所需档位（非成员抛 forbidden）
//   withAuth      包装器：先 authenticate，再把带 user 的 AuthCtx 交给处理器
// 角色档位 owner > editor > viewer（见 docs/api.html#sharing）。

import type { Handler, AuthHandler, ReqCtx, AuthCtx, User, Role, Deps } from '../context.ts';
import { unauthorized } from '../errors.ts';

/** 从 Authorization: Bearer <token> 解析用户。无效/过期/用户不存在 → unauthorized。 */
export async function authenticate(req: Request, deps: Deps): Promise<User> {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (m === null) throw unauthorized('缺少 Bearer token');
  const userId = deps.tokens.resolve(m[1]!);
  if (userId === undefined) throw unauthorized('token 无效或已过期');
  const user = deps.users.getById(userId);
  if (user === undefined) throw unauthorized('用户不存在');
  return user;
}

/** 校验 user 对 pid 至少有 need 档权限，返回其实际角色。非成员 → forbidden。 */
export async function authorize(user: User, pid: number, need: Role, deps: Deps): Promise<Role> {
  void user;
  void pid;
  void need;
  void deps;
  // TODO: 查进程成员表 → 比较角色档位（owner>editor>viewer）→ 返回角色或抛 forbidden()。
  throw new Error('not implemented: authorize');
}

/** 包装器：要求登录。鉴权通过后处理器拿到带 user 的 AuthCtx。 */
export function withAuth(h: AuthHandler): Handler {
  return async (ctx: ReqCtx): Promise<Response> => {
    const user = await authenticate(ctx.req, ctx.deps);
    const authed: AuthCtx = { ...ctx, user };
    return h(authed);
  };
}
