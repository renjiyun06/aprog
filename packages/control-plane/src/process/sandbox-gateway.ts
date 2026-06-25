// 沙箱网关：进程生命周期里所有「碰沙箱」的动作都经此接口收口。
// 真实实现 ProviderSandboxGateway 经任一 SandboxProvider（当前只 AgentBay 落地）起停沙箱、灌/取检查点；
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
 * 真实网关：经任一 SandboxProvider（Daytona / AgentBay 等）起停沙箱。provider-中立——靠注入的
 * provider 决定厂商，本类不绑定具体厂商。
 *  · create：程序版本 →（resolveImageRef）→ ImageRef → provider.create（注入 bindToken + 控制平面地址
 *    + 引擎鉴权）→ 按 bindToken 登记到 DriverRegistry，供 driver 拨入时认领绑定。
 *  · destroy：provider.destroy 释放沙箱；检查点走 git（沙箱侧），这里先回占位 ref。
 * ProcessManager 不变——它只认 SandboxGateway 接口。
 */
export class ProviderSandboxGateway implements SandboxGateway {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly registry: DriverRegistry,
    /** 程序 (id, version) → 已烘镜像的不透明引用（来自 ProgramCatalog.resolveImage + 命名约定）。 */
    private readonly resolveImageRef: (programId: string, programVersion: string | null) => ImageRef,
    /** create 名义资源（Daytona 把资源烘进 snapshot；AgentBay 由镜像设置定——这里仅作日志/契约）。 */
    private readonly resources: Resources,
  ) {}

  async create(p: { pid: number; programId: string; programVersion: string | null }): Promise<SandboxCreated> {
    const image = this.resolveImageRef(p.programId, p.programVersion);
    const handle = await this.provider.create(image, this.resources);
    this.registry.register(handle.bindToken, { pid: p.pid, sandboxId: handle.id });
    console.log(`[${this.provider.id}-sandbox] create pid=${p.pid} image=${image.id} → ${handle.id}（已登记 bindToken）`);
    return { sandboxId: handle.id, provider: handle.provider };
  }

  async destroy(p: { pid: number; sandboxId: string }): Promise<{ checkpointRef: string }> {
    // destroy 只需 id/provider（bindToken 不参与销毁）；检查点改走 git，这里先占位。
    await this.provider.destroy({ id: p.sandboxId, provider: this.provider.id, bindToken: '' });
    console.log(`[${this.provider.id}-sandbox] destroy pid=${p.pid} sandbox=${p.sandboxId}`);
    return { checkpointRef: `git-head-${p.pid}` };
  }
}
