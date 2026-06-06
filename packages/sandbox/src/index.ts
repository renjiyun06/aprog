// 沙箱层（A 平面）公共出口。上层（process/lifecycle、persistence）只从这里取，
// 永远不直接 import 某个厂商的实现——厂商隔离的边界就在这。
// B 平面的 DriverChannel 不在这层，见 ../driver-channel/。

export type {
  ProviderId,
  ImageRef,
  Resources,
  SandboxHandle,
} from './types.ts';
export type { SandboxProvider } from './provider.ts';
export type { ImageBaker, BakeSpec, ImageBuilder } from './baker.ts';
export type { DaytonaConfig } from './config.ts';

// 实现（按需挑选；上层通过工厂注入，不硬编码具体厂商）：
export { DaytonaProvider } from './providers/daytona.ts';
export { DaytonaImageBuilder } from './providers/daytona-builder.ts';
export { E2BProvider } from './providers/e2b.ts';
export { DeclarativeBaker } from './bakers/declarative.ts';
export { DockerfileBaker } from './bakers/dockerfile.ts';
export { SnapshotBaker } from './bakers/snapshot.ts';

// 烘镜像策略层 + 入口（构建期 / CLI 用；control-plane 运行时不依赖）。
export { bake, assembleSpec, pickBaker, contentHash } from './bake.ts';
export type { BakeRequest, BakeMode } from './bake.ts';
