// 烘镜像的「策略/政策」层——aprog 私有的那部分知识，刻意跟通用 baker 分开。
//
// 关键立场（见 docs/sandbox.html）：打镜像是「构建期 / CLI」的事，不是 control-plane
// 运行时服务器在请求热路径上干的活。prod 下镜像早由 CI 烘成命名 snapshot，运行时只按
// 名字引用 ImageRef；dev 下才 on-the-fly 现烘。所以这一层（+ cli.ts）是 bake 的入口，
// control-plane 不依赖它，只依赖 provider 的 create/destroy。
//
// 这层负责三件 baker 接口本身不该知道的事：
//   1. 把 aprog 的高层意图（base / 引擎 / 本地产物 / 资源）组装成一份 BakeSpec；
//   2. 据 BakeSpec 算 content-hash → 命名（prod），或留空（dev on-the-fly）；
//   3. 据 provider 选对应的 baker 策略（declarative / dockerfile / snapshot）。

import type { ImageBaker, BakeSpec } from './baker.ts';
import type { ImageRef, ProviderId, Resources } from './types.ts';
import { DeclarativeBaker } from './bakers/declarative.ts';
import { DockerfileBaker } from './bakers/dockerfile.ts';
import { SnapshotBaker } from './bakers/snapshot.ts';
import { DaytonaImageBuilder } from './providers/daytona-builder.ts';

export type BakeMode = 'dev' | 'prod';

/** 烘一份 aprog 沙箱镜像的高层意图。policy 层据此组装 BakeSpec。 */
export interface BakeRequest {
  provider: ProviderId;
  /** dev=on-the-fly 不命名；prod=按 content-hash 命名注册永久 snapshot。 */
  mode: BakeMode;
  /** 基础镜像，钉死 tag。 */
  base: string;
  /** 引擎运行时安装命令（Claude Agent SDK / Codex …）。 */
  engines: string[];
  /** 本地已编好的 amd64 产物（staging/bin、driver），注入 /opt/aprog/bin。 */
  localBins: string[];
  /** 额外 RUN。 */
  commands?: string[];
  /** 环境变量（PATH 等）。 */
  env?: Record<string, string>;
  /** 资源规格（Daytona 烘进 snapshot）。 */
  resources: Resources;
}

/**
 * 按 provider 选 baker 策略。declarative 一个策略服务多家（Daytona / E2B 2.0 / Modal）——
 * 厂商无关，差异在各自 SDK，由 baker 内部按 provider 分流（见 bakers/declarative.ts 的「甲」方案）。
 */
export function pickBaker(provider: ProviderId): ImageBaker {
  switch (provider) {
    case 'daytona':
      return new DeclarativeBaker(() => new DaytonaImageBuilder());
    case 'e2b':
      // 同属 declarative，待补 E2BImageBuilder（copy / build+alias）。
      return new DeclarativeBaker(() => {
        throw new Error('E2B ImageBuilder 未实现（declarative builder TODO）');
      });
    case 'northflank':
      return new DockerfileBaker();
    case 'morph':
      return new SnapshotBaker();
  }
}

/**
 * 据规范化后的 BakeSpec 算内容哈希。Daytona 没有内置 content-hash / 不可变 tag，得自己算。
 * FNV-1a，无外部依赖、不碰 Date/random，纯函数 → 同输入同 tag、可复现。
 */
export function contentHash(spec: Omit<BakeSpec, 'name'>): string {
  const canonical = JSON.stringify(spec, Object.keys(spec).sort());
  // 双槽 FNV-1a 32-bit → 拼出 12 位十六进制
  const fnv = (seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const a = fnv(0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv(0x9dc5811c).toString(16).padStart(8, '0');
  return (a + b).slice(0, 12);
}

/** 把高层 BakeRequest 组装成 BakeSpec（含命名决策），不实际烘。 */
export function assembleSpec(req: BakeRequest): BakeSpec {
  const base: Omit<BakeSpec, 'name'> = {
    base: req.base,
    engines: req.engines,
    localBins: req.localBins,
    commands: req.commands ?? [],
    env: req.env,
    resources: req.resources,
  };
  // ImageRef-always：name 永远有值（Daytona 无匿名镜像；让 provider.create 的 ImageRef 契约统一）。
  // dev/prod 之分不在「有没有 name」，而在缓存/可变性策略——同一 content-hash 重烘即幂等覆盖。
  const name = `aprog-sandbox:${contentHash(base)}`;
  return { ...base, name };
}

/** 烘镜像入口：组装 spec → 选 baker → bake，返回不透明 ImageRef。 */
export async function bake(req: BakeRequest): Promise<ImageRef> {
  const spec = assembleSpec(req);
  const baker = pickBaker(req.provider);
  return baker.bake(spec);
}
