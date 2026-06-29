import { createSignal } from 'solid-js';
import { api, getToken } from '../lib/api';

/* 进程（Process）——一个智能程序的一次运行，状态来自控制平面（/proc）。
   模型见 docs/data-model.html#process：
   spawned（刚建）/ waking（唤醒受理中：沙箱起中或 driver 未就绪的过渡态）/ running（沙箱已起、driver 就绪）/
   hibernating（无沙箱、留检查点）。无终止态、状态永不删除。

   全局保存一份当前用户的进程列表；各程序窗口按 programId 过滤（processesFor）。
   唤醒是异步的：点击后乐观置 waking，后端立即返回 waking，待 driver 就绪经账号级 SSE（/proc/stream）
   推回 running，订阅在此就地合并。生命周期调用与推送都汇到同一个 replace/merge，列表是响应式的。 */

export type ProcessState = 'spawned' | 'waking' | 'running' | 'hibernating';

export interface ProcessRecord {
  pid: number;
  name: string;
  userId: string;
  programId: string;
  programVersion: string | null;
  state: ProcessState;
  provider: string | null;
  sandboxId: string | null;
  /** 进程 git 仓库的 clone URL（spawn 建库时由后端写入）。 */
  repoUrl: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

const [procs, setProcs] = createSignal<ProcessRecord[]>([]);

/** 当前用户的全部进程（响应式）。 */
export const allProcesses = procs;

/** 某程序的进程（按 programId 过滤）。 */
export function processesFor(programId: string): ProcessRecord[] {
  return procs().filter((p) => p.programId === programId);
}

let loaded = false;
/** 拉取当前用户的进程列表（程序窗口打开时调用）。未认证/出错保留现状。顺带确保生命周期流已订阅。 */
export async function loadProcesses(): Promise<void> {
  ensureLifecycleStream();
  try {
    const { items } = await api.get<{ items: ProcessRecord[] }>('/proc');
    setProcs(items);
    loaded = true;
  } catch (e) {
    if (!loaded) setProcs([]);
    console.warn('[proc] load failed:', e);
  }
}

const replace = (rec: ProcessRecord): void => { setProcs((list) => list.map((p) => (p.pid === rec.pid ? rec : p))); };

/** 合并一条来自 SSE 的 PCB：存在则就地替换，不存在则插入（容纳其他窗口/会话新建的进程）。 */
const merge = (rec: ProcessRecord): void => {
  setProcs((list) => (list.some((p) => p.pid === rec.pid) ? list.map((p) => (p.pid === rec.pid ? rec : p)) : [rec, ...list]));
};

// ── 账号级生命周期流（SSE）：driver 就绪后把 waking→running 回流到 UI ──────────────
let es: EventSource | undefined;
let streamToken: string | null = null;

/** 确保已订阅 /proc/stream。EventSource 不能设 header，token 走 query。token 变化则重订阅。 */
function ensureLifecycleStream(): void {
  const token = getToken();
  if (token === null) return;
  if (es !== undefined && streamToken === token) return;
  if (es !== undefined) es.close();
  streamToken = token;
  es = new EventSource(`/cp-api/proc/stream?token=${encodeURIComponent(token)}`);
  // 生命周期流「推一次、无回放」：每次（重）连都重拉 GET /proc 全量兜底——
  // 否则 running 等状态变更若落在断连/重连窗口里就永久丢失（前端卡在 waking）。
  es.onopen = (): void => { void loadProcesses(); };
  es.onmessage = (ev: MessageEvent): void => {
    try {
      merge(JSON.parse(ev.data as string) as ProcessRecord);
    } catch {
      /* 非 JSON（注释/心跳帧）：忽略 */
    }
  };
  // onerror 时 EventSource 自动重连（重连后 onopen 会重拉兜底）；保留连接，不主动关闭。
}

// ── waking 期轮询兜底（不依赖 SSE 投递）──────────────────────────────────
// 唤醒是异步的，running 靠生命周期流推回。万一推送丢失，这层定时重拉 GET /proc：
// 只要还有进程 waking 就每 2.5s 拉一次，拿到终态即停；总时长封顶防 stuck-waking 死轮询。
let wakePoll: ReturnType<typeof setInterval> | undefined;
let wakePollUntil = 0;
const anyWaking = (): boolean => procs().some((p) => p.state === 'waking');

function startWakingPoll(): void {
  wakePollUntil = Date.now() + 120_000; // 最多兜 2 分钟
  if (wakePoll !== undefined) return;
  wakePoll = setInterval(() => {
    if (Date.now() > wakePollUntil || !anyWaking()) {
      clearInterval(wakePoll);
      wakePoll = undefined;
      return;
    }
    void loadProcesses();
  }, 2500);
}

/** 登出时断开生命周期流（auth 调用）。 */
export function closeLifecycleStream(): void {
  if (es !== undefined) es.close();
  es = undefined;
  streamToken = null;
}

/** spawn：建进程（state=spawned，不起沙箱；后端建私有 git 仓库并回填 repoUrl）。name 必填。失败返回 undefined。 */
export async function spawnProcess(programId: string, name: string): Promise<ProcessRecord | undefined> {
  const trimmed = name.trim();
  if (trimmed === '') {
    console.warn('[proc] spawn 取消：name 必填');
    return undefined;
  }
  try {
    const rec = await api.post<ProcessRecord>('/proc', { programId, name: trimmed });
    setProcs((list) => [rec, ...list]);
    return rec;
  } catch (e) {
    console.warn('[proc] spawn failed:', e);
    return undefined;
  }
}

/** wake：异步唤醒。乐观置 waking（点击即时反馈）；后端立即返回 waking，待 driver 就绪经 SSE 推回 running。
 *  失败则回滚到 hibernating。 */
export async function wakeProcess(pid: number): Promise<ProcessRecord | undefined> {
  setProcs((list) => list.map((p) => (p.pid === pid ? { ...p, state: 'waking' as const } : p)));
  startWakingPoll(); // SSE 推送丢失时的兜底：轮询 GET /proc 直到拿到终态
  try {
    const rec = await api.post<ProcessRecord>(`/proc/${pid}/wake`);
    replace(rec); // 通常仍是 waking；running 经 SSE 回流
    return rec;
  } catch (e) {
    setProcs((list) => list.map((p) => (p.pid === pid ? { ...p, state: 'hibernating' as const } : p)));
    console.warn('[proc] wake failed:', e);
    return undefined;
  }
}

/** hibernate：释放沙箱 → hibernating（mock）。 */
export async function hibernateProcess(pid: number): Promise<ProcessRecord | undefined> {
  try {
    const rec = await api.post<ProcessRecord>(`/proc/${pid}/hibernate`);
    replace(rec);
    return rec;
  } catch (e) {
    console.warn('[proc] hibernate failed:', e);
    return undefined;
  }
}

/** kill / 完成：与 hibernate 同效，回到 hibernating（无终止态）。 */
export async function killProcess(pid: number): Promise<ProcessRecord | undefined> {
  try {
    const rec = await api.post<ProcessRecord>(`/proc/${pid}/kill`);
    replace(rec);
    return rec;
  } catch (e) {
    console.warn('[proc] kill failed:', e);
    return undefined;
  }
}
