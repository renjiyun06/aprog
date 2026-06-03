// 沙箱层错误分类（provider-neutral）。上层只认这些类型，不直接接触某个厂商 SDK 的错误。
//
// 每个错误带：
//   - code：稳定的机器可读分类
//   - retryable：是否值得退避重试（瞬态网络 / 限流 / 超时 = true；鉴权 / 校验 / 冲突 = false）
//   - provider：哪家厂商
//   - cause：原始错误（厂商 SDK 抛的），保留链路
// mapDaytonaError 把 @daytonaio/sdk 的 DaytonaError 子类映射到这里。

import {
  DaytonaError,
  DaytonaAuthenticationError,
  DaytonaAuthorizationError,
  DaytonaConflictError,
  DaytonaConnectionError,
  DaytonaNotFoundError,
  DaytonaRateLimitError,
  DaytonaTimeoutError,
  DaytonaValidationError,
} from '@daytonaio/sdk';
import type { ProviderId } from './types.ts';

export type SandboxErrorCode =
  | 'config' // 缺 apiKey / 配置不全（启动期就该暴露）
  | 'auth' // 鉴权 / 授权失败
  | 'not_found' // 沙箱不存在
  | 'timeout' // 操作超时
  | 'unavailable' // 连不上厂商 / 网络
  | 'rate_limit' // 被限流
  | 'validation' // 入参非法
  | 'conflict' // 状态冲突（如重名）
  | 'unknown';

export interface SandboxErrorOptions {
  code: SandboxErrorCode;
  provider: ProviderId;
  retryable: boolean;
  cause?: unknown;
}

/** 沙箱层统一错误基类。 */
export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly provider: ProviderId;
  readonly retryable: boolean;

  constructor(message: string, opts: SandboxErrorOptions) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.code = opts.code;
    this.provider = opts.provider;
    this.retryable = opts.retryable;
  }
}

// —— 具体子类：固定 code / retryable，方便 instanceof 判定 ——

export class SandboxConfigError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'config', provider, retryable: false, cause });
  }
}
export class SandboxAuthError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'auth', provider, retryable: false, cause });
  }
}
export class SandboxNotFoundError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'not_found', provider, retryable: false, cause });
  }
}
export class SandboxTimeoutError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'timeout', provider, retryable: true, cause });
  }
}
export class SandboxUnavailableError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'unavailable', provider, retryable: true, cause });
  }
}
export class SandboxRateLimitError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'rate_limit', provider, retryable: true, cause });
  }
}
export class SandboxValidationError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'validation', provider, retryable: false, cause });
  }
}
export class SandboxConflictError extends SandboxError {
  constructor(message: string, provider: ProviderId, cause?: unknown) {
    super(message, { code: 'conflict', provider, retryable: false, cause });
  }
}

/** 把 Daytona SDK 的错误映射成沙箱层错误。已是 SandboxError 的原样返回。 */
export function mapDaytonaError(e: unknown): SandboxError {
  if (e instanceof SandboxError) return e;
  const p: ProviderId = 'daytona';
  const msg = e instanceof Error ? e.message : String(e);

  if (e instanceof DaytonaAuthenticationError || e instanceof DaytonaAuthorizationError) {
    return new SandboxAuthError(`daytona auth failed: ${msg}`, p, e);
  }
  if (e instanceof DaytonaNotFoundError) {
    return new SandboxNotFoundError(`daytona sandbox not found: ${msg}`, p, e);
  }
  if (e instanceof DaytonaTimeoutError) {
    return new SandboxTimeoutError(`daytona operation timed out: ${msg}`, p, e);
  }
  if (e instanceof DaytonaRateLimitError) {
    return new SandboxRateLimitError(`daytona rate limited: ${msg}`, p, e);
  }
  if (e instanceof DaytonaConnectionError) {
    return new SandboxUnavailableError(`daytona unreachable: ${msg}`, p, e);
  }
  if (e instanceof DaytonaValidationError) {
    return new SandboxValidationError(`daytona validation error: ${msg}`, p, e);
  }
  if (e instanceof DaytonaConflictError) {
    return new SandboxConflictError(`daytona conflict: ${msg}`, p, e);
  }
  if (e instanceof DaytonaError) {
    return new SandboxError(`daytona error: ${msg}`, { code: 'unknown', provider: p, retryable: false, cause: e });
  }
  return new SandboxError(`unexpected error: ${msg}`, { code: 'unknown', provider: p, retryable: false, cause: e });
}
