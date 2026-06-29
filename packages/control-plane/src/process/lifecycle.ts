// 进程生命周期事件扇出（内存）。
//
// 把 PCB 状态变更（spawned / waking / running / hibernating）实时广播给该用户的 SSE 订阅者，
// 是异步唤醒「running 回流前端」的承载：ProcessManager 每次 transition 经 notify 调 publish，
// 订阅该用户的 GET /proc/stream 即收到最新 PCB（见 api/sse.ts）。
//
// 与 stream/*（承载组① harness 的对话 Event、需 seq/落库/resync）刻意分开：生命周期只是少量状态增量，
// 无持久化、无回放——SSE 断线后前端自行重拉 GET /proc 兜底即可，不必重放。内存态，CP 重启即清。

import type { ProcessRecord } from './manager.ts';

interface Sub {
  userId: string;
  send: (rec: ProcessRecord) => void;
}

export class LifecycleHub {
  private readonly subs = new Set<Sub>();

  /** 订阅某用户的进程状态变更。返回退订函数（SSE 连接关闭时调用）。 */
  subscribe(userId: string, send: (rec: ProcessRecord) => void): () => void {
    const sub: Sub = { userId, send };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** 广播一条 PCB 变更，仅投递给其属主用户的订阅者。 */
  publish(rec: ProcessRecord): void {
    for (const sub of this.subs) {
      if (sub.userId !== rec.userId) continue;
      try {
        sub.send(rec);
      } catch {
        // 单个订阅者写入失败（连接已关）不影响其他订阅者。
      }
    }
  }
}
