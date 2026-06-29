// driver 侧「转换层」——把 Claude Agent SDK 吐的消息归一成 harness Event（@aprog/protocol/harness）。
//
// 这是「捕获 harness 任何事件」的落点：引擎产出 35 类 SDKMessage，第一批只接入【会话四流 + 回合边界】：
//   思考流 / 回复流 / 工具使用流（item.* with item_type thinking|reply|tool）+ 用户回显（user）+ 回合起止（turn.*）。
// 其余（compaction/error/各类遥测/控制）第一批【显式 drop】，不崩；以后加 catch-all 不破坏兼容。
//
// 流式立场：以 stream_event（token 级增量）为准驱动 item 生命周期——
//   content_block_start → item.start，content_block_delta → item.delta，content_block_stop → item.end（合并全量）。
// 最终的 coalesced `assistant` 消息与之重复，故【不再 emit】（避免双发）。工具入参以分片累积、到 stop 时整体 parse。
//
// seq 立场：driver 只盖「本次运行内局部单调」的占位 seq（见 harness/envelope）；CP 落库时重盖跨生命周期的全局 seq。

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Event, ItemType, ItemValue, StopReason, TokenUsage } from '@aprog/protocol/harness';

/** 引擎的 stream_event 帧（从 SDKMessage 派生，免深 import @anthropic-ai/sdk 的 Beta 类型）。 */
type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

/** 一个仍在累积的内容块（content block）。text/thinking 累 text；tool 累 partial_json。 */
interface OpenBlock {
  itemId: string;
  itemType: ItemType;
  text: string;
  partialJson: string;
  toolName?: string;
  signature?: string;
}

/** 把 result.subtype 归一成 harness StopReason。 */
function mapStop(subtype: string): StopReason {
  switch (subtype) {
    case 'success':
      return 'completed';
    case 'error_max_turns':
    case 'error_max_budget_usd':
      return 'limit';
    default:
      return 'error'; // error_during_execution / error_max_structured_output_retries / 未知
  }
}

/**
 * 有状态转换器：逐条 feed(SDKMessage) → 0+ 条 harness Event。单进程单实例（一条引擎流一个转换器）。
 * 状态：当前回合（inTurn/turnId）、当前 assistant 消息 id（拼 ItemId 用）、按 index 开着的内容块。
 */
export class Transducer {
  private seq = 0;
  private inTurn = false;
  private turnId = '';
  private messageId = '';
  private readonly blocks = new Map<number, OpenBlock>();

  /** 盖信封：局部单调 seq + ts（driver 盖）；有 parent（子代理归属）则带上。 */
  private env(parent?: string): { seq: number; ts: string; parent?: string } {
    return { seq: this.seq++, ts: new Date().toISOString(), ...(parent ? { parent } : {}) };
  }

  /** 用户回显：driver 在收到 Input 帧、喂引擎的同时发一条，让前端按 seq 看到这句。与流共用 seq 计数。 */
  userEcho(text: string): Event {
    const e = this.env();
    return { ...e, kind: 'user', id: `user-${e.seq}`, content: text };
  }

  /** 主入口：一条 SDKMessage → 0+ 条 harness Event。 */
  feed(msg: SDKMessage): Event[] {
    const parent =
      'parent_tool_use_id' in msg && msg.parent_tool_use_id ? msg.parent_tool_use_id : undefined;
    switch (msg.type) {
      case 'stream_event':
        return this.onStream(msg.event, parent);
      case 'result':
        return this.onResult(msg);
      default:
        // assistant（与 stream 重复）/ user（tool_result，第一批不回填）/ system/... 全 drop。
        return [];
    }
  }

  /** stream_event（BetaRawMessageStreamEvent）→ item/turn 生命周期。 */
  private onStream(e: StreamEvent, parent?: string): Event[] {
    switch (e.type) {
      case 'message_start': {
        this.messageId = e.message.id;
        if (this.inTurn) return [];
        this.inTurn = true;
        this.turnId = e.message.id;
        return [{ ...this.env(parent), kind: 'turn.start', turn: this.turnId }];
      }
      case 'content_block_start': {
        const cb = e.content_block;
        let itemType: ItemType;
        let itemId: string;
        let toolName: string | undefined;
        if (cb.type === 'text') {
          itemType = 'reply';
          itemId = `${this.messageId}:${e.index}`;
        } else if (cb.type === 'thinking') {
          itemType = 'thinking';
          itemId = `${this.messageId}:${e.index}`;
        } else if (cb.type === 'tool_use') {
          itemType = 'tool';
          itemId = cb.id;
          toolName = cb.name;
        } else {
          return []; // server_tool / mcp / redacted_thinking… 第一批不接，不开块。
        }
        this.blocks.set(e.index, { itemId, itemType, text: '', partialJson: '', toolName });
        return [{ ...this.env(parent), kind: 'item.start', id: itemId, item_type: itemType }];
      }
      case 'content_block_delta': {
        const blk = this.blocks.get(e.index);
        if (!blk) return [];
        const d = e.delta;
        if (d.type === 'text_delta') {
          blk.text += d.text;
          return [{ ...this.env(parent), kind: 'item.delta', id: blk.itemId, patch: { kind: 'text', text: d.text } }];
        }
        if (d.type === 'thinking_delta') {
          blk.text += d.thinking;
          return [{ ...this.env(parent), kind: 'item.delta', id: blk.itemId, patch: { kind: 'text', text: d.thinking } }];
        }
        if (d.type === 'input_json_delta') {
          blk.partialJson += d.partial_json;
          return [{ ...this.env(parent), kind: 'item.delta', id: blk.itemId, patch: { kind: 'tool_args', partial_json: d.partial_json } }];
        }
        if (d.type === 'signature_delta') {
          blk.signature = d.signature; // thinking 签名只在 item.end 落值，不单独发 delta。
        }
        return []; // citations_delta 等第一批 drop。
      }
      case 'content_block_stop': {
        const blk = this.blocks.get(e.index);
        if (!blk) return [];
        this.blocks.delete(e.index);
        let value: ItemValue;
        if (blk.itemType === 'reply') {
          value = { item: 'reply', text: blk.text };
        } else if (blk.itemType === 'thinking') {
          value = { item: 'thinking', text: blk.text, ...(blk.signature ? { signature: blk.signature } : {}) };
        } else {
          value = { item: 'tool', name: blk.toolName ?? '', args: parseArgs(blk.partialJson) };
        }
        return [{ ...this.env(parent), kind: 'item.end', id: blk.itemId, value }];
      }
      default:
        // message_delta / message_stop —— 本条 assistant 消息收尾，但回合未结束（可能还有工具轮），不发 turn.end。
        return [];
    }
  }

  /** result（运行终止）→ turn.end。多工具轮里有多条 assistant，但只在此处收一次回合。 */
  private onResult(msg: ResultMessage): Event[] {
    if (!this.inTurn) return [];
    this.inTurn = false;
    this.blocks.clear();
    const u = (msg as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    const usage: TokenUsage | undefined =
      u && (u.input_tokens !== undefined || u.output_tokens !== undefined)
        ? {
            ...(u.input_tokens !== undefined ? { input: u.input_tokens } : {}),
            ...(u.output_tokens !== undefined ? { output: u.output_tokens } : {}),
          }
        : undefined;
    return [
      {
        ...this.env(),
        kind: 'turn.end',
        turn: this.turnId,
        stop_reason: mapStop(msg.subtype),
        raw_stop_reason: msg.subtype,
        ...(usage ? { usage } : {}),
      },
    ];
  }
}

/** 工具入参分片累积后整体 parse；失败兜个空对象（args 是 unknown，宁缺毋崩）。 */
function parseArgs(partialJson: string): unknown {
  const s = partialJson.trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
