// Codex ↔ aprog 适配（见 docs/harness.html#codex 的映射表）。
//
//   下行：对接 v2 item.* 词汇（codex exec --json / app-server），优先于 legacy EventMsg
//         item.started/delta/completed → item.start/delta/end
//         命令执行三段 begin→outputDelta→end 归一成 command 项（带 exit_code）
//         turn.aborted → turn.end（归一 stop_reason）；error/stream_error/warning → error(severity)
//         CLI 无全局 seq → 壳/Sequencer/CP 补；Codex 原生回显 user_message，仍由 driver 统一
//   上行：submit / interrupt 映射到 Codex 对应输入与控制原语
//   许可：start 时以全自动/跳过许可模式拉起，引擎不问、无审批往返
//
// 本文件分两半：codexTransduce(纯核，全部映射逻辑，可金标测试) + CodexAdapter(I/O 壳)。

import type { Event, StopReason, ItemType } from '@aprog/protocol';
import type { EngineAdapter, EngineContext, Transducer, TransduceStep } from '../engine.ts';
import type { InputItem } from '../channel.ts';
import type { OpenItem } from './coalesce.ts';
import { coalesce } from './coalesce.ts';
import { driveNdjson } from './shell.ts';

// ── 原生事件子集（Codex v2 item.* + 回合/错误）────────────────────────────────
type CodexItemType = 'agentMessage' | 'reasoning' | 'commandExecution';

interface CodexItem {
  id: string;
  item_type: CodexItemType;
  /** agentMessage/reasoning 的（可能的）整体文本。 */
  text?: string;
  /** commandExecution 的命令行与退出码。 */
  command?: string;
  exit_code?: number;
}

type CodexDelta =
  | { kind: 'agentMessage'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'commandExecution'; chunk: string };

type CodexAbort = 'Interrupted' | 'Replaced' | 'ReviewEnded' | 'BudgetLimited';

export type CodexNative =
  | { type: 'turn.started'; turn_id: string }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.delta'; item_id: string; delta: CodexDelta }
  | { type: 'item.completed'; item: CodexItem }
  | { type: 'turn.completed'; usage?: { input_tokens?: number; output_tokens?: number } }
  | { type: 'turn.aborted'; reason: CodexAbort }
  | { type: 'error'; message: string }
  | { type: 'stream_error'; message: string }
  | { type: 'warning'; message: string };

// ── 转换核状态 ───────────────────────────────────────────────────────────────
export interface CodexState {
  /** 当前回合 id（Codex 原生提供，确定性）。 */
  readonly turn?: string;
  /** item id → 正在累积的项。 */
  readonly open: Readonly<Record<string, OpenItem>>;
}

export const codexInit: CodexState = { open: {} };

const ITEM_TYPE: Record<CodexItemType, ItemType> = {
  agentMessage: 'reply',
  reasoning: 'thinking',
  commandExecution: 'command',
};

/** Codex 回合中止原因 → aprog StopReason。 */
function abortStop(reason: CodexAbort): StopReason {
  return reason === 'BudgetLimited' ? 'limit' : 'interrupted';
}

/** 纯转换核：Codex 原生事件 → aprog 草稿事件。全部映射逻辑在此，无 I/O。 */
export const codexTransduce: Transducer<CodexNative, CodexState> = (n, s): TransduceStep<CodexState> => {
  switch (n.type) {
    case 'turn.started': {
      return { events: [{ kind: 'turn.start', turn: n.turn_id }], state: { ...s, turn: n.turn_id } };
    }

    case 'item.started': {
      const itemType = ITEM_TYPE[n.item.item_type];
      const item: OpenItem = { id: n.item.id, itemType, buf: '', command: n.item.command };
      return {
        events: [{ kind: 'item.start', id: n.item.id, item_type: itemType }],
        state: { ...s, open: { ...s.open, [n.item.id]: item } },
      };
    }

    case 'item.delta': {
      const item = s.open[n.item_id];
      if (item === undefined) return { events: [], state: s };
      const d = n.delta;
      if (d.kind === 'commandExecution') {
        return {
          events: [{ kind: 'item.delta', id: item.id, patch: { kind: 'command_output', chunk: d.chunk } }],
          state: { ...s, open: { ...s.open, [n.item_id]: { ...item, buf: item.buf + d.chunk } } },
        };
      }
      // agentMessage / reasoning → 文本
      return {
        events: [{ kind: 'item.delta', id: item.id, patch: { kind: 'text', text: d.text } }],
        state: { ...s, open: { ...s.open, [n.item_id]: { ...item, buf: item.buf + d.text } } },
      };
    }

    case 'item.completed': {
      const open = s.open[n.item.id];
      // 用累积的 buf；命令的 command/exit_code 在 completed 才齐。若无 delta（buf 空）则退而用 completed 的整体 text。
      const base: OpenItem = open ?? { id: n.item.id, itemType: ITEM_TYPE[n.item.item_type], buf: '' };
      const merged: OpenItem = {
        ...base,
        buf: base.buf !== '' ? base.buf : n.item.text ?? '',
        command: n.item.command ?? base.command,
        exitCode: n.item.exit_code ?? base.exitCode,
      };
      const { [n.item.id]: _closed, ...rest } = s.open;
      return { events: [{ kind: 'item.end', id: n.item.id, value: coalesce(merged) }], state: { ...s, open: rest } };
    }

    case 'turn.completed': {
      const turn = s.turn ?? 't';
      return {
        events: [
          {
            kind: 'turn.end',
            turn,
            stop_reason: 'completed',
            usage: { input: n.usage?.input_tokens, output: n.usage?.output_tokens },
          },
        ],
        state: { ...s, turn: undefined, open: {} },
      };
    }

    case 'turn.aborted': {
      const turn = s.turn ?? 't';
      return {
        events: [{ kind: 'turn.end', turn, stop_reason: abortStop(n.reason), raw_stop_reason: n.reason }],
        state: { ...s, turn: undefined, open: {} },
      };
    }

    case 'error':
      return { events: [{ kind: 'error', severity: 'fatal', message: n.message }], state: s };
    case 'stream_error':
      return { events: [{ kind: 'error', severity: 'transient', message: n.message }], state: s };
    case 'warning':
      return { events: [{ kind: 'error', severity: 'warning', message: n.message }], state: s };
  }
};

// ── I/O 壳 ───────────────────────────────────────────────────────────────────
export class CodexAdapter implements EngineAdapter {
  readonly name = 'codex' as const;

  start(ctx: EngineContext): AsyncIterable<Omit<Event, 'seq'>> {
    return driveNdjson(ctx.supervisor.stdout, codexTransduce, codexInit);
  }

  async submit(item: InputItem): Promise<void> {
    void item;
    throw new Error('not implemented: codex submit wiring');
  }

  async interrupt(): Promise<void> {
    throw new Error('not implemented: codex interrupt wiring');
  }
}
