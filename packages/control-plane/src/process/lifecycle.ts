// 进程生命周期 FSM：running ⇄ hibernating，以及 spawn / kill。
// 文件搬运全走 B 平面 DriverChannel（见 docs/interaction.html），A 平面只起停沙箱。
//
//   spawn      —— create 沙箱 → driver 自启拨入 → pushBundle 灌 bootstrap → driver 拉起 harness → running
//   hibernate  —— control('hibernate-prepare') + 末次检查点 + provider.destroy（让出全部资源，零厂商成本）→ hibernating（状态永不删）
//   wake       —— provider.create 新沙箱 + pushBundle 灌回最新检查点 + 按 state resume → running
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
