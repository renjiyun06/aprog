// DeclarativeBaker 单测：用一个记录型假 ImageBuilder，验证策略骨架的步骤顺序与 finalize 入参，
// 完全不碰任何厂商 SDK。

import { test, expect, describe } from 'bun:test';
import { DeclarativeBaker } from './declarative.ts';
import type { ImageBuilder } from '../baker.ts';
import type { BakeSpec } from '../baker.ts';
import type { ImageRef, Resources } from '../types.ts';

type Call =
  | { op: 'base'; image: string }
  | { op: 'run'; cmd: string }
  | { op: 'copyDir'; local: string; dest: string }
  | { op: 'env'; vars: Record<string, string> }
  | { op: 'finalize'; name: string | undefined; res: Resources | undefined };

class RecordingBuilder implements ImageBuilder {
  calls: Call[] = [];
  base(image: string): void {
    this.calls.push({ op: 'base', image });
  }
  run(cmd: string): void {
    this.calls.push({ op: 'run', cmd });
  }
  copyDir(local: string, dest: string): void {
    this.calls.push({ op: 'copyDir', local, dest });
  }
  env(vars: Record<string, string>): void {
    this.calls.push({ op: 'env', vars });
  }
  async finalize(name: string | undefined, res: Resources | undefined): Promise<ImageRef> {
    this.calls.push({ op: 'finalize', name, res });
    return { provider: 'daytona', id: name ?? '(unnamed)' };
  }
}

const RES: Resources = { cpu: 2, memory: 4, disk: 10 };

const spec: BakeSpec = {
  name: 'aprog-sandbox:deadbeef',
  base: 'ubuntu:24.04',
  engines: ['npm i -g @anthropic-ai/claude-code', 'npm i -g @openai/codex'],
  localBins: ['./staging/bin', './staging/extra'],
  commands: ['chmod +x /opt/aprog/bin/*'],
  env: { PATH: '/opt/aprog/bin:$PATH' },
  resources: RES,
};

describe('DeclarativeBaker', () => {
  test('按 base → engines → localBins(→/opt/aprog/bin) → commands → env → finalize 顺序驱动 builder', async () => {
    const rec = new RecordingBuilder();
    const baker = new DeclarativeBaker(() => rec);
    const ref = await baker.bake(spec);

    expect(rec.calls).toEqual([
      { op: 'base', image: 'ubuntu:24.04' },
      { op: 'run', cmd: 'npm i -g @anthropic-ai/claude-code' },
      { op: 'run', cmd: 'npm i -g @openai/codex' },
      { op: 'copyDir', local: './staging/bin', dest: '/opt/aprog/bin' },
      { op: 'copyDir', local: './staging/extra', dest: '/opt/aprog/bin' },
      { op: 'run', cmd: 'chmod +x /opt/aprog/bin/*' },
      { op: 'env', vars: { PATH: '/opt/aprog/bin:$PATH' } },
      { op: 'finalize', name: 'aprog-sandbox:deadbeef', res: RES },
    ]);
    expect(ref).toEqual({ provider: 'daytona', id: 'aprog-sandbox:deadbeef' });
  });

  test('每次 bake 现取一个新 builder（工厂被调用）', async () => {
    let made = 0;
    const baker = new DeclarativeBaker(() => {
      made += 1;
      return new RecordingBuilder();
    });
    await baker.bake(spec);
    await baker.bake(spec);
    expect(made).toBe(2);
  });

  test('无 env 时不调 env()', async () => {
    const rec = new RecordingBuilder();
    const baker = new DeclarativeBaker(() => rec);
    await baker.bake({ ...spec, env: undefined });
    expect(rec.calls.some((c) => c.op === 'env')).toBe(false);
  });
});
