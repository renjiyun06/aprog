#!/usr/bin/env bun
// `aprog-bake` —— 烘镜像的命令行入口（构建期 / CI / dev 手动跑）。
//
// 它存在的意义就是把「打镜像」从 control-plane 运行时里拎出来：服务器不烘镜像，
// 由这个 CLI（或 CI 调它）烘，产物是命名 snapshot，服务器之后只按名字引用。
//
// 用法：
//   aprog-bake --provider daytona --mode prod
//   aprog-bake --provider e2b --mode dev --base ubuntu:24.04
//
// 注意：引擎安装命令 / localBins / 资源目前用占位默认。真正的「capability 清单 → staging/bin
// 组装」是后续工作（见 docs/sandbox.html「能力清单」），届时这里改成读清单。

import { createLogger } from '@aprog/log';
import { bake, assembleSpec, type BakeMode, type BakeRequest } from './bake.ts';
import type { ProviderId, Resources } from './types.ts';

const log = createLogger('bake-cli');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const PROVIDERS: readonly ProviderId[] = ['daytona', 'e2b', 'northflank', 'morph'];

function parseRequest(): BakeRequest {
  const provider = (arg('provider', 'daytona') ?? 'daytona') as ProviderId;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`unknown provider: ${provider} (want one of ${PROVIDERS.join(' / ')})`);
  }
  const mode = (arg('mode', 'dev') ?? 'dev') as BakeMode;
  if (mode !== 'dev' && mode !== 'prod') throw new Error(`mode must be dev|prod, got ${mode}`);

  // 占位默认——后续由 capability 清单驱动。
  const resources: Resources = { cpu: 2, memory: 4, disk: 10 };
  return {
    provider,
    mode,
    base: arg('base', 'ubuntu:24.04')!,
    engines: ['npm i -g @anthropic-ai/claude-code'],
    localBins: ['./staging/bin'],
    commands: ['chmod +x /opt/aprog/bin/*'],
    env: { PATH: '/opt/aprog/bin:$PATH' },
    resources,
  };
}

async function main(): Promise<void> {
  const req = parseRequest();
  const spec = assembleSpec(req);
  log.info('烘镜像计划', {
    provider: req.provider,
    mode: req.mode,
    name: spec.name ?? '(dev on-the-fly, 不命名)',
    base: spec.base,
  });
  const ref = await bake(req);
  log.info('烘成', { provider: ref.provider, id: ref.id });
}

main().catch((e: unknown) => {
  log.error('烘镜像失败', { err: e });
  process.exit(1);
});
