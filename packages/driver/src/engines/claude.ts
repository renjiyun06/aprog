// Claude Agent SDK → aprog 映射（见 docs/harness.html 的映射表）。
//
//   includePartialMessages:true 拿 stream_event（原生 Anthropic 流事件）
//   content_block_delta → item.delta（thinking_delta / text_delta / input_json_delta）
//   content_block_stop / 最终 assistant → item.end（coalesced 权威）
//   工具结果是另一条 user 消息(tool_use_result)，按 tool_use_id 回挂
//   id = message.id:block_index（工具用 tool_use.id）；seq、user echo 由 Driver 补

import type { Event } from '@aprog/protocol';
import type { EngineAdapter } from '../driver.ts';

export class ClaudeAdapter implements EngineAdapter {
  readonly name = 'claude' as const;

  async *run(prompt: string): AsyncIterable<Omit<Event, 'seq'>> {
    void prompt;
    throw new Error('not implemented');
  }
}
