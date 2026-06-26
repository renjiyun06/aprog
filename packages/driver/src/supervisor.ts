// HarnessSupervisor · 进程监管（引擎无关）。docs/interaction.html「driver 是 harness 的父进程」。
// 只管「它是一个子进程」的 OS 机制：拉起、读写其标准流、探退出、kill。
// 「写什么字节、读出的字节什么含义」属于 EngineAdapter——这条缝见讨论①。

export interface SpawnSpec {
  /** 子进程工作目录 = 进程目录。 */
  cwd: string;
  /** 引擎特定命令行（由 EngineAdapter 给：claude --include-partial… / codex exec --json…）。 */
  argv: string[];
  /**
   * 引擎子进程环境。**必须**经 scrubEngineEnv（见 engine-env.ts）清洗后再放进来——
   * driver 私有的 bindToken / 控制平面地址 / git 凭证绝不可落到引擎或用户程序手里。
   * 该交给引擎的 GLM 路由（ANTHROPIC_*）会被清洗器保留。
   */
  env?: Record<string, string>;
}

export interface ExitStatus {
  code: number | null;
  signal: string | null;
}

export interface HarnessSupervisor {
  /** 按 spec 拉起 harness 子进程。 */
  spawn(spec: SpawnSpec): Promise<void>;

  /** 子进程原生输出流，交给 EngineAdapter 翻译。 */
  readonly stdout: AsyncIterable<Uint8Array>;

  /** 写子进程 stdin。
   *  ❓ 输入到底走 stdin 流，还是 driver 写 input.md 由 harness watch？见讨论②——
   *     若走文件，本方法不被使用，输入改由 BundleIO/文件落盘那条路。 */
  writeStdin(bytes: Uint8Array): Promise<void>;

  /** 探退出。 */
  wait(): Promise<ExitStatus>;

  /** 终止子进程（进程级信号）。注意：interrupt「打断当前回合」不是这个，它是带内、归 adapter。 */
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}
