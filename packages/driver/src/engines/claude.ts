// Claude Agent SDK ↔ aprog 适配（见 docs/harness.html#claude 的映射表）。
//
//   下行：includePartialMessages:true 拿原生 Anthropic 流事件
//         content_block_start/delta/stop → item.start/delta/end（thinking/text/tool_use）
//         message_delta 带 stop_reason；SDK result 收口为 turn.end（归一 stop_reason）
//         id = message.id:block_index（工具用 tool_use.id）；ts/seq 由壳/Sequencer/CP 补
//   上行：submit → 流式输入消息；interrupt → query.interrupt()
//   许可：start 时 permissionMode:'bypassPermissions'，引擎不触发 canUseTool，无审批往返
//
// 本文件分两半：claudeTransduce(纯核，全部映射逻辑，可金标测试) + ClaudeAdapter(I/O 壳)。

import type { Event, StopReason, ItemType } from '@aprog/protocol';
import type { EngineAdapter, EngineContext, Transducer, TransduceStep } from '../engine.ts';
import type { InputItem } from '../channel.ts';
import type { OpenItem } from './coalesce.ts';
import { coalesce } from './coalesce.ts';
import { driveNdjson } from './shell.ts';

// ── 原生事件子集（我们消费的那部分 Anthropic 流事件 + SDK result）──────────────
type ClaudeBlockType = 'text' | 'thinking' | 'tool_use';

type ClaudeDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'signature_delta'; signature: string };

export type ClaudeNative =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; content_block: { type: ClaudeBlockType; id?: string; name?: string } }
  | { type: 'content_block_delta'; index: number; delta: ClaudeDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null } }
  | { type: 'result'; subtype: 'success' | 'error_max_turns' | 'error_during_execution'; usage?: { input_tokens?: number; output_tokens?: number } };

// ── 转换核状态 ───────────────────────────────────────────────────────────────
export interface ClaudeState {
  /** 当前回合 id（合成，确定性：t1, t2…）。 */
  readonly turn?: string;
  /** 已开了几个回合——用来确定性地造 turn id。 */
  readonly turnSeq: number;
  /** 当前 assistant 消息 id（id 前缀）。 */
  readonly msgId?: string;
  /** 最近一次 message_delta 的 stop_reason（result 收口时和 subtype 一起归一）。 */
  readonly lastStop?: string;
  /** block index → 正在累积的项。 */
  readonly open: Readonly<Record<number, OpenItem>>;
}

export const claudeInit: ClaudeState = { turnSeq: 0, open: {} };

const ITEM_TYPE: Record<ClaudeBlockType, ItemType> = {
  text: 'reply',
  thinking: 'thinking',
  tool_use: 'tool',
};

/** Claude stop_reason 归一（result.subtype + message stop_reason → aprog StopReason）。 */
function normStop(subtype: string, lastStop: string | undefined): { stop: StopReason; raw: string } {
  if (subtype === 'error_max_turns') return { stop: 'limit', raw: 'error_max_turns' };
  if (subtype === 'error_during_execution') return { stop: 'error', raw: 'error_during_execution' };
  // success：看 message 级 stop_reason
  switch (lastStop) {
    case 'max_tokens':
      return { stop: 'limit', raw: 'max_tokens' };
    case 'refusal':
      return { stop: 'refused', raw: 'refusal' };
    case 'stop_sequence':
      return { stop: 'completed', raw: 'stop_sequence' };
    case 'end_turn':
    default:
      return { stop: 'completed', raw: lastStop ?? 'end_turn' };
  }
}

/** 纯转换核：Claude 原生事件 → aprog 草稿事件。全部映射逻辑在此，无 I/O。 */
export const claudeTransduce: Transducer<ClaudeNative, ClaudeState> = (n, s): TransduceStep<ClaudeState> => {
  switch (n.type) {
    case 'message_start': {
      // 一个回合可能跨多条 assistant 消息（工具循环）——只有首条开 turn。
      if (s.turn === undefined) {
        const turn = `t${s.turnSeq + 1}`;
        return {
          events: [{ kind: 'turn.start', turn }],
          state: { ...s, turn, turnSeq: s.turnSeq + 1, msgId: n.message.id },
        };
      }
      return { events: [], state: { ...s, msgId: n.message.id } };
    }

    case 'content_block_start': {
      const itemType = ITEM_TYPE[n.content_block.type];
      // id 约定（见 envelope.ts）：工具用 tool_use.id；其余用 message.id:block_index。
      const id =
        n.content_block.type === 'tool_use' && n.content_block.id !== undefined
          ? n.content_block.id
          : `${s.msgId ?? 'msg'}:${n.index}`;
      const item: OpenItem = { id, itemType, buf: '', toolName: n.content_block.name };
      return {
        events: [{ kind: 'item.start', id, item_type: itemType }],
        state: { ...s, open: { ...s.open, [n.index]: item } },
      };
    }

    case 'content_block_delta': {
      const item = s.open[n.index];
      if (item === undefined) return { events: [], state: s };
      const d = n.delta;
      if (d.type === 'text_delta' || d.type === 'thinking_delta') {
        const text = d.type === 'text_delta' ? d.text : d.thinking;
        return {
          events: [{ kind: 'item.delta', id: item.id, patch: { kind: 'text', text } }],
          state: { ...s, open: { ...s.open, [n.index]: { ...item, buf: item.buf + text } } },
        };
      }
      if (d.type === 'input_json_delta') {
        return {
          events: [{ kind: 'item.delta', id: item.id, patch: { kind: 'tool_args', partial_json: d.partial_json } }],
          state: { ...s, open: { ...s.open, [n.index]: { ...item, buf: item.buf + d.partial_json } } },
        };
      }
      // signature_delta：不产 delta 事件，签名攒到 item.end。
      return {
        events: [],
        state: { ...s, open: { ...s.open, [n.index]: { ...item, signature: (item.signature ?? '') + d.signature } } },
      };
    }

    case 'content_block_stop': {
      const item = s.open[n.index];
      if (item === undefined) return { events: [], state: s };
      const { [n.index]: _closed, ...rest } = s.open;
      return { events: [{ kind: 'item.end', id: item.id, value: coalesce(item) }], state: { ...s, open: rest } };
    }

    case 'message_delta': {
      return { events: [], state: { ...s, lastStop: n.delta.stop_reason ?? s.lastStop } };
    }

    case 'result': {
      const turn = s.turn ?? `t${s.turnSeq}`;
      const { stop, raw } = normStop(n.subtype, s.lastStop);
      return {
        events: [
          {
            kind: 'turn.end',
            turn,
            stop_reason: stop,
            raw_stop_reason: raw,
            usage: { input: n.usage?.input_tokens, output: n.usage?.output_tokens },
          },
        ],
        // 收口：清回合态，下一条 message_start 重开 turn。
        state: { ...s, turn: undefined, msgId: undefined, lastStop: undefined, open: {} },
      };
    }
  }
};

// ── I/O 壳 ───────────────────────────────────────────────────────────────────
export class ClaudeAdapter implements EngineAdapter {
  readonly name = 'claude' as const;

  start(ctx: EngineContext): AsyncIterable<Omit<Event, 'seq'>> {
    return driveNdjson(ctx.supervisor.stdout, claudeTransduce, claudeInit);
  }

  async submit(item: InputItem): Promise<void> {
    void item;
    throw new Error('not implemented: claude submit wiring');
  }

  async interrupt(): Promise<void> {
    throw new Error('not implemented: claude interrupt wiring');
  }
}
