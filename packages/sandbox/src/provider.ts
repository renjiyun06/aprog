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

/**
 * create 的运行时参数——由上层（控制平面网关）提供，承载「信任凭证归属」与「消除竞态」两件事：
 *
 *  - bindToken：本次沙箱的信任 nonce，**由控制平面侧生成并持有**（不是 provider 自造）。provider 只把它
 *    机械注入到 driver 的进程环境里。这样信任凭证的归属落在控制平面，provider 退成纯执行者。
 *
 *  - onProvisioned：沙箱「已起、driver 尚未启动」之间的回调（带回 sandboxId）。上层在此把
 *    bindToken→沙箱 登记进 DriverRegistry——**保证登记早于 driver 拨号**，根除「登记/拨号竞态」
 *    （否则 driver 自启即拨，可能早于上层登记，首拨落空）。provider 必须 await 它完成后才启动 driver。
 */
export interface CreateOptions {
  bindToken: string;
  onProvisioned?: (info: { sandboxId: string }) => void | Promise<void>;
}

export interface SandboxProvider {
  readonly id: ProviderId;
  /**
   * 起一个沙箱并在其内启动 driver。driver 不烘在镜像里——它随 create 运行时推入，并持
   * opts.bindToken（控制平面注入的信任凭证）拨回控制平面认领绑定（见 docs/interaction.html#trust）。
   * 实现必须在「沙箱已起、driver 未启」之间 await opts.onProvisioned，确保上层先完成登记再放 driver 拨号。
   */
  create(image: ImageRef, res: Resources, opts: CreateOptions): Promise<SandboxHandle>;
  /** 销毁沙箱、释放全部资源（即进程 hibernate 的落地）。状态早已经检查点落到控制平面。 */
  destroy(h: SandboxHandle): Promise<void>;
}
