// 控制平面 client。所有北向 API 调用的唯一出口：base 前缀、token 存取、错误信封解析。
// 同源走 vite 代理 /cp-api → 控制平面 :8099（见 vite.config.ts）。

const BASE = '/cp-api';
const LS_TOKEN = 'aprog.token';

let token: string | null = localStorage.getItem(LS_TOKEN);

export function getToken(): string | null {
  return token;
}
export function setToken(t: string | null): void {
  token = t;
  if (t === null) localStorage.removeItem(LS_TOKEN);
  else localStorage.setItem(LS_TOKEN, t);
}

/** 北面错误信封 → 异常。携带 code 供前端按需分支，message 给人看。 */
export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;
  constructor(code: string, message: string, retryable: boolean, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== null) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; retryable?: boolean } } | null)?.error;
    throw new ApiError(e?.code ?? 'internal', e?.message ?? `请求失败 (${res.status})`, e?.retryable ?? false, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
};
