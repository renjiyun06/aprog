import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { SessionEvent } from '../components/ProgramShell';
import { api, getToken } from '../lib/api';

/* 单进程会话流。把控制平面的 harness 事件流接进会话区：
   · 上行：订 GET /proc/:pid/stream（SSE）→ 折叠 harness Event 成 ProgramShell 的 SessionEvent[]。
   · 下行：POST /proc/:pid/input。用户回显不本地塞——它由 driver echo 经同一条流回吐（单一数据源）。
   harness 词汇见 @aprog/protocol/harness；前端与后端包解耦，这里用最小结构化类型对齐。
   流式：item.start 开一条、item.delta 追加、item.end 落定全量。按 seq 幂等去重（EventSource 自动重连会重放，安全）。 */

type ItemType = 'thinking' | 'reply' | 'tool';
type ItemValue =
  | { item: 'thinking'; text: string }
  | { item: 'reply'; text: string }
  | { item: 'tool'; name: string; args: unknown; result?: unknown };
type HarnessEvent =
  | { kind: 'turn.start'; seq: number; turn: string }
  | { kind: 'turn.end'; seq: number; turn: string }
  | { kind: 'user'; seq: number; id: string; content: string }
  | { kind: 'item.start'; seq: number; id: string; item_type: ItemType }
  | { kind: 'item.delta'; seq: number; id: string; patch: { kind: 'text'; text: string } | { kind: 'tool_args'; partial_json: string } }
  | { kind: 'item.end'; seq: number; id: string; value: ItemValue };

/** 扁平渲染项（避免 Solid store 在联合类型深路径上的类型摩擦；对外再映射成 SessionEvent）。 */
interface RenderItem {
  kind: 'user' | 'agent' | 'thinking' | 'tool';
  text: string; // user/agent/thinking 的正文
  name?: string; // tool
  arg?: string; // tool 入参（累积 JSON 分片）
  result?: string; // tool 结果
}

const [items, setItems] = createStore<Record<number, RenderItem[]>>({});

/* 「等代理回复」态(按 pid)。用户发出输入即置 true,代理首个产出(item.start/任何流内容)到达即清。
   用于在对话区底部渲染等待动画——避免发完消息到首个 event 之间的空窗让用户以为卡死。
   存一个时间戳而非布尔:turn.end 后再发新消息能重新点亮(同一 pid 复用)。 */
const [awaiting, setAwaiting] = createSignal<Record<number, boolean>>({});
/** 某进程是否在等代理首个回复(响应式)。 */
export function isAwaitingReply(pid: number): boolean {
  return awaiting()[pid] ?? false;
}
function setAwaitingReply(pid: number, on: boolean): void {
  setAwaiting((m) => (Boolean(m[pid]) === on ? m : { ...m, [pid]: on }));
}

function toSessionEvent(it: RenderItem): SessionEvent {
  switch (it.kind) {
    case 'user':
      return { kind: 'user', body: it.text };
    case 'thinking':
      return { kind: 'thinking', body: it.text };
    case 'tool':
      return { kind: 'tool', name: it.name ?? '工具', arg: it.arg ?? '', result: it.result };
    default:
      return { kind: 'agent', body: it.text };
  }
}

/** 某进程的会话事件（响应式：在 memo/JSX 里调用即追踪）。 */
export function sessionEvents(pid: number): SessionEvent[] {
  return (items[pid] ?? []).map(toSessionEvent);
}

interface Book {
  index: Map<string, number>; // harness ItemId → 渲染数组下标
  cursor: number; // 已应用的最大 seq
  es?: EventSource;
}
const books = new Map<number, Book>();

function bookOf(pid: number): Book {
  let b = books.get(pid);
  if (b === undefined) {
    b = { index: new Map(), cursor: 0 };
    books.set(pid, b);
  }
  if (items[pid] === undefined) setItems(pid, []);
  return b;
}

function push(pid: number, it: RenderItem): number {
  const idx = (items[pid] ?? []).length;
  setItems(pid, idx, it);
  return idx;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function apply(pid: number, ev: HarnessEvent): void {
  const book = bookOf(pid);
  if (ev.seq <= book.cursor) return; // 幂等去重（at-least-once / 重连重放）
  book.cursor = ev.seq;
  // 代理侧任何「实质动静」(首个 item / turn 收尾)即灭等待动画;user 回显、turn.start 不灭(仍在等首个产出)。
  if (ev.kind !== 'user' && ev.kind !== 'turn.start') setAwaitingReply(pid, false);
  switch (ev.kind) {
    case 'user':
      push(pid, { kind: 'user', text: ev.content });
      return;
    case 'item.start': {
      const it: RenderItem =
        ev.item_type === 'thinking'
          ? { kind: 'thinking', text: '' }
          : ev.item_type === 'tool'
            ? { kind: 'tool', text: '', name: '…', arg: '' }
            : { kind: 'agent', text: '' };
      book.index.set(ev.id, push(pid, it));
      return;
    }
    case 'item.delta': {
      const idx = book.index.get(ev.id);
      if (idx === undefined) return;
      const patch = ev.patch;
      if (patch.kind === 'text') {
        const text = patch.text; // 提出窄化值（闭包内联合窄化会丢失）
        setItems(pid, idx, 'text', (t) => t + text);
      } else {
        const pj = patch.partial_json;
        setItems(pid, idx, 'arg', (a) => (a ?? '') + pj);
      }
      return;
    }
    case 'item.end': {
      const idx = book.index.get(ev.id);
      if (idx === undefined) return;
      const v = ev.value;
      if (v.item === 'tool') {
        setItems(pid, idx, 'name', v.name || '工具');
        setItems(pid, idx, 'arg', fmt(v.args));
        if (v.result !== undefined) setItems(pid, idx, 'result', fmt(v.result));
      } else {
        setItems(pid, idx, 'text', v.text); // 以合并全量落定（覆盖累积的 delta）
      }
      return;
    }
    default:
      return; // turn.* 第一批忽略
  }
}

/** 订阅某进程的事件流（幂等：已在订就跳过）。EventSource 不能设头，token 走 query。 */
export function attachSession(pid: number): void {
  const book = bookOf(pid);
  if (book.es !== undefined) return;
  const token = getToken();
  if (token === null) return;
  const es = new EventSource(`/cp-api/proc/${pid}/stream?from=${book.cursor}&token=${encodeURIComponent(token)}`);
  es.onmessage = (ev: MessageEvent): void => {
    try {
      apply(pid, JSON.parse(ev.data as string) as HarnessEvent);
    } catch {
      /* 心跳/坏帧：忽略 */
    }
  };
  // onerror 时 EventSource 自动重连（重放由 seq 去重兜底），保留连接。
  book.es = es;
}

/** 断开某进程的事件流。 */
export function detachSession(pid: number): void {
  const b = books.get(pid);
  if (b?.es !== undefined) {
    b.es.close();
    b.es = undefined;
  }
}

/** 投递用户输入。回显经事件流回吐，不本地塞。 */
export async function sendInput(pid: number, text: string): Promise<void> {
  const t = text.trim();
  if (t === '') return;
  setAwaitingReply(pid, true); // 立刻点亮等待动画(发出 → 首个 event 回来前)
  try {
    await api.post(`/proc/${pid}/input`, { text: t });
  } catch (e) {
    setAwaitingReply(pid, false); // 投递失败:灭动画(没有引擎产出会来)
    console.warn('[session] input failed:', e);
  }
}
