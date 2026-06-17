// EngineAdapter · 引擎适配（引擎相关，唯一要为每款引擎重写的模块）。docs/harness.html。
// 两个方向：
//   下行  引擎原生输出流 → aprog 事件（翻译 / 合成 user 回显）
//   上行  aprog input/interrupt → 引擎原生动作（流式输入消息 / query.interrupt()）
//
// 无审批：所有操作默认放行，不留任何配置项。引擎在 start 时即以「最大权限 / 跳过许可」
// 模式拉起（Claude: permissionMode:'bypassPermissions'，不触发 canUseTool；Codex: 全自动、
// 不问），隔离完全交给沙箱兜底。因此没有 respond、没有 ApprovalPolicy，协议也不需要
// requires_action 事件——许可这件事在启动姿势里就解决了，不在运行期往返。

import type { Event } from '@aprog/protocol';
import type { HarnessSupervisor } from './supervisor.ts';
import type { InputItem } from './channel.ts';

// ── 纯转换核（pure transducer）─────────────────────────────────────────
// 「翻译」这件事被刻意拆成两半：
//   1) 纯转换  (native, state) → { events, state }   ——不碰 I/O，可金标测试
//   2) I/O 壳  EngineAdapter.start()                 ——读引擎流、喂转换核、把产出往外吐
// 拆开的理由：原生→aprog 这段映射会随引擎版本悄悄漂移。把它写成纯函数后，就能录一段
// 真实引擎原生流当 fixture、把转换产物钉成「金标(golden)」，每次改动/升级自动比对，
// 防止「双向覆盖」悄悄退化（见 docs/harness.html#transduce）。

/** 分配式 Omit：在联合的每个成员上各做 Omit，保住可辨识联合（普通 Omit<联合,K> 会塌成公共字段）。 */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** 转换核产出的「草稿事件」：连 seq 和 ts 都还没有。
 *  seq 由 control-plane 落库盖、ts 由 I/O 壳盖——纯核不依赖时钟，所以这里两者都不在。 */
export type DraftEvent = DistributiveOmit<Event, 'seq' | 'ts'>;

/** 转换核的一步产出：零或多个草稿事件 + 推进后的状态。 */
export interface TransduceStep<S> {
  events: DraftEvent[];
  state: S;
}

/**
 * 纯转换核：吃一个引擎原生事件 + 当前状态，吐应产出的 aprog 草稿事件与新状态。
 * 必须是纯函数——同样输入永远同样输出，不读网络、不发消息、不依赖时钟。
 * 唯一的「记忆」是显式传入/传出的 state（如：每个 id 攒到的文本，用于在 item.end 给合并全量）。
 */
export type Transducer<Native, S> = (native: Native, state: S) => TransduceStep<S>;

/** 把一串原生事件顺着转换核折一遍，收集全部草稿事件。金标测试与离线重放都用它。 */
export function runTransducer<Native, S>(
  transduce: Transducer<Native, S>,
  natives: readonly Native[],
  init: S,
): DraftEvent[] {
  let state = init;
  const out: DraftEvent[] = [];
  for (const n of natives) {
    const step = transduce(n, state);
    out.push(...step.events);
    state = step.state;
  }
  return out;
}

export interface EngineContext {
  /** 用它拉起/读写引擎子进程（进程机制归 supervisor，见讨论①）。 */
  supervisor: HarnessSupervisor;
}

export interface EngineAdapter {
  readonly name: 'claude' | 'codex';

  /** 启动引擎（以最大权限/跳过许可模式）并把其原生输出翻成 aprog 事件（未盖全局 seq、未盖 localSeq——交 Sequencer）。
   *  实现 = 一层薄 I/O 壳：读引擎原生流，逐事件喂给本引擎的纯转换核，把产出 yield 出去。 */
  start(ctx: EngineContext): AsyncIterable<Omit<Event, 'seq'>>;

  /** 上行→引擎：注入一条用户输入（机制引擎特定）。 */
  submit(item: InputItem): Promise<void>;

  /** 上行→引擎：打断当前回合（带内 interrupt，非进程信号）。 */
  interrupt(): Promise<void>;
}
