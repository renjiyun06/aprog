import { createStore, produce } from 'solid-js/store';
import { createMemo } from 'solid-js';

/* ──────────────────────────────────────────────────────────────────────
   Demo notification center — NO backend. Stand-in for GET /notifications,
   /notifications/stream (SSE), POST /notifications/read. Seeded with a few
   items so the bell + flyout + toast are visible. Swap pushNotif()/markRead()
   for API calls when the backend lands.
   ──────────────────────────────────────────────────────────────────────── */

export type NotifType = 'share' | 'reply' | 'action';

export interface Notif {
  id: string;
  type: NotifType;
  title: string;
  body?: string;
  /** related process (click → attach) */
  procId?: number;
  ts: string;   // display string (demo); real one is ISO + relative-formatted
  read: boolean;
}

interface NState {
  items: Notif[];
  /** ids currently shown as bottom-right toasts */
  toasts: string[];
}

const nextId = (() => { let i = 100; return () => `n${++i}`; })();

const [store, setStore] = createStore<NState>({
  items: [
    { id: 'n1', type: 'share', title: 'Ada 把「官网重设计」分享给你', body: '你现在可以参与这个进程', procId: 1024, ts: '刚刚', read: false },
    { id: 'n2', type: 'reply', title: '「后台改版」有新回复', procId: 1025, ts: '2 分钟前', read: false },
    { id: 'n3', type: 'action', title: '「数据迁移」需要你确认一个操作', procId: 1026, ts: '12 分钟前', read: true },
  ],
  toasts: ['n2'],   // demo: show one toast on load (auto-dismissed by <Toasts/>)
});

export const notifications = store;

export const unreadCount = createMemo(() => store.items.reduce((n, x) => n + (x.read ? 0 : 1), 0));

export function markAllRead() {
  setStore('items', produce((items) => { for (const it of items) it.read = true; }));
}

export function markRead(id: string) {
  setStore('items', (x) => x.id === id, 'read', true);
}

export function dismissToast(id: string) {
  setStore('toasts', (t) => t.filter((x) => x !== id));
}

/** Add a notification + flash it as a toast for a few seconds (demo of SSE push). */
export function pushNotif(n: Omit<Notif, 'id' | 'read'>) {
  const id = nextId();
  setStore(produce((s) => {
    s.items.unshift({ ...n, id, read: false });
    s.toasts.push(id);
  }));
  setTimeout(() => dismissToast(id), 5000);
  return id;
}
