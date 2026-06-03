// E2B 实现——aprog 的强隔离档（Firecracker microVM），也是验证本抽象的「第二家靶子」。
// 与 Daytona API 形状最像，但有内存快照：caps.memorySnapshot=true，
// 所以 hibernate 走内存 pause（~1s 唤醒），不必 tar-out 进程目录——同一个接口、不同形态。
// 烘镜像走 Build System 2.0（也属 DeclarativeBaker 一类，注入 localBins）。
//
// 现为 stub：先把接口验证立住，证明同一 SandboxProvider 能干净覆盖两家不同隔离/快照模型。

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

export class E2BProvider implements SandboxProvider {
  readonly id = 'e2b' as const;
  readonly caps: ProviderCaps = {
    pty: true,
    memorySnapshot: true, // 内存级 pause/resume → hibernate 可省去导出
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
