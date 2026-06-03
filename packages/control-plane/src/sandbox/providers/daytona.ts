// Daytona 实现——aprog 的默认档（容器级 + gVisor 隔离）。
// 烘镜像走 DeclarativeBaker（snapshot.create + addLocalDir）；运行时用 @daytona/sdk：
//   create ← daytona.create(CreateSandboxFromSnapshotParams)
//   exec   ← sandbox.process.exec
//   openPty← sandbox.process.createPty / connectPty（Daytona 一等支持）
//   inject/extract ← 文件上传/下载 API
//   hibernate ← 无内存快照 → 走 extractDir 导出进程目录（caps.memorySnapshot=false）

import type { SandboxProvider } from '../provider.ts';
import type {
  ProviderCaps,
  ImageRef,
  Resources,
  SandboxHandle,
  Dormant,
  ExecResult,
  PtySession,
} from '../types.ts';

export class DaytonaProvider implements SandboxProvider {
  readonly id = 'daytona' as const;
  readonly caps: ProviderCaps = {
    pty: true,
    memorySnapshot: false, // Daytona 无内存级恢复 → hibernate 走导出
    egressAllowlist: true,
  };

  create(image: ImageRef, res: Resources): Promise<SandboxHandle> { void image; void res; throw new Error('not implemented'); }
  destroy(h: SandboxHandle): Promise<void> { void h; throw new Error('not implemented'); }
  hibernate(h: SandboxHandle): Promise<Dormant> { void h; throw new Error('not implemented'); }
  wake(d: Dormant): Promise<SandboxHandle> { void d; throw new Error('not implemented'); }
  exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult> { void h; void cmd; throw new Error('not implemented'); }
  openPty(h: SandboxHandle, cmd: string[]): Promise<PtySession> { void h; void cmd; throw new Error('not implemented'); }
  injectDir(h: SandboxHandle, localTar: string, destPath: string): Promise<void> { void h; void localTar; void destPath; throw new Error('not implemented'); }
  extractDir(h: SandboxHandle, srcPath: string): Promise<string> { void h; void srcPath; throw new Error('not implemented'); }
}
