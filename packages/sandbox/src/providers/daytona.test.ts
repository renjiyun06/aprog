// DaytonaProvider 单元测试。全部用注入的假客户端，不需要真实 Daytona 凭据。
// 真实集成测试（打真 Daytona）另见说明——需要 DAYTONA_API_KEY + 一个真实 snapshot 名。
//
// 运行：bun test packages/control-plane/src/sandbox/providers/daytona.test.ts

import { test, expect, describe } from 'bun:test';
import {
  DaytonaAuthenticationError,
  DaytonaConnectionError,
  DaytonaNotFoundError,
  DaytonaTimeoutError,
} from '@daytonaio/sdk';
import { DaytonaProvider, type DaytonaClientLike } from './daytona.ts';
import {
  SandboxAuthError,
  SandboxConfigError,
  SandboxTimeoutError,
  SandboxUnavailableError,
  SandboxValidationError,
} from '../errors.ts';
import { createLogger, type LogRecord } from '@aprog/log';
import type { DaytonaConfig } from '../config.ts';
import type { ImageRef, Resources, SandboxHandle } from '../types.ts';

const cfg: DaytonaConfig = {
  createTimeoutSec: 120,
  destroyTimeoutSec: 60,
  maxRetries: 2,
  autoStopIntervalMin: 30,
};
const res: Resources = { cpu: 2, memory: 4, disk: 10 };
const img: ImageRef = { provider: 'daytona', id: 'aprog-sandbox:abc123' };
const handle: SandboxHandle = { id: 'sb-1', provider: 'daytona', bindToken: 'tok' };

function capturing(): { logger: ReturnType<typeof createLogger>; recs: LogRecord[] } {
  const recs: LogRecord[] = [];
  return { logger: createLogger('test', {}, (r) => recs.push(r)), recs };
}

function provider(client: Partial<DaytonaClientLike>, logger = capturing().logger): DaytonaProvider {
  return new DaytonaProvider({
    config: cfg,
    controlPlaneUrl: 'https://cp.test',
    client: client as DaytonaClientLike,
    logger,
  });
}

describe('DaytonaProvider.create', () => {
  test('成功：返回 handle，注入 bindToken + 控制平面地址 + autoStop + timeout', async () => {
    let seen: { params: unknown; options: unknown } | undefined;
    const p = provider({
      create: async (params, options) => {
        seen = { params, options };
        return { id: 'sb-new' };
      },
    });
    const h = await p.create(img, res);

    expect(h.id).toBe('sb-new');
    expect(h.provider).toBe('daytona');
    expect(h.bindToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const params = seen!.params as Record<string, any>;
    expect(params.snapshot).toBe(img.id);
    expect(params.envVars.APROG_BIND_TOKEN).toBe(h.bindToken);
    expect(params.envVars.APROG_CONTROL_PLANE_URL).toBe('https://cp.test');
    expect(params.autoStopInterval).toBe(30);
    expect((seen!.options as Record<string, any>).timeout).toBe(120);
  });

  test('日志：发出 creating + created', async () => {
    const { logger, recs } = capturing();
    const p = provider({ create: async () => ({ id: 'sb-log' }) }, logger);
    await p.create(img, res);
    const msgs = recs.map((r) => r.msg);
    expect(msgs).toContain('creating sandbox');
    expect(msgs).toContain('sandbox created');
    const created = recs.find((r) => r.msg === 'sandbox created')!;
    expect(created.sandboxId).toBe('sb-log');
  });

  test('校验：image.provider 非 daytona → SandboxValidationError，且不调 SDK', async () => {
    let called = false;
    const p = provider({ create: async () => { called = true; return { id: 'x' }; } });
    await expect(p.create({ provider: 'e2b', id: 'y' } as ImageRef, res)).rejects.toBeInstanceOf(SandboxValidationError);
    expect(called).toBe(false);
  });

  test('校验：空 image.id → SandboxValidationError', async () => {
    const p = provider({ create: async () => ({ id: 'x' }) });
    await expect(p.create({ provider: 'daytona', id: '' }, res)).rejects.toBeInstanceOf(SandboxValidationError);
  });

  test('鉴权错误不重试：DaytonaAuthenticationError → SandboxAuthError，仅调一次', async () => {
    let calls = 0;
    const p = provider({ create: async () => { calls++; throw new DaytonaAuthenticationError('bad key'); } });
    await expect(p.create(img, res)).rejects.toBeInstanceOf(SandboxAuthError);
    expect(calls).toBe(1);
  });

  test('瞬态错误重试后成功：先 DaytonaConnectionError 再成功', async () => {
    let calls = 0;
    const p = provider({
      create: async () => {
        calls++;
        if (calls < 2) throw new DaytonaConnectionError('net blip');
        return { id: 'sb-retry' };
      },
    });
    const h = await p.create(img, res);
    expect(h.id).toBe('sb-retry');
    expect(calls).toBe(2);
  });

  test('瞬态错误耗尽重试：始终 DaytonaConnectionError → SandboxUnavailableError，调用 maxRetries+1 次', async () => {
    let calls = 0;
    const p = provider({ create: async () => { calls++; throw new DaytonaConnectionError('down'); } });
    await expect(p.create(img, res)).rejects.toBeInstanceOf(SandboxUnavailableError);
    expect(calls).toBe(cfg.maxRetries + 1);
  });

  test('超时映射：DaytonaTimeoutError → SandboxTimeoutError', async () => {
    const p = provider({ create: async () => { throw new DaytonaTimeoutError('slow'); } });
    await expect(p.create(img, res)).rejects.toBeInstanceOf(SandboxTimeoutError);
  });
});

describe('DaytonaProvider.destroy', () => {
  test('成功：get 后 delete，带 destroyTimeout', async () => {
    let gotId: string | undefined;
    let del: { id: string; timeout?: number } | undefined;
    const p = provider({
      get: async (id) => { gotId = id; return { id }; },
      delete: async (sb, timeout) => { del = { id: sb.id, timeout }; },
    });
    await p.destroy(handle);
    expect(gotId).toBe('sb-1');
    expect(del).toEqual({ id: 'sb-1', timeout: 60 });
  });

  test('幂等：沙箱已不在（DaytonaNotFoundError）→ 不抛、不调 delete', async () => {
    let delCalled = false;
    const p = provider({
      get: async () => { throw new DaytonaNotFoundError('gone'); },
      delete: async () => { delCalled = true; },
    });
    await expect(p.destroy(handle)).resolves.toBeUndefined();
    expect(delCalled).toBe(false);
  });

  test('校验：handle.provider 非 daytona → SandboxValidationError', async () => {
    const p = provider({});
    await expect(
      p.destroy({ id: 'x', provider: 'e2b', bindToken: 't' } as SandboxHandle),
    ).rejects.toBeInstanceOf(SandboxValidationError);
  });
});

describe('DaytonaProvider 构造', () => {
  test('无 client 且无 apiKey（含环境变量）→ SandboxConfigError', () => {
    const saved = process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_API_KEY;
    try {
      expect(() => new DaytonaProvider({ config: cfg, controlPlaneUrl: 'x' })).toThrow(SandboxConfigError);
    } finally {
      if (saved !== undefined) process.env.DAYTONA_API_KEY = saved;
    }
  });
});
