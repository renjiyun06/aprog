// 沙箱网关：进程生命周期里所有「碰沙箱」的动作都经此接口收口。
// 真实实现 ProviderSandboxGateway 经任一 SandboxProvider（当前只 PPIO 落地）起停沙箱、灌/取检查点；
// 未接真实沙箱时用 MockSandboxGateway 顶上。ProcessManager 的编排逻辑只认 SandboxGateway 接口，不随厂商变。

import type { ImageRef, Resources, SandboxProvider } from '@aprog/sandbox';
import type { DriverRegistry } from '../driver-channel/registry.ts';

export interface SandboxCreated {
  sandboxId: string;
  provider: string;
}

export interface SandboxGateway {
  /** 为进程起一个沙箱（wake / attach 首跑）。返回沙箱 id 与 provider。 */
  create(p: { pid: number; programId: string; programVersion: string | null }): Promise<SandboxCreated>;
  /** 释放进程的沙箱（hibernate / kill）。返回末次检查点引用。 */
  destroy(p: { pid: number; sandboxId: string }): Promise<{ checkpointRef: string }>;
}

/** Mock：不接真实沙箱，只造假标识，方便先把进程模型跑通。日志可观测每次起停。 */
export class MockSandboxGateway implements SandboxGateway {
  async create(p: { pid: number; programId: string; programVersion: string | null }): Promise<SandboxCreated> {
    const sandboxId = `mock-sbx-${p.pid}-${crypto.randomUUID().slice(0, 8)}`;
    console.log(`[mock-sandbox] create pid=${p.pid} program=${p.programId}@${p.programVersion ?? '-'} → ${sandboxId}`);
    return { sandboxId, provider: 'mock' };
  }

  async destroy(p: { pid: number; sandboxId: string }): Promise<{ checkpointRef: string }> {
    const checkpointRef = `mock-ckpt-${p.pid}-${crypto.randomUUID().slice(0, 8)}`;
    console.log(`[mock-sandbox] destroy pid=${p.pid} sandbox=${p.sandboxId} → checkpoint=${checkpointRef}`);
    return { checkpointRef };
  }
}

/**
 * 真实网关：经任一 SandboxProvider（当前 PPIO；AgentBay 暂时下线）起停沙箱。provider-中立——靠注入的
 * provider 决定厂商，本类不绑定具体厂商。
 *  · create：程序版本 →（resolveImageRef）→ ImageRef；**本层生成 bindToken（信任凭证归控制平面所有）**，
 *    经 opts 交给 provider 注入。provider 在「沙箱已起、driver 未启」时回调 onProvisioned，本层据 sandboxId
 *    把 bindToken 登记进 DriverRegistry——**登记早于 driver 拨号，竞态根除**。provider 只是机械执行者。
 *  · destroy：provider.destroy 释放沙箱；检查点走 git（沙箱侧），这里先回占位 ref。
 * ProcessManager 不变——它只认 SandboxGateway 接口。
 */
export class ProviderSandboxGateway implements SandboxGateway {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly registry: DriverRegistry,
    /** 程序 (id, version) → 已烘镜像的不透明引用（来自 ProgramCatalog.resolveImage + 命名约定）。 */
    private readonly resolveImageRef: (programId: string, programVersion: string | null) => ImageRef,
    /** create 名义资源（PPIO 经 SandboxOpts 决定，这里仅作日志/契约）。 */
    private readonly resources: Resources,
  ) {}

  async create(p: { pid: number; programId: string; programVersion: string | null }): Promise<SandboxCreated> {
    const image = this.resolveImageRef(p.programId, p.programVersion);
    // 信任凭证由本层（控制平面）生成并持有；provider 只负责注入。
    const bindToken = crypto.randomUUID();
    const handle = await this.provider.create(image, this.resources, {
      bindToken,
      // 沙箱已起、driver 未启时回调：此刻登记，确保 driver 拨号时一定查得到（竞态根除）。
      onProvisioned: ({ sandboxId }) => {
        this.registry.register(bindToken, { pid: p.pid, sandboxId });
        console.log(`[${this.provider.id}-sandbox] 登记 bindToken（driver 未启）pid=${p.pid} sandbox=${sandboxId}`);
      },
    });
    // 兜底：provider 若未回调 onProvisioned（理论不该），这里幂等补登一次（同键同值，无副作用）。
    this.registry.register(handle.bindToken, { pid: p.pid, sandboxId: handle.id });
    console.log(`[${this.provider.id}-sandbox] create pid=${p.pid} image=${image.id} → ${handle.id}`);
    return { sandboxId: handle.id, provider: handle.provider };
  }

  async destroy(p: { pid: number; sandboxId: string }): Promise<{ checkpointRef: string }> {
    // destroy 只需 id/provider（bindToken 不参与销毁）；检查点改走 git，这里先占位。
    await this.provider.destroy({ id: p.sandboxId, provider: this.provider.id, bindToken: '' });
    console.log(`[${this.provider.id}-sandbox] destroy pid=${p.pid} sandbox=${p.sandboxId}`);
    return { checkpointRef: `git-head-${p.pid}` };
  }
}
