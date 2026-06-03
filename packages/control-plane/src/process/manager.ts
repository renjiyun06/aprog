// 进程编排：维护所有进程的 PCB，是生命周期操作的入口。
// 一个「进程」= 一个 program 的一次运行，类比 OS 进程，目录在 ~/.aprog/<pid>/。

import type { Config } from '../config.ts';

export type ProcessState = 'running' | 'hibernating';

/** 进程控制块（PCB）。权威状态在进程目录的 meta.yml，这里是内存视图。 */
export interface ProcessRecord {
  pid: number;
  /** 钉死的程序名 + 版本（进程运行绑定具体版本，永不自动升级，见 docs/data-model.html）。 */
  program: string;
  programVersion: string;
  state: ProcessState;
  sandboxId?: string; // running 时关联，hibernating 时为空
  startedAt: string;
}

export class ProcessManager {
  constructor(private readonly config: Config) {}

  // 生命周期动词（见 process/lifecycle.ts 的实现意图）：
  // spawn / hibernate / wake / kill —— 现为占位。
  list(): ProcessRecord[] {
    throw new Error('not implemented');
  }
}
