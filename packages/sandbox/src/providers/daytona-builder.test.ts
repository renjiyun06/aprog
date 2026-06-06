// DaytonaImageBuilder 单测：注入一个假快照客户端，用真实 @daytonaio/sdk 的 Image，
// 验证动词翻译到 Dockerfile 的结果、finalize 的返回与校验。不打真实 Daytona、不需要凭据。

import { test, expect, describe } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Image } from '@daytonaio/sdk';
import { DaytonaImageBuilder, type DaytonaSnapshotClientLike } from './daytona-builder.ts';
import { SandboxValidationError } from '../errors.ts';
import { createLogger } from '@aprog/log';
import type { Resources } from '../types.ts';

const RES: Resources = { cpu: 2, memory: 4, disk: 10 };
const quietLog = createLogger('test', {}, () => {});
// 真实 SDK 的 addLocalDir 在调用时校验目录存在，故给个真实临时目录。
const STAGING = mkdtempSync(join(tmpdir(), 'aprog-bake-'));

interface Captured {
  name: string;
  image: Image;
  resources?: { cpu?: number; memory?: number; disk?: number; gpu?: number };
}

function fakeClient(): { client: DaytonaSnapshotClientLike; captured: () => Captured | undefined } {
  let cap: Captured | undefined;
  const client: DaytonaSnapshotClientLike = {
    snapshot: {
      async create(params) {
        cap = params;
        return { name: params.name };
      },
    },
  };
  return { client, captured: () => cap };
}

describe('DaytonaImageBuilder', () => {
  test('把 4 个动词翻成 Image，并 snapshot.create 注册命名镜像', async () => {
    const { client, captured } = fakeClient();
    const b = new DaytonaImageBuilder({ client, logger: quietLog });

    b.base('ubuntu:24.04');
    b.run('npm i -g @anthropic-ai/claude-code');
    b.copyDir(STAGING, '/opt/aprog/bin');
    b.run('chmod +x /opt/aprog/bin/*');
    b.env({ PATH: '/opt/aprog/bin:$PATH' });
    const ref = await b.finalize('aprog-sandbox:abc123', RES);

    // 返回不透明 ImageRef，id = snapshot 名
    expect(ref).toEqual({ provider: 'daytona', id: 'aprog-sandbox:abc123' });

    const c = captured();
    expect(c?.name).toBe('aprog-sandbox:abc123');
    expect(c?.resources).toEqual(RES);

    // 动词确实落进了 Image 的 Dockerfile
    const df = c!.image.dockerfile;
    expect(df).toContain('ubuntu:24.04');
    expect(df).toContain('npm i -g @anthropic-ai/claude-code');
    expect(df).toContain('chmod +x /opt/aprog/bin/*');
    expect(df).toContain('PATH');
  });

  test('finalize 无 name → SandboxValidationError（Daytona 无匿名镜像）', async () => {
    const { client } = fakeClient();
    const b = new DaytonaImageBuilder({ client, logger: quietLog });
    b.base('ubuntu:24.04');
    await expect(b.finalize(undefined, RES)).rejects.toBeInstanceOf(SandboxValidationError);
  });

  test('最后一次 base() 决定基础镜像', async () => {
    const { client, captured } = fakeClient();
    const b = new DaytonaImageBuilder({ client, logger: quietLog });
    b.base('ubuntu:24.04');
    b.base('debian:13'); // 覆盖
    await b.finalize('aprog-sandbox:x', RES);
    expect(captured()!.image.dockerfile).toContain('debian:13');
    expect(captured()!.image.dockerfile).not.toContain('ubuntu:24.04');
  });
});
