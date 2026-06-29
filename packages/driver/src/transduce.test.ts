// 转换层单测：用合成的 SDKMessage 喂转换器，断言归一出的 harness Event 流。
// 只构造转换器实际读到的字段（其余略），故以 `as unknown as SDKMessage` 收口类型。
import { test, expect } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Event } from '@aprog/protocol/harness';
import { Transducer } from './transduce.ts';

/** 合成一条 stream_event 消息。 */
function se(event: unknown, parent: string | null = null): SDKMessage {
  return { type: 'stream_event', event, parent_tool_use_id: parent } as unknown as SDKMessage;
}
/** 合成一条 result 消息。 */
function result(subtype: string, usage?: unknown): SDKMessage {
  return { type: 'result', subtype, usage } as unknown as SDKMessage;
}

/** 喂一串消息，收集所有 emit 出的事件。 */
function run(t: Transducer, msgs: SDKMessage[]): Event[] {
  return msgs.flatMap((m) => t.feed(m));
}

test('回复流：message_start→turn.start，文本块 start/delta*/stop→item.*，result→turn.end', () => {
  const t = new Transducer();
  const out = run(t, [
    se({ type: 'message_start', message: { id: 'msg_1' } }),
    se({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
    se({ type: 'content_block_stop', index: 0 }),
    result('success', { input_tokens: 10, output_tokens: 5 }),
  ]);

  expect(out.map((e) => e.kind)).toEqual([
    'turn.start',
    'item.start',
    'item.delta',
    'item.delta',
    'item.end',
    'turn.end',
  ]);
  const start = out[1] as Extract<Event, { kind: 'item.start' }>;
  expect(start.item_type).toBe('reply');
  expect(start.id).toBe('msg_1:0');
  const end = out[4] as Extract<Event, { kind: 'item.end' }>;
  expect(end.value).toEqual({ item: 'reply', text: 'Hello' }); // delta 合并全量
  const turnEnd = out[5] as Extract<Event, { kind: 'turn.end' }>;
  expect(turnEnd.stop_reason).toBe('completed');
  expect(turnEnd.usage).toEqual({ input: 10, output: 5 });
  // seq 局部单调
  expect(out.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
});

test('工具流：tool_use 块 → item.start(tool)，input_json_delta 累积到 stop 整体 parse', () => {
  const t = new Transducer();
  const out = run(t, [
    se({ type: 'message_start', message: { id: 'msg_2' } }),
    se({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_9', name: 'bash' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"ls"}' } }),
    se({ type: 'content_block_stop', index: 0 }),
  ]);

  const start = out.find((e) => e.kind === 'item.start') as Extract<Event, { kind: 'item.start' }>;
  expect(start.item_type).toBe('tool');
  expect(start.id).toBe('toolu_9'); // 工具用 tool_use.id 作 ItemId（与 tool_result 对齐）
  const end = out.find((e) => e.kind === 'item.end') as Extract<Event, { kind: 'item.end' }>;
  expect(end.value).toEqual({ item: 'tool', name: 'bash', args: { cmd: 'ls' } });
});

test('思考流：thinking_delta 累积，signature_delta 只在 end 落值不单发', () => {
  const t = new Transducer();
  const out = run(t, [
    se({ type: 'message_start', message: { id: 'msg_3' } }),
    se({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } }),
    se({ type: 'content_block_stop', index: 0 }),
  ]);
  // signature_delta 不产事件：start + 1 delta + end = 3 条（turn.start 另算）
  expect(out.filter((e) => e.kind === 'item.delta').length).toBe(1);
  const end = out.find((e) => e.kind === 'item.end') as Extract<Event, { kind: 'item.end' }>;
  expect(end.value).toEqual({ item: 'thinking', text: 'hmm', signature: 'sig123' });
});

test('用户回显：userEcho 产 user 事件，与流共用 seq 计数', () => {
  const t = new Transducer();
  const echo = t.userEcho('hi there');
  expect(echo.kind).toBe('user');
  expect((echo as Extract<Event, { kind: 'user' }>).content).toBe('hi there');
  expect(echo.seq).toBe(0);
  // 后续流事件从 seq=1 续
  const out = run(t, [se({ type: 'message_start', message: { id: 'm' } })]);
  expect(out[0]!.seq).toBe(1);
});

test('未接入的消息全 drop：assistant（与流重复）/ system / user(tool_result)', () => {
  const t = new Transducer();
  const out = run(t, [
    { type: 'assistant', message: { content: [] }, parent_tool_use_id: null } as unknown as SDKMessage,
    { type: 'system', subtype: 'init' } as unknown as SDKMessage,
    { type: 'user', message: { content: [] }, parent_tool_use_id: null } as unknown as SDKMessage,
  ]);
  expect(out).toEqual([]);
});

test('多工具轮：两条 assistant 消息只在最终 result 收一次 turn.end', () => {
  const t = new Transducer();
  const out = run(t, [
    se({ type: 'message_start', message: { id: 'm1' } }), // turn.start
    se({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }), // 不收回合
    se({ type: 'message_stop' }),
    se({ type: 'message_start', message: { id: 'm2' } }), // 已 inTurn，不再 turn.start
    se({ type: 'message_stop' }),
    result('success'),
  ]);
  expect(out.filter((e) => e.kind === 'turn.start').length).toBe(1);
  expect(out.filter((e) => e.kind === 'turn.end').length).toBe(1);
  const ts = out.find((e) => e.kind === 'turn.start') as Extract<Event, { kind: 'turn.start' }>;
  expect(ts.turn).toBe('m1'); // 回合 id = 首条 assistant 消息 id
});

test('result 错误子类型归一：max_turns→limit，error_during_execution→error', () => {
  const a = new Transducer();
  run(a, [se({ type: 'message_start', message: { id: 'x' } })]);
  const limit = a.feed(result('error_max_turns'))[0] as Extract<Event, { kind: 'turn.end' }>;
  expect(limit.stop_reason).toBe('limit');

  const b = new Transducer();
  run(b, [se({ type: 'message_start', message: { id: 'y' } })]);
  const err = b.feed(result('error_during_execution'))[0] as Extract<Event, { kind: 'turn.end' }>;
  expect(err.stop_reason).toBe('error');
});
