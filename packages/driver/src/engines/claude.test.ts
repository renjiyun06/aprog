// Claude 转换核 · 金标测试。喂一段录制的原生流(fixture)，断言产出的 aprog 草稿事件(golden)。
// 不起任何引擎、不连网——纯函数 in/out。Claude SDK 升级或 adapter 改动若改变产出，这里立刻飘红。
//
// 用例 = docs/protocol.html#example 的「登录调试」一轮：thinking → Grep 工具 → reply → turn.end。

import { test, expect } from 'bun:test';
import { runTransducer } from '../engine.ts';
import type { DraftEvent } from '../engine.ts';
import { claudeTransduce, claudeInit } from './claude.ts';
import type { ClaudeNative } from './claude.ts';

const fixture: ClaudeNative[] = [
  { type: 'message_start', message: { id: 'msg_a' } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先翻登录' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '相关代码' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'Eq' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'Grep' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'login"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '是 token ' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '过期判断写反了。' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'result', subtype: 'success', usage: { input_tokens: 1840, output_tokens: 210 } },
];

const golden: DraftEvent[] = [
  { kind: 'turn.start', turn: 't1' },
  { kind: 'item.start', id: 'msg_a:0', item_type: 'thinking' },
  { kind: 'item.delta', id: 'msg_a:0', patch: { kind: 'text', text: '先翻登录' } },
  { kind: 'item.delta', id: 'msg_a:0', patch: { kind: 'text', text: '相关代码' } },
  { kind: 'item.end', id: 'msg_a:0', value: { item: 'thinking', text: '先翻登录相关代码', signature: 'Eq' } },
  { kind: 'item.start', id: 'toolu_01', item_type: 'tool' },
  { kind: 'item.delta', id: 'toolu_01', patch: { kind: 'tool_args', partial_json: '{"q":"' } },
  { kind: 'item.delta', id: 'toolu_01', patch: { kind: 'tool_args', partial_json: 'login"}' } },
  { kind: 'item.end', id: 'toolu_01', value: { item: 'tool', name: 'Grep', args: { q: 'login' } } },
  { kind: 'item.start', id: 'msg_a:2', item_type: 'reply' },
  { kind: 'item.delta', id: 'msg_a:2', patch: { kind: 'text', text: '是 token ' } },
  { kind: 'item.delta', id: 'msg_a:2', patch: { kind: 'text', text: '过期判断写反了。' } },
  { kind: 'item.end', id: 'msg_a:2', value: { item: 'reply', text: '是 token 过期判断写反了。' } },
  { kind: 'turn.end', turn: 't1', stop_reason: 'completed', raw_stop_reason: 'end_turn', usage: { input: 1840, output: 210 } },
];

test('claude: 一轮交互(thinking/tool/reply) 折叠成 golden 流', () => {
  expect(runTransducer(claudeTransduce, fixture, claudeInit)).toEqual(golden);
});

test('claude: stop_reason 归一 — max_tokens → limit', () => {
  const out = runTransducer(
    claudeTransduce,
    [
      { type: 'message_start', message: { id: 'm' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
      { type: 'result', subtype: 'success' },
    ],
    claudeInit,
  );
  const end = out.find((e) => e.kind === 'turn.end');
  expect(end).toMatchObject({ stop_reason: 'limit', raw_stop_reason: 'max_tokens' });
});

test('claude: stop_reason 归一 — error_max_turns → limit, refusal → refused', () => {
  const limit = runTransducer(
    claudeTransduce,
    [{ type: 'message_start', message: { id: 'm' } }, { type: 'result', subtype: 'error_max_turns' }],
    claudeInit,
  ).find((e) => e.kind === 'turn.end');
  expect(limit).toMatchObject({ stop_reason: 'limit', raw_stop_reason: 'error_max_turns' });

  const refused = runTransducer(
    claudeTransduce,
    [
      { type: 'message_start', message: { id: 'm' } },
      { type: 'message_delta', delta: { stop_reason: 'refusal' } },
      { type: 'result', subtype: 'success' },
    ],
    claudeInit,
  ).find((e) => e.kind === 'turn.end');
  expect(refused).toMatchObject({ stop_reason: 'refused', raw_stop_reason: 'refusal' });
});
