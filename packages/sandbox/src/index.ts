// 沙箱层（A 平面）公共出口。上层（control-plane）只从这里取「运行时那半」，
// 永远不直接 import 某个厂商的实现——厂商隔离的边界就在这。
// 打镜像不在这里：它是仓库顶层 images/<名>/<版本>/bake.ts，由 tools/bake 的 aprog-bake 跑（见 docs/sandbox.html#bake）。
// B 平面的 DriverChannel 也不在这层，见 control-plane 的 driver-channel/。

export type { ProviderId, ImageRef, Resources, SandboxHandle } from './types.ts';
export type { SandboxProvider } from './provider.ts';

// 运行时 provider 实现（上层通过工厂注入，不硬编码具体厂商）。
// 多供应商是这层的设计形态：SandboxProvider 接口 + provider-中立网关 + ProviderId 联合类型构成扩展点；
// 当前现实只接得了 AgentBay（出站开放），故唯一落地实现是它。新增供应商在此追加一个 export 即可。
export { AgentBayProvider, type AgentBayProviderDeps } from './providers/agentbay.ts';
