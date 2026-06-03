// 持久化：进程目录快照。沙箱在时工作副本权威；沙箱不在时平台侧快照权威。
// hibernate/exit → tar-out 进程目录到 dataDir/proc/<pid>/；wake/attach → tar-in 注入新沙箱。
// 状态永不删除——退出只是没有沙箱关联，目录与历史完整保留（见 docs/state.html#snapshot）。

export interface SnapshotStore {
  /** 把沙箱导出的进程目录存为平台侧快照，返回快照路径。 */
  save(pid: number, dirPath: string): Promise<string>;
  /** 取某进程的快照路径，供 tar-in。 */
  load(pid: number): Promise<string>;
}
