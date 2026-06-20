// 进程编排：维护所有进程的 PCB（control-plane.sqlite 的 processes 表），是生命周期操作的入口。
// 一个「进程」= 一个 program 的一次运行，类比 OS 进程，目录在 ~/.aprog/<pid>/。
//
// 模型见 docs/data-model.html#process：
//   · 状态只由「有没有关联沙箱」决定：spawned（刚建、从未起沙箱）/ running（有沙箱）/ hibernating（无沙箱、留检查点）。
//   · 无终止态——跑完 / kill 都只是回到 hibernating，状态永不删除。
//   · phase/status 是程序内部 FSM 态，住进程目录 meta.yml，不进 PCB。
// 所有「碰沙箱」的动作经 SandboxGateway 收口；当前注入 MockSandboxGateway（未对接真实沙箱）。
// 进程目录 / 初始 input / 检查点内容的真正落盘属沙箱侧，mock 阶段不做——这里只动 PCB。

import type { Database } from 'bun:sqlite';
import type { SandboxGateway } from './sandbox-gateway.ts';

export type ProcessState = 'spawned' | 'running' | 'hibernating';

/** 进程控制块（PCB）。权威内容态在进程目录；这里只放需要查询/编排的关系字段。 */
export interface ProcessRecord {
  pid: number;
  name: string | null;
  userId: string;
  programId: string;
  programVersion: string | null;
  state: ProcessState;
  provider: string | null;
  sandboxId: string | null;
  checkpointRef: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

interface ProcessRow {
  pid: number;
  name: string | null;
  user_id: string;
  program_id: string;
  program_version: string | null;
  state: ProcessState;
  provider: string | null;
  sandbox_id: string | null;
  checkpoint_ref: string | null;
  created_at: string;
  last_active_at: string | null;
}

const view = (r: ProcessRow): ProcessRecord => ({
  pid: r.pid,
  name: r.name,
  userId: r.user_id,
  programId: r.program_id,
  programVersion: r.program_version,
  state: r.state,
  provider: r.provider,
  sandboxId: r.sandbox_id,
  checkpointRef: r.checkpoint_ref,
  createdAt: r.created_at,
  lastActiveAt: r.last_active_at,
});

const now = (): string => new Date().toISOString();

export class ProcessManager {
  constructor(
    private readonly db: Database,
    private readonly sandbox: SandboxGateway,
  ) {}

  /** ps：列出某用户的进程（新建在前）。 */
  list(userId: string): ProcessRecord[] {
    const rows = this.db
      .query('SELECT * FROM processes WHERE user_id = ? ORDER BY created_at DESC, pid DESC')
      .all(userId) as ProcessRow[];
    return rows.map(view);
  }

  /** 取单个进程的 PCB；不存在返回 undefined。 */
  get(pid: number): ProcessRecord | undefined {
    const r = this.db.query('SELECT * FROM processes WHERE pid = ?').get(pid) as ProcessRow | null;
    return r === null ? undefined : view(r);
  }

  /** spawn：建 PCB 行，state=spawned，不起沙箱。pid 由 SQLite 自增（类比 OS pid）。 */
  spawn(p: {
    userId: string;
    programId: string;
    programVersion: string | null;
    name?: string | null;
  }): ProcessRecord {
    const res = this.db
      .query(
        `INSERT INTO processes
           (name, user_id, program_id, program_version, state, provider, sandbox_id, checkpoint_ref, created_at, last_active_at)
         VALUES (?, ?, ?, ?, 'spawned', NULL, NULL, NULL, ?, NULL)`,
      )
      .run(p.name ?? null, p.userId, p.programId, p.programVersion, now());
    return this.get(Number(res.lastInsertRowid))!;
  }

  /** wake / attach 首跑：起沙箱 → running。已 running 则幂等；进程不存在返回 undefined。 */
  async wake(pid: number): Promise<ProcessRecord | undefined> {
    const cur = this.get(pid);
    if (cur === undefined) return undefined;
    if (cur.state === 'running') return cur;
    const { sandboxId, provider } = await this.sandbox.create({
      pid,
      programId: cur.programId,
      programVersion: cur.programVersion,
    });
    this.db
      .query("UPDATE processes SET state = 'running', sandbox_id = ?, provider = ?, last_active_at = ? WHERE pid = ?")
      .run(sandboxId, provider, now(), pid);
    return this.get(pid);
  }

  /** hibernate：末次检查点 → 释放沙箱 → hibernating。非 running 则幂等。 */
  async hibernate(pid: number): Promise<ProcessRecord | undefined> {
    return this.release(pid);
  }

  /** kill / 完成：与 hibernate 同效——释放沙箱回到 hibernating，不产生终止态（状态永不删除）。 */
  async kill(pid: number): Promise<ProcessRecord | undefined> {
    return this.release(pid);
  }

  /** 释放沙箱回到 hibernating（hibernate 与 kill 共用）。无沙箱即幂等。 */
  private async release(pid: number): Promise<ProcessRecord | undefined> {
    const cur = this.get(pid);
    if (cur === undefined) return undefined;
    if (cur.state !== 'running' || cur.sandboxId === null) return cur; // 已无沙箱：spawned/hibernating，幂等
    const { checkpointRef } = await this.sandbox.destroy({ pid, sandboxId: cur.sandboxId });
    this.db
      .query(
        "UPDATE processes SET state = 'hibernating', sandbox_id = NULL, checkpoint_ref = ?, last_active_at = ? WHERE pid = ?",
      )
      .run(checkpointRef, now(), pid);
    return this.get(pid);
  }
}
