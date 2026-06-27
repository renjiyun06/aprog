// 组② 通信事件 —— driver↔CP 的通道协议（WebSocket 全双工，driver 拨出，NDJSON 帧）。
//
// 关键边界：channel 是【纯传输契约】，与组① harness 事件【零依赖】。事件流（待加）只是上行帧里的
// 一个【不透明 payload】——driver 放 harness Event、CP 落库时解读，channel 本身不 import、不解析其结构。
//
// 拓扑：沙箱能拨出、CP 拨不进（NAT；frp/nginx 隧道即为此建），故连接必然【driver 主动拨出】一条 WS，
// 双向帧都走它。带外大块（OCI pull / git clone）不走本通道（待加 seed 帧时只下发 URI + 短时凭证）。
//
// ── 不超前设计 ──
// 当前只保留真正在用的通信事件：握手（Hello / Welcome）。其余（事件流、输入、控制、ack、fs、seed、
// 心跳、退出、reject…）待真正用到时按下面的【统一格式】机械扩展，不预先铺设。

/**
 * 统一帧格式：每条通信事件都是 `{ t, p }` —— `t` 判别类型，`p` 收该类型的载荷。
 * 扩展一个新通信事件 = 定义一个 `Frame<'新标签', { …载荷… }>` 并加入对应方向的 union。
 */
export interface Frame<T extends string = string, P = unknown> {
  /** 类型判别标签（discriminator）。 */
  t: T;
  /** 该类型的专属载荷。 */
  p: P;
}

/** 协议版本。driver 烘在镜像里、CP 独立部署，握手时比对；不一致时 CP 关连接（Reject 帧待需要时再加）。 */
export const CHANNEL_PROTOCOL_VERSION = 1;

// ── 握手（当前唯一在用的通信事件）─────────────────────────────────────
/** driver 开 WS 后发的第一帧。 */
export type Hello = Frame<'hello', {
  protocolVersion: number;
  /** create 时注入的每沙箱能力令牌；CP 据此把这条连接钉到对应沙箱/进程。 */
  bindToken: string;
}>;

/** CP 认领后的应答。 */
export type Welcome = Frame<'welcome', {
  protocolVersion: number;
  /** 本连接绑定的进程 id。 */
  pid: string;
  /** resume=瞬时重连；restore=冷唤醒。driver 据此决定铺设进程目录的方式。 */
  mode: 'resume' | 'restore';
}>;

// ── 方向化 union（扩展点）─────────────────────────────────────────────
/** driver → CP 能发的所有帧。扩展：事件流 / fs 应答 / 退出… 加到这里。 */
export type DriverFrame = Hello;

/** CP → driver 能发的所有帧。扩展：输入 / 控制 / ack / fs 请求 / seed… 加到这里。 */
export type ControlPlaneFrame = Welcome;
