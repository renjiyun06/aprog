// 事件流中枢 · 扇出。一条流可能有多个 viewer（多设备 / 多 tab）。
// hub 把 store 落库后的 live 事件广播给所有订阅者；订阅入口走 resync 保证不漏不重。

import type { Event } from '@aprog/protocol';

export interface StreamHub {
  /** 广播一个 live 事件给该进程的所有订阅者。 */
  publish(pid: number, event: Event): void;
  /** 注册一个 live 订阅者，返回退订函数。 */
  subscribe(pid: number, onEvent: (e: Event) => void): () => void;
}

/** 内存实现：每进程一个订阅者集合。单订阅者回调抛错不影响其他订阅者。 */
export class MemoryStreamHub implements StreamHub {
  private readonly subs = new Map<number, Set<(e: Event) => void>>();

  publish(pid: number, event: Event): void {
    const set = this.subs.get(pid);
    if (set === undefined) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        // 单个订阅者异常隔离，不阻断其余扇出。
      }
    }
  }

  subscribe(pid: number, onEvent: (e: Event) => void): () => void {
    let set = this.subs.get(pid);
    if (set === undefined) {
      set = new Set();
      this.subs.set(pid, set);
    }
    set.add(onEvent);
    return () => {
      const s = this.subs.get(pid);
      if (s === undefined) return;
      s.delete(onEvent);
      if (s.size === 0) this.subs.delete(pid);
    };
  }
}
