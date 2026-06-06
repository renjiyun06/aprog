// Daytona 烘焙集成测试——打「真实」Daytona，会注册/删除真实 snapshot（云端构建，慢、产生费用）。
//
// 默认自动跳过：仅当设置了环境变量 DAYTONA_API_KEY 才运行（CI / 平时不受影响）。
// 走完整链路：bake() → assembleSpec(content-hash 命名) → DeclarativeBaker → DaytonaImageBuilder
//          → @daytonaio/sdk Image + snapshot.create。建完验 active、删除自清理，不留产物。
// 运行（从仓库根）：
//   env -u DAYTONA_API_KEY bun test src/providers/daytona-builder.integration.test.ts
//   （-u 去掉 shell 里可能残留的旧 key，让 bun 读 .env 的新 key）

import { test, expect, describe } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daytona } from '@daytonaio/sdk';
import { bake, assembleSpec, type BakeRequest } from '../bake.ts';

const RUN = !!process.env.DAYTONA_API_KEY;
const suite = RUN ? describe : describe.skip;

suite('Daytona 烘焙集成（真实 Daytona）', () => {
  test(
    'bake 全链路 → 注册 active snapshot；localBin 真被拷入；自清理',
    async () => {
      // staging 目录里放一个标记文件，下面用构建期命令断言它被拷进 /opt/aprog/bin。
      const staging = mkdtempSync(join(tmpdir(), 'aprog-bake-it-'));
      writeFileSync(join(staging, 'hello'), 'hi');

      const req: BakeRequest = {
        provider: 'daytona',
        mode: 'prod',
        base: 'alpine:3.20',
        engines: [], // 这里不装引擎，保持构建轻快
        localBins: [staging],
        // 构建期断言：localBin 没拷进来，这条 RUN 就失败 → snapshot.create 抛错 → 用例失败。
        commands: ['test -f /opt/aprog/bin/hello'],
        env: { APROG: '1' },
        resources: { cpu: 1, memory: 1, disk: 3 },
      };

      // content-hash 命名是纯函数，先算出名字以便校验与清理。
      const spec = assembleSpec(req);
      expect(spec.name).toBeDefined(); // ImageRef-always：恒有名

      const d = new Daytona({
        apiKey: process.env.DAYTONA_API_KEY,
        apiUrl: process.env.DAYTONA_API_URL,
        target: process.env.DAYTONA_TARGET,
      });

      // 预清理：若同名残留（上次失败/中断），先删，避免冲突。
      try {
        const stale = await d.snapshot.get(spec.name!);
        await d.snapshot.delete(stale);
      } catch {
        /* 不存在即可 */
      }

      const ref = await bake(req);
      try {
        // 返回不透明 ImageRef，id = content-hash snapshot 名
        expect(ref).toEqual({ provider: 'daytona', id: spec.name! });

        // 真在 Daytona 上、且构建成功（active）
        const snap = (await d.snapshot.get(spec.name!)) as { name?: string; state?: string };
        expect(snap.name).toBe(spec.name);
        expect(snap.state).toBe('active');
        // eslint-disable-next-line no-console
        console.log('[integration] baked snapshot', spec.name, 'state', snap.state);
      } finally {
        // 自清理：删掉刚烘的 snapshot，不留云端产物。
        const snap = await d.snapshot.get(spec.name!);
        await d.snapshot.delete(snap);
      }
    },
    300_000,
  );
});
