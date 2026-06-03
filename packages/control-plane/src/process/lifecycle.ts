// 进程生命周期 FSM：running ⇄ hibernating，以及 spawn / kill。
//
//   spawn      —— 建进程目录 + 起沙箱 + 注入 driver → running
//   hibernate  —— 快照进程目录 tar-out + 销毁沙箱 → hibernating（状态永不删）
//   wake       —— 起全新沙箱 + tar-in 快照 + driver 冷启动按 state resume → running
//   kill       —— 终止；目录与历史完整保留（退出只是没有沙箱关联）
//
// 关键：wake 绝不反向重建引擎上下文，只靠进程目录里的 state（见 docs/state.html）。

import type { ProcessRecord } from './manager.ts';

export interface Lifecycle {
  spawn(program: string, input: string): Promise<ProcessRecord>;
  hibernate(pid: number): Promise<void>;
  wake(pid: number): Promise<ProcessRecord>;
  kill(pid: number): Promise<void>;
}
