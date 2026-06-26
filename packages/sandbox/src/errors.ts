// 沙箱层错误分类（provider-neutral）。上层只认这些类型，不直接接触某个厂商 SDK 的错误。
//
// 每个错误带：
//   - code：稳定的机器可读分类
//   - retryable：是否值得退避重试（瞬态网络 / 限流 / 超时 = true；鉴权 / 校验 / 冲突 = false）
//   - provider：哪家厂商
//   - cause：原始错误（厂商 SDK 抛的），保留链路
// 各 provider 实现自行把厂商 SDK 的错误归一成这里的 SandboxError（见 providers/ppio.ts 的 wrap）。

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
