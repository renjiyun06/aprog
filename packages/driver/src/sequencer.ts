// Sequencer · 定序（引擎无关）。docs/harness.html 职责②③、docs/interaction.html#seq。
// driver 只盖「一次运行内」的局部序 localSeq（全局 seq 由 control-plane 落库时盖）；
// 并把引擎的 item/call 标识归一成稳定 eventId，让 delta 折叠、重连按序重放。

import type { Event } from '@aprog/protocol';
import type { EventFrame } from './channel.ts';

export interface Sequencer {
  /** 给一个 adapter 事件盖 localSeq、归一 eventId、入重放缓冲，返回可上行的帧。 */
  stamp(event: Omit<Event, 'seq'>): EventFrame;

  /** 瞬时重连：重放 localSeq >= from 的缓冲帧（见 Welcome.resendFromLocalSeq）。 */
  replayFrom(from: number): EventFrame[];

  /** 修剪重放缓冲：丢弃已确认持久化的帧。
   *  ❓ driver 如何得知「已持久化到哪」？当前 #schema 没有 per-event 持久化 ack。
   *     候选：CP 周期性下发水位 / 以最近一次 checkpoint 覆盖的事件为界。待定。 */
  trim(upToLocalSeq: number): void;
}
