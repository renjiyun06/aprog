// 沙箱网关：进程生命周期里所有「碰沙箱」的动作都经此接口收口。
// 真实实现会调 provider（Daytona 等）起停沙箱、灌/取检查点；当前还不对接沙箱，
// 用 MockSandboxGateway 顶上——只造可观测的假 sandbox_id / checkpoint_ref，不起真实算力。
// 接入沙箱时新增一个真实实现替换 Mock 即可，ProcessManager 的编排逻辑不动。

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
