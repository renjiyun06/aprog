// Claude Agent SDK ↔ aprog 适配（见 docs/harness.html 的映射表）。
//
//   下行：includePartialMessages:true 拿 stream_event（原生 Anthropic 流事件）
//         content_block_delta → item.delta（thinking_delta / text_delta / input_json_delta）
//         content_block_stop / 最终 assistant → item.end（coalesced 权威）
//         工具结果是另一条 user 消息(tool_use_result)，按 tool_use_id 回挂
//         id = message.id:block_index（工具用 tool_use.id）；seq、user echo 由 driver 补
//   上行：submit → 流式输入消息；interrupt → query.interrupt()
//   许可：start 时 permissionMode:'bypassPermissions'，引擎不触发 canUseTool，无审批往返

import type { Event } from '@aprog/protocol';
import type { EngineAdapter, EngineContext } from '../engine.ts';
import type { InputItem } from '../channel.ts';

export class ClaudeAdapter implements EngineAdapter {
  readonly name = 'claude' as const;

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
