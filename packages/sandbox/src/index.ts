// 沙箱层（A 平面）公共出口。上层（control-plane）只从这里取「运行时那半」，
// 永远不直接 import 某个厂商的实现——厂商隔离的边界就在这。
// 打镜像不在这里：它是仓库顶层 images/<名>/<版本>/bake.ts，由 aprog-bake 跑（见 docs/sandbox.html#bake）。
// B 平面的 DriverChannel 也不在这层，见 control-plane 的 driver-channel/。

export type { ProviderId, ImageRef, Resources, SandboxHandle } from './types.ts';
export type { SandboxProvider } from './provider.ts';
export type { DaytonaConfig } from './config.ts';

// 运行时 provider 实现（上层通过工厂注入，不硬编码具体厂商）：
export { DaytonaProvider } from './providers/daytona.ts';
export { E2BProvider } from './providers/e2b.ts';
