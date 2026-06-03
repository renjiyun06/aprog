// 持久化：进程状态检查点。见 docs/state.html#checkpoint。
//
// 沙箱本地盘随时可能没（厂商回收 / OOM / 崩溃）。耐久性靠检查点——在 quiescent 点
// （harness 回复完、等输入）由 driver 经 DriverChannel.pullBundle 把进程目录的 state 子集
// 流回控制平面，存到 dataDir/proc/<pid>/。检查点何时做是「平台/driver」的事（按配置 +
// harness hook），不归上层程序控制。
//
// 检查点存在控制平面、天生跨厂商——唤醒/迁移就是「起沙箱 + pushBundle 灌回」。
// 状态永不删除：退出只是没有沙箱关联，目录与历史完整保留。

export interface CheckpointStore {
  /** 存一份检查点（DriverChannel.pullBundle 拿到的 state 子集 tar），返回检查点路径。 */
  save(pid: number, bundle: Uint8Array): Promise<string>;
  /** 取某进程的最新检查点，供唤醒时 pushBundle 灌回新沙箱。 */
  loadLatest(pid: number): Promise<Uint8Array>;
}
