import { createSignal } from 'solid-js';
import { api } from '../lib/api';

/* 进程（Process）——一个智能程序的一次运行，状态来自控制平面（/proc）。
   模型见 docs/data-model.html#process：状态只由「有没有关联沙箱」决定
   （spawned / running / hibernating），无终止态、状态永不删除。
   沙箱动作后端当前是 mock；这里只关心 PCB 的列表与生命周期。

   全局保存一份当前用户的进程列表；各程序窗口按 programId 过滤（processesFor）。
   生命周期调后端后用返回的最新 PCB 就地替换，列表是响应式的。 */

export type ProcessState = 'spawned' | 'running' | 'hibernating';

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
/** 拉取当前用户的进程列表（程序窗口打开时调用）。未认证/出错保留现状。 */
export async function loadProcesses(): Promise<void> {
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

/** wake：起沙箱 → running（mock）。 */
export async function wakeProcess(pid: number): Promise<ProcessRecord | undefined> {
  try {
    const rec = await api.post<ProcessRecord>(`/proc/${pid}/wake`);
    replace(rec);
    return rec;
  } catch (e) {
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
