// 沙箱层公共出口。上层（process/lifecycle、bridge、persistence）只从这里取，
// 永远不直接 import 某个厂商的实现——厂商隔离的边界就在这。

export type {
  ProviderId,
  ImageRef,
  Resources,
  ProviderCaps,
  SandboxHandle,
  Dormant,
  ExecResult,
  PtySession,
} from './types.ts';
export type { SandboxProvider } from './provider.ts';
export type { ImageBaker, BakeSpec } from './baker.ts';

// 实现（按需挑选；上层通过工厂注入，不硬编码具体厂商）：
export { DaytonaProvider } from './providers/daytona.ts';
export { E2BProvider } from './providers/e2b.ts';
export { DeclarativeBaker } from './bakers/declarative.ts';
export { DockerfileBaker } from './bakers/dockerfile.ts';
export { SnapshotBaker } from './bakers/snapshot.ts';
