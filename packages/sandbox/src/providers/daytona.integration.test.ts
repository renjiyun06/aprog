// DaytonaProvider 集成测试——打「真实」Daytona，会创建/销毁真实沙箱（产生费用）。
//
// 默认自动跳过：仅当设置了环境变量 DAYTONA_API_KEY 才运行（CI / 平时不受影响）。
// 可选 env：
//   APROG_TEST_SNAPSHOT   create 用的 snapshot 名（默认 daytona-small，账号里的通用 snapshot）
//   DAYTONA_API_URL / DAYTONA_TARGET  非默认时设置
// 运行：
//   DAYTONA_API_KEY=dtn_xxx bun test src/sandbox/providers/daytona.integration.test.ts

import { test, expect, describe } from 'bun:test';
import { DaytonaProvider } from './daytona.ts';
import { SandboxError } from '../errors.ts';
import type { DaytonaConfig } from '../config.ts';
import type { ImageRef, Resources } from '../types.ts';

const RUN = !!process.env.DAYTONA_API_KEY;
const SNAPSHOT = process.env.APROG_TEST_SNAPSHOT ?? 'daytona-small';

const cfg: DaytonaConfig = {
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET,
  createTimeoutSec: 120,
  destroyTimeoutSec: 60,
  maxRetries: 2,
  autoStopIntervalMin: 5, // 兜底：万一 destroy 没成，5 分钟自动停，别长期烧钱
};
const res: Resources = { cpu: 1, memory: 1, disk: 3 };

function newProvider(): DaytonaProvider {
  return new DaytonaProvider({ config: cfg, controlPlaneUrl: 'https://cp.integration.test' });
}

const suite = RUN ? describe : describe.skip;

suite('DaytonaProvider 集成（真实 Daytona）', () => {
  test(
    'create → destroy 往返，且 destroy 幂等',
    async () => {
      const p = newProvider();
      const img: ImageRef = { provider: 'daytona', id: SNAPSHOT };

      const h = await p.create(img, res);
      try {
        expect(h.provider).toBe('daytona');
        expect(h.id.length).toBeGreaterThan(0);
        expect(h.bindToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        // eslint-disable-next-line no-console
        console.log('[integration] created sandbox', h.id);
      } finally {
        await p.destroy(h);
      }
      // 已销毁，再 destroy 一次应仍成功（NotFound → 幂等）
      await expect(p.destroy(h)).resolves.toBeUndefined();
    },
    180_000,
  );

  test(
    '不存在的 snapshot → 抛 SandboxError（归一、不崩）',
    async () => {
      const p = newProvider();
      const bad: ImageRef = { provider: 'daytona', id: 'aprog-nonexistent-snapshot-zzz999' };
      await expect(p.create(bad, res)).rejects.toBeInstanceOf(SandboxError);
    },
    120_000,
  );
});
