// Codex 转换核 · 金标测试。喂录制的 v2 item.* 原生流，断言产出的 aprog 草稿事件。
// 重点覆盖 Claude 那条线没有的：命令执行三段归一成 command 项、error 分级、turn.aborted 归一。

import { test, expect } from 'bun:test';
import { runTransducer } from '../engine.ts';
import type { DraftEvent } from '../engine.ts';
import { codexTransduce, codexInit } from './codex.ts';
import type { CodexNative } from './codex.ts';

test('codex: 命令执行(三段) + reply 折叠成 command/reply 项', () => {
  const fixture: CodexNative[] = [
    { type: 'turn.started', turn_id: 'turn_7' },
    { type: 'item.started', item: { id: 'cmd_1', item_type: 'commandExecution', command: 'grep -r login' } },
    { type: 'item.delta', item_id: 'cmd_1', delta: { kind: 'commandExecution', chunk: 'auth.ts:42\n' } },
    { type: 'item.completed', item: { id: 'cmd_1', item_type: 'commandExecution', command: 'grep -r login', exit_code: 0 } },
    { type: 'item.started', item: { id: 'msg_1', item_type: 'agentMessage' } },
    { type: 'item.delta', item_id: 'msg_1', delta: { kind: 'agentMessage', text: '是 token 过期判断写反了。' } },
    { type: 'item.completed', item: { id: 'msg_1', item_type: 'agentMessage' } },
    { type: 'turn.completed', usage: { input_tokens: 2010, output_tokens: 180 } },
  ];

  const golden: DraftEvent[] = [
    { kind: 'turn.start', turn: 'turn_7' },
    { kind: 'item.start', id: 'cmd_1', item_type: 'command' },
    { kind: 'item.delta', id: 'cmd_1', patch: { kind: 'command_output', chunk: 'auth.ts:42\n' } },
    { kind: 'item.end', id: 'cmd_1', value: { item: 'command', command: 'grep -r login', output: 'auth.ts:42\n', exit_code: 0 } },
    { kind: 'item.start', id: 'msg_1', item_type: 'reply' },
    { kind: 'item.delta', id: 'msg_1', patch: { kind: 'text', text: '是 token 过期判断写反了。' } },
    { kind: 'item.end', id: 'msg_1', value: { item: 'reply', text: '是 token 过期判断写反了。' } },
    { kind: 'turn.end', turn: 'turn_7', stop_reason: 'completed', usage: { input: 2010, output: 180 } },
  ];

  expect(runTransducer(codexTransduce, fixture, codexInit)).toEqual(golden);
});

test('codex: error 分级 + turn.aborted(Interrupted) 归一 interrupted', () => {
  const out = runTransducer(
    codexTransduce,
    [
      { type: 'turn.started', turn_id: 'turn_9' },
      { type: 'stream_error', message: 'reconnecting' },
      { type: 'turn.aborted', reason: 'Interrupted' },
    ],
    codexInit,
  );
  expect(out).toEqual([
    { kind: 'turn.start', turn: 'turn_9' },
    { kind: 'error', severity: 'transient', message: 'reconnecting' },
    { kind: 'turn.end', turn: 'turn_9', stop_reason: 'interrupted', raw_stop_reason: 'Interrupted' },
  ]);
});

test('codex: turn.aborted(BudgetLimited) 归一 limit；warning/error 各自分级', () => {
  const budget = runTransducer(
    codexTransduce,
    [{ type: 'turn.started', turn_id: 't' }, { type: 'turn.aborted', reason: 'BudgetLimited' }],
    codexInit,
  ).find((e) => e.kind === 'turn.end');
  expect(budget).toMatchObject({ stop_reason: 'limit', raw_stop_reason: 'BudgetLimited' });

  const sev = runTransducer(
    codexTransduce,
    [
      { type: 'warning', message: 'low credits' },
      { type: 'error', message: 'boom' },
    ],
    codexInit,
  );
  expect(sev).toEqual([
    { kind: 'error', severity: 'warning', message: 'low credits' },
    { kind: 'error', severity: 'fatal', message: 'boom' },
  ]);
});
