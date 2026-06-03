// @aprog/driver — 引擎驱动入口。常驻沙箱，按程序选定的引擎起对应 adapter。

export type { Driver, EngineAdapter } from './driver.ts';
export type { DriverChannel, ControlSignal, InputItem } from './channel.ts';
export { ClaudeAdapter } from './engines/claude.ts';
export { CodexAdapter } from './engines/codex.ts';
