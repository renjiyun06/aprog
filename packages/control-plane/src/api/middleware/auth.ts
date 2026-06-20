// 鉴权 + 授权中间件。
//   authenticate  token → User（无效抛 unauthorized）
//   authorize     校验 User 对某 pid 的角色 ≥ 所需档位（非成员抛 forbidden）
//   withAuth      包装器：先 authenticate，再把带 user 的 AuthCtx 交给处理器
// 角色档位 owner > editor > viewer（见 docs/api.html#sharing）。

import type { Handler, AuthHandler, ReqCtx, AuthCtx, User, Role, Deps } from '../context.ts';
import { unauthorized, notFound, forbidden } from '../errors.ts';

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

/** 校验 user 对 pid 至少有 need 档权限，返回其实际角色。进程不存在 → not_found；非成员 → forbidden。
 *  当前还没有共享模型：进程只有 owner（= 创建者）。任何档位都要求是 owner；待 shares 落地再按档位放行。 */
export async function authorize(user: User, pid: number, need: Role, deps: Deps): Promise<Role> {
  void need;
  const proc = deps.procs.get(pid);
  if (proc === undefined) throw notFound(`进程 ${pid} 不存在`);
  if (proc.userId !== user.id) throw forbidden('无权访问该进程');
  return 'owner';
}

/** 包装器：要求登录。鉴权通过后处理器拿到带 user 的 AuthCtx。 */
export function withAuth(h: AuthHandler): Handler {
  return async (ctx: ReqCtx): Promise<Response> => {
    const user = await authenticate(ctx.req, ctx.deps);
    const authed: AuthCtx = { ...ctx, user };
    return h(authed);
  };
}
