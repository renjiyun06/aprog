// E2B 实现——aprog 的强隔离档（Firecracker microVM），也是验证本抽象的「第二家靶子」：
// 证明同一个 SandboxProvider 能干净覆盖两家不同隔离模型。烘镜像走 Build System 2.0
// （也属 DeclarativeBaker 一类，注入 localBins）。
//   create  ← E2B SDK 起 microVM
//   destroy ← kill（进程 hibernate 就是 destroy：让出全部资源）
// 文件搬运、事件流全走 DriverChannel（B 平面）。现为 stub。

import type { SandboxProvider } from '../provider.ts';
import type { ImageRef, Resources, SandboxHandle } from '../types.ts';

export class E2BProvider implements SandboxProvider {
  readonly id = 'e2b' as const;

  create(image: ImageRef, res: Resources): Promise<SandboxHandle> { void image; void res; throw new Error('not implemented'); }
  destroy(h: SandboxHandle): Promise<void> { void h; throw new Error('not implemented'); }
}
