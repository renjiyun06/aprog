// 运行时控制面抽象。这半在各厂商间几乎一致（create/exec/pty/fs/destroy），
// 所以一个接口能干净覆盖 Daytona / E2B / Northflank / Fly… 差异由 caps 能力位吸收。
//
// 注意：本接口「不」管烘镜像——那步差异太大，单独交给 ImageBaker（见 baker.ts），
// 只通过 ImageRef 把结果喂进 create()。这是厂商隔离的关键切法。

import type {
  ProviderId,
  ImageRef,
  Resources,
  ProviderCaps,
  SandboxHandle,
  Dormant,
  ExecResult,
  PtySession,
} from './types.ts';

export interface SandboxProvider {
  readonly id: ProviderId;
  /** 该厂商支持哪些关键能力——上层据此分流（尤其 pty / memorySnapshot）。 */
  readonly caps: ProviderCaps;

  // ── 生命周期 ──────────────────────────────────────────────
  /** 用一个已烘好的镜像起沙箱。driver 已在镜像里，随沙箱常驻。 */
  create(image: ImageRef, res: Resources): Promise<SandboxHandle>;
  /** 销毁沙箱（状态由上层另行快照，见 persistence）。 */
  destroy(h: SandboxHandle): Promise<void>;

  /**
   * 休眠：按能力二选一——有 memorySnapshot 走内存快照，否则导出进程目录。
   * 返回的 Dormant 形态对调用方不透明，wake 按同形态还原。
   */
  hibernate(h: SandboxHandle): Promise<Dormant>;
  wake(d: Dormant): Promise<SandboxHandle>;

  // ── 执行 ──────────────────────────────────────────────────
  exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult>;
  /** 仅当 caps.pty。harness 交互桥接走这里。 */
  openPty(h: SandboxHandle, cmd: string[]): Promise<PtySession>;

  // ── 文件注入/导出（进程目录 tar-in / tar-out）────────────────
  /** 把本地 tar（进程目录快照）注入沙箱指定路径。 */
  injectDir(h: SandboxHandle, localTar: string, destPath: string): Promise<void>;
  /** 从沙箱导出某目录为本地 tar，返回路径。 */
  extractDir(h: SandboxHandle, srcPath: string): Promise<string>;
}
