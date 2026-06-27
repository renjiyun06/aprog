// 流的两个核心标识 + 订阅/恢复的信封类型。
//
// 详见 docs/protocol.html：seq 管「重放到哪」，id 管「哪些 delta 折成一条」。
// 分工（见 docs/interaction.html#seq）：id 由 Driver 取引擎稳定标识；seq 由 control-plane
// 落库时盖「跨生命周期单调」的全局序号——driver 只保证一次运行内的局部顺序，跨沙箱/休眠的
// 全局连续性只有常驻的 control-plane 看得全。

/** 单调递增的流位置（control-plane 盖，全局单调）。每个事件（含用户输入）都有。游标单位，回答「落后多少 / 补哪些」。 */
export type Seq = number;

/**
 * 逻辑分组标识，流一开始就定，把属于同一条消息的 delta 折叠成一条。回答「是不是同一条」。
 * 约定取自引擎的稳定标识，例如 Claude 的 `message.id:block_index`、工具的 `tool_use.id`。
 */
export type ItemId = string;

/** 一个 agent 回合的标识。 */
export type TurnId = string;

/** 所有事件共有的信封字段。 */
export interface Envelope {
  /** 流位置。 */
  seq: Seq;
  /** ISO-8601 时间戳，Driver 盖。 */
  ts: string;
  /**
   * 子代理归属：本事件由哪个子代理(subagent)产生——值为派生它的 Agent 工具调用的 ItemId
   * (取引擎稳定标识，Claude 即 `parent_tool_use_id`)。主流(顶层 agent)产生的事件为 undefined。
   * 前端据此把子代理的 thinking/tool/reply 折叠成一棵子树，而非摊平进主流。
   */
  parent?: ItemId;
  /**
   * 引擎原始载荷：本事件归一前的 harness 原文（由 Driver 在归一有损的事件上填，如
   * item.end / turn.end / error / compaction）。typed 字段是 aprog 赋予语义、据此渲染的投影；
   * raw 是保真兜底——通用 UI 读 typed，高级检视器/调试/未来需求读 raw。
   * 这样 typed 表面随「用户该知道什么」收敛，又对任何 harness 不丢任何信息。
   */
  raw?: unknown;
}

/** 重连订阅请求：从游标 seq「之后」开始，在同一条订阅上先 resync 再续 live。 */
export interface Subscribe {
  /** 客户端已渲染到的最后一条事件的 seq。服务端回放 seq > from 的事件。 */
  from: Seq;
}
