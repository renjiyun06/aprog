// 北面错误模型 + 序列化。客户端错误码自成一套（不复用南面 SandboxError，见 docs/api.html#q-errors）。
// 所有处理器抛 ApiError；withErrors 统一捕获 → { error:{code,message,retryable} } + 状态码。

import type { Handler } from './context.ts';

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'sandbox_unavailable'
  | 'internal';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 400,
  rate_limited: 429,
  sandbox_unavailable: 503,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 常用构造器
export const unauthorized = (m = '未认证'): ApiError => new ApiError('unauthorized', m);
export const forbidden = (m = '无权限'): ApiError => new ApiError('forbidden', m);
export const notFound = (m = '不存在'): ApiError => new ApiError('not_found', m);
export const conflict = (m = '状态冲突'): ApiError => new ApiError('conflict', m);
export const validation = (m = '参数非法'): ApiError => new ApiError('validation', m);

/** 异常 → 北面错误信封 + 状态码。非 ApiError 一律 500 internal（不外泄细节）。 */
export function toErrorResponse(err: unknown): Response {
  const e = err instanceof ApiError ? err : new ApiError('internal', '内部错误');
  return Response.json({ error: { code: e.code, message: e.message, retryable: e.retryable } }, { status: STATUS[e.code] });
}

/** 包装器：捕获处理器抛出的异常，统一转成错误信封。挂在每条路由最外层。 */
export function withErrors(h: Handler): Handler {
  return async (ctx) => {
    try {
      return await h(ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
