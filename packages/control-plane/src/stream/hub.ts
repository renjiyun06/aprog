// 事件流中枢 · 扇出。一条流可能有多个 viewer（多设备 / 多 tab）。
// hub 把 store 落库后的 live 事件广播给所有订阅者；订阅入口走 resync 保证不漏不重。

import type { Event } from '@aprog/protocol';

export interface StreamHub {
  /** 广播一个 live 事件给该进程的所有订阅者。 */
  publish(pid: number, event: Event): void;
  /** 注册一个 live 订阅者，返回退订函数。 */
  subscribe(pid: number, onEvent: (e: Event) => void): () => void;
}
