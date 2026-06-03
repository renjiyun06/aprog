// Codex → aprog 映射（见 docs/harness.html 的映射表）。
//
//   对接 v2 item.* 词汇（codex exec --json / app-server），优先于 legacy EventMsg
//   item/.../delta → item.delta（agentMessage / reasoning / commandExecution.outputDelta）
//   item.completed → item.end
//   命令执行三段 begin→output_delta→end 归一成 command 项
//   CLI 无全局 seq → Driver 合成；Codex 原生回显 user_message，仍由 Driver 统一成 user 事件

import type { Event } from '@aprog/protocol';
import type { EngineAdapter } from '../driver.ts';

export class CodexAdapter implements EngineAdapter {
  readonly name = 'codex' as const;

  async *run(prompt: string): AsyncIterable<Omit<Event, 'seq'>> {
    void prompt;
    throw new Error('not implemented');
  }
}
