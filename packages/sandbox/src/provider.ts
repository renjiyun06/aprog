// A 平面 · 资源平面抽象。把沙箱当一个「被托管的资源」来管。
//
// 当前需求下只需要两件事：create / destroy。理由：
//  - 进程 hibernate = 让出「全部」沙箱资源 = destroy（耐久靠控制平面检查点，零厂商成本；
//    不走 stop——stop 仍计 disk 费，违背「让出资源」的初衷）。wake = create 新沙箱 +
//    经 DriverChannel 灌回检查点。所以没有 provider 级的 hibernate/wake。
//  - 文件搬运、事件流、控制信号全走 B 平面 DriverChannel（见 ../driver-channel/），本接口不碰。
//  - exec / openPty / caps（pty·memorySnapshot·egressAllowlist）等先不引入——没有当前需求
//    驱动（YAGNI）。需要时（如快速唤醒、运维 shell、出站白名单）再按需加回。
//  - 烘镜像不在本层：镜像是仓库顶层 images/<名>/<版本>/bake.ts（见 docs/sandbox.html#bake），
//    只通过不透明 ImageRef 喂进 create。这是厂商隔离的切法。

import type { ProviderId, ImageRef, Resources, SandboxHandle } from './types.ts';

export interface SandboxProvider {
  readonly id: ProviderId;
  /**
   * 用一个已烘好的镜像起沙箱。driver 已烘在镜像里，随 entrypoint 自启并持烘入凭证
   * 拨回控制平面（见 docs/interaction.html#trust）；不需要本接口去启动它。
   */
  create(image: ImageRef, res: Resources): Promise<SandboxHandle>;
  /** 销毁沙箱、释放全部资源（即进程 hibernate 的落地）。状态早已经检查点落到控制平面。 */
  destroy(h: SandboxHandle): Promise<void>;
}
