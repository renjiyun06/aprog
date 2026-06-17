// 响应序列化小工具：统一成功响应形状（JSON / 201 / 202 / 204 / 分页信封），以及常用入参解析。
// 处理器最后一步「序列化」走这里，保证形状和 docs/api.html#responses 一致。

import type { ReqCtx } from './context.ts';
import { validation } from './errors.ts';

export const json = (data: unknown, status = 200): Response => Response.json(data, { status });
export const created = (data: unknown): Response => Response.json(data, { status: 201 });
export const accepted = (data?: unknown): Response =>
  data === undefined ? new Response(null, { status: 202 }) : Response.json(data, { status: 202 });
export const noContent = (): Response => new Response(null, { status: 204 });

/** 列表端点统一分页信封 { items, nextCursor? }（见 docs/api.html#r-paged）。 */
export const paged = <T>(items: T[], nextCursor?: string): Response => json({ items, nextCursor });

/** 取并校验 :pid 路径参数。 */
export function parsePid(ctx: ReqCtx): number {
  const v = Number(ctx.params.pid);
  if (!Number.isInteger(v)) throw validation('pid 非法');
  return v;
}
