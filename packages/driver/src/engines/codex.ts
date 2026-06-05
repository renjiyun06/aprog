// Codex ↔ aprog 适配（见 docs/harness.html 的映射表）。
//
//   下行：对接 v2 item.* 词汇（codex exec --json / app-server），优先于 legacy EventMsg
//         item/.../delta → item.delta（agentMessage / reasoning / commandExecution.outputDelta）
//         item.completed → item.end；命令执行三段 begin→output_delta→end 归一成 command 项
//         CLI 无全局 seq → driver 合成；Codex 原生回显 user_message，仍由 driver 统一成 user 事件
//   上行：submit / interrupt 映射到 Codex 对应的输入与控制原语
//   许可：start 时以全自动/跳过许可模式拉起，引擎不问、无审批往返

import type { Event } from '@aprog/protocol';
import type { EngineAdapter, EngineContext } from '../engine.ts';
import type { InputItem } from '../channel.ts';

export class CodexAdapter implements EngineAdapter {
  readonly name = 'codex' as const;

  async *start(ctx: EngineContext): AsyncIterable<Omit<Event, 'seq'>> {
    void ctx;
    throw new Error('not implemented');
  }

  async submit(item: InputItem): Promise<void> {
    void item;
    throw new Error('not implemented');
  }

  async interrupt(): Promise<void> {
    throw new Error('not implemented');
  }
}
