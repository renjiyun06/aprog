// @aprog/driver — 引擎驱动入口。常驻沙箱，按程序选定的引擎起对应 adapter。
// 当前仅定义模块接口，实现待定（见各文件内的 // ❓ 讨论点）。

export type { Driver, DriverDeps } from './driver.ts';
export type {
  DriverChannel,
  Welcome,
  EventFrame,
  InputItem,
  ControlSignal,
  ChannelError,
  FsRequest,
  FsResponse,
  FsEntry,
  BundleKind,
  BundleManifest,
  IncomingBundle,
} from './channel.ts';
export type { Sequencer } from './sequencer.ts';
export type { HarnessSupervisor, SpawnSpec, ExitStatus } from './supervisor.ts';
export type { FsServer } from './fs.ts';
export type { BundleIO, CheckpointBundle } from './bundle.ts';
export type { EngineAdapter, EngineContext } from './engine.ts';
export { ClaudeAdapter } from './engines/claude.ts';
export { CodexAdapter } from './engines/codex.ts';
export { scrubEngineEnv } from './engine-env.ts';
