// 进程编排：维护所有进程的 PCB（control-plane.sqlite 的 processes 表），是生命周期操作的入口。
// 一个「进程」= 一个 program 的一次运行，类比 OS 进程，目录在 ~/.aprog/<pid>/。
//
// 模型见 docs/data-model.html#process：
//   · 状态：spawned（刚建、从未起沙箱）/ waking（唤醒受理中：沙箱起中或 driver 未就绪的过渡态）/
//     running（沙箱已起、driver 已回报就绪）/ hibernating（无沙箱、留检查点）。
//   · 无终止态——跑完 / kill 都只是回到 hibernating，状态永不删除。
//   · phase/status 是程序内部 FSM 态，住进程目录 meta.yml，不进 PCB。
// 所有「碰沙箱」的动作经 SandboxGateway 收口；当前注入 MockSandboxGateway（未对接真实沙箱）。
// 进程目录 / 初始 input / 检查点内容的真正落盘属沙箱侧，mock 阶段不做——这里只动 PCB。
//
// 唤醒为异步（见 docs/proc-wake.html#async）：wake 立即把 PCB 置 waking 并返回，后台起沙箱；driver 握手、
// 部署程序与进程态、起引擎后回 Ready（driver-channel），经 markReady 才翻为 running。状态每次变更都经
// notify 回调扇出（LifecycleHub → SSE），前端据此把 waking→running 回流到 UI。

import type { Database } from 'bun:sqlite';
import type { SandboxGateway } from './sandbox-gateway.ts';
import type { RepoGateway } from './repo-gateway.ts';

export type ProcessState = 'spawned' | 'waking' | 'running' | 'hibernating';

/** 进程控制块（PCB）。权威内容态在进程目录；这里只放需要查询/编排的关系字段。
 *  无 commit 指针——「最新检查点」= 仓库 HEAD（可推导，见 docs/proc-storage.html#provisioning）。 */
export interface ProcessRecord {
  pid: number;
  name: string;
  userId: string;
  programId: string;
  programVersion: string | null;
  state: ProcessState;
  provider: string | null;
  sandboxId: string | null;
  /** 进程 git 仓库的实际 clone URL（spawn 建库时写入；建库前的瞬时窗口内可能为 null）。 */
  repoUrl: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

interface ProcessRow {
  pid: number;
  name: string;
  user_id: string;
  program_id: string;
  program_version: string | null;
  state: ProcessState;
  provider: string | null;
  sandbox_id: string | null;
  repo_url: string | null;
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
  repoUrl: r.repo_url,
  createdAt: r.created_at,
  lastActiveAt: r.last_active_at,
});

const now = (): string => new Date().toISOString();

export class ProcessManager {
  constructor(
    private readonly db: Database,
    private readonly sandbox: SandboxGateway,
    private readonly repos: RepoGateway,
    /** 状态变更扇出（LifecycleHub.publish）。默认空操作，便于测试/无流场景。 */
    private readonly notify: (rec: ProcessRecord) => void = () => {},
  ) {}

  /** 改 state（按需带 sandbox_id/provider/last_active_at）并扇出最新 PCB。集中收口所有状态迁移。 */
  private transition(pid: number, sql: string, params: unknown[]): ProcessRecord | undefined {
    this.db.query(sql).run(...(params as never[]));
    const rec = this.get(pid);
    if (rec !== undefined) this.notify(rec);
    return rec;
  }

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

  /** spawn：建 PCB 行（state=spawned，不起沙箱）+ 建私有 git 仓库（aprog-proc-<pid>）→ 回填 repo_url。
   *  pid 由 SQLite 自增（类比 OS pid）。建库失败则回滚 PCB 行（不留半成品）。沙箱仍 mock。 */
  async spawn(p: {
    userId: string;
    programId: string;
    programVersion: string | null;
    name: string;
  }): Promise<ProcessRecord> {
    const res = this.db
      .query(
        `INSERT INTO processes
           (name, user_id, program_id, program_version, state, provider, sandbox_id, repo_url, created_at, last_active_at)
         VALUES (?, ?, ?, ?, 'spawned', NULL, NULL, NULL, ?, NULL)`,
      )
      .run(p.name, p.userId, p.programId, p.programVersion, now());
    const pid = Number(res.lastInsertRowid);
    try {
      const { repoUrl } = await this.repos.create({ pid, programId: p.programId });
      this.db.query('UPDATE processes SET repo_url = ? WHERE pid = ?').run(repoUrl, pid);
    } catch (e) {
      this.db.query('DELETE FROM processes WHERE pid = ?').run(pid); // 建库失败：回滚 PCB 行
      throw e;
    }
    return this.get(pid)!;
  }

  /** wake：异步唤醒。立即置 waking 并返回（不等沙箱）；后台起沙箱，driver 就绪回 Ready 后经 markReady 翻 running。
   *  已 running / 已 waking 则幂等；进程不存在返回 undefined。 */
  async wake(pid: number): Promise<ProcessRecord | undefined> {
    const cur = this.get(pid);
    if (cur === undefined) return undefined;
    if (cur.state === 'running' || cur.state === 'waking') return cur;
    const waking = this.transition(
      pid,
      "UPDATE processes SET state = 'waking', last_active_at = ? WHERE pid = ?",
      [now(), pid],
    );
    void this.provision(pid, cur.state); // 后台起沙箱，不阻塞返回
    return waking;
  }

  /** 后台起沙箱（wake 的异步后半段）。成功则回填 sandbox_id/provider（状态保持 waking，待 Ready 翻 running）；
   *  失败则回滚到唤醒前的状态。mock 网关无真实 driver，延时自洽地模拟一次 Ready。 */
  private async provision(pid: number, prevState: ProcessState): Promise<void> {
    const cur = this.get(pid);
    if (cur === undefined || cur.state !== 'waking') return; // 期间被取消（hibernate/kill）
    try {
      const { sandboxId, provider } = await this.sandbox.create({
        pid,
        programId: cur.programId,
        programVersion: cur.programVersion,
      });
      const mid = this.get(pid);
      if (mid === undefined || mid.state !== 'waking') return; // 起沙箱期间被取消：不回填（避免悬挂沙箱标识）
      this.db.query('UPDATE processes SET sandbox_id = ?, provider = ? WHERE pid = ?').run(sandboxId, provider, pid);
      // mock 网关没有真实 driver 拨入/回 Ready：延时模拟一次，让 waking→running 闭环可观测。
      if (provider === 'mock') {
        setTimeout(() => this.markReady(pid), 900);
      }
    } catch (e) {
      console.warn(`[proc] wake 起沙箱失败 pid=${pid}，回滚至 ${prevState}：`, e);
      this.transition(pid, 'UPDATE processes SET state = ? WHERE pid = ?', [prevState, pid]);
    }
  }

  /** driver 握手并部署/起引擎完成后回 Ready 的入口：waking → running。
   *  仅在 waking 时翻转（防御误触）；已 running 幂等；其余状态忽略。 */
  markReady(pid: number): ProcessRecord | undefined {
    const cur = this.get(pid);
    if (cur === undefined) return undefined;
    if (cur.state === 'running') return cur;
    if (cur.state !== 'waking') {
      console.warn(`[proc] markReady 忽略：pid=${pid} 非 waking（state=${cur.state}）`);
      return cur;
    }
    return this.transition(
      pid,
      "UPDATE processes SET state = 'running', last_active_at = ? WHERE pid = ?",
      [now(), pid],
    );
  }

  /** hibernate：末次检查点 → 释放沙箱 → hibernating。非 running 则幂等。 */
  async hibernate(pid: number): Promise<ProcessRecord | undefined> {
    return this.release(pid);
  }

  /** kill / 完成：与 hibernate 同效——释放沙箱回到 hibernating，不产生终止态（状态永不删除）。 */
  async kill(pid: number): Promise<ProcessRecord | undefined> {
    return this.release(pid);
  }

  /** 释放沙箱回到 hibernating（hibernate 与 kill 共用）。无沙箱即幂等。
   *  亦覆盖唤醒中途取消（waking）：销毁已起的沙箱（若有），并让后台 provision 看到状态已变而停止回填。 */
  private async release(pid: number): Promise<ProcessRecord | undefined> {
    const cur = this.get(pid);
    if (cur === undefined) return undefined;
    if (cur.state !== 'running' && cur.state !== 'waking') return cur; // spawned/hibernating：无沙箱，幂等
    if (cur.sandboxId !== null) {
      await this.sandbox.destroy({ pid, sandboxId: cur.sandboxId }); // 检查点改走 git（沙箱侧，mock）；PCB 不存 commit 指针
    }
    return this.transition(
      pid,
      "UPDATE processes SET state = 'hibernating', sandbox_id = NULL, last_active_at = ? WHERE pid = ?",
      [now(), pid],
    );
  }
}
