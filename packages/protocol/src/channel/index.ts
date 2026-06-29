// 组② 通信事件 —— driver↔CP 的通道协议（WebSocket 全双工，driver 拨出，NDJSON 帧）。
//
// 关键边界：channel 是【纯传输契约】。对组① harness 事件取【单向依赖】——仅 EngineEvent 帧驮一条 harness
// Event 作 payload（typed，端到端类型安全；CP 落库时还要给它盖全局 seq，本就要读其结构）。其余帧与组①无关。
// web 不碰本组（只走 @aprog/protocol/harness），故此依赖不会把通道类型拖进 web。
//
// 拓扑：沙箱能拨出、CP 拨不进（NAT；frp/nginx 隧道即为此建），故连接必然【driver 主动拨出】一条 WS，
// 双向帧都走它。两族帧同线复用：控制帧（握手/seed/renew…）是「交互」，EngineEvent 帧驮的是「值」。
// 带外大块（OCI pull / git clone）不走本通道（Seed 只下发 URI + 短时凭证）。
//
// ── 不超前设计 ──
// 当前在用的通信事件：握手（Hello / Welcome）+ 唤醒闭环（Seed / Ready）+ 凭证续签（RenewRepo / RepoToken）
// + 引擎流（EngineEvent 上行 / Input 下行）。其余（控制、ack、fs、心跳、退出、reject…）待真正用到时
// 按下面的【统一格式】机械扩展，不预先铺设。

import type { Event as HarnessEvent } from '../harness/index.ts';

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

// ── 唤醒闭环（Seed / Ready）──────────────────────────────────────────
// 握手之后，CP 下发 Seed 告知 driver「要恢复哪个进程」；driver 据此拉取程序闭包、克隆进程态、起引擎，
// 就绪后回 Ready，CP 才把进程由 waking 翻为 running（异步唤醒的回流信号）。
// 边界：大块内容（OCI 闭包 / git 仓库）不走本帧，Seed 只携带「取它们所需的引用」——程序坐标、程序包 registry
// 地址、进程仓库地址 + git 短票；driver 自行带外拉取。
// 程序包公有（共享基础设施、拉取链路无 per-user 秘密 → 不发拉取票），driver 匿名拉、按 digest 校验完整性；
// 进程态仓私有（per-user），由 git 短票守。即「公有代码 + 私有数据」。

/** 进程态 git 仓库的短票：CP 用 GitHub App 现签，仅该一个仓 contents 读写，TTL 由 GitHub 固定 ~1h。
 *  driver 据此 clone/push；临过期前经 RenewRepo 续签（长进程跑满 1h 后检查点仍能 push）。 */
export interface RepoCredential {
  /** 带凭证的 clone URL：https://x-access-token:<token>@github.com/<owner>/<repo>.git */
  url: string;
  token: string;
  /** 过期时刻（ISO 8601）。driver 据此排程续签。 */
  expiresAt: string;
}

/** CP → driver：握手后下发的恢复种子（含为本进程现签的短命窄权凭证）。 */
export type Seed = Frame<'seed', {
  /** 要恢复的进程 id。 */
  pid: string;
  /** 要部署的程序坐标（driver 据此拉取 OCI 闭包，untar 到 skills/）。 */
  program: { id: string; version: string | null };
  /** 程序包 registry 基址（含命名空间），如 ghcr.io/renjiyun06。包公有 → driver 据此匿名拉，无需凭证。 */
  registry: string;
  /** 进程态 git 仓库的 clone URL（driver 据此 clone 回 HEAD）；建库前的瞬时窗口内可能为 null。 */
  repoUrl: string | null;
  /** resume=瞬时重连；restore=冷唤醒（与 Welcome.mode 同义，便于 driver 单看 Seed 即可决策）。 */
  mode: 'resume' | 'restore';
  /** 进程态 git 仓库的短票（结构见 RepoCredential）；CP 未配 App 时省略。 */
  repoCredential?: RepoCredential;
  /** 模型/引擎凭证（per-user 口子）。给了则 driver 用它起引擎；省略时 driver 退回沙箱内共享注入的
   *  ANTHROPIC_AUTH_TOKEN。当前 CP 不下发（内部共享一把），预留字段待将来按用户下发。 */
  engineCredential?: { token: string; baseUrl?: string };
}>;

/** driver → CP：运行环境就绪（程序已部署、进程态已就位、引擎已拉起）。CP 收到后置进程为 running。 */
export type Ready = Frame<'ready', {
  /** 就绪的进程 id。 */
  pid: string;
}>;

// ── 凭证续签（RenewRepo / RepoToken）────────────────────────────────────
// 进程态仓库短票 TTL 由 GitHub 固定 ~1h，而进程可长跑（沙箱寿命可超 1h），检查点 push 需要全程有效的票。
// 故 driver 临过期前（或 push 收 401 时）发 RenewRepo 求新票；CP 据连接已钉死的 pid 重签，回 RepoToken。
// 边界：续签只针对【仓库短票】——程序拉取是 spawn 期一次性短动作（票当场用完即弃），不在此续。
// pid 仅为可读/校验之便；CP 以连接绑定的 pid 为准（不信帧内 pid，防越权续他人之票）。

/** driver → CP：本进程仓短票将过期，请求重签（长进程检查点 push 续命）。 */
export type RenewRepo = Frame<'renew-repo', {
  /** 请求续签的进程 id（须与连接绑定的 pid 一致；CP 以绑定者为准）。 */
  pid: string;
}>;

/** CP → driver：重签的进程仓短票（应 RenewRepo）。driver 收到后替换本地票 + 更新 git remote URL。 */
export type RepoToken = Frame<'repo-token', {
  pid: string;
  repoCredential: RepoCredential;
}>;

// ── 引擎流（EngineEvent 上行 / Input 下行）──────────────────────────────
// driver 内引擎（Claude Agent SDK）产出的消息，经 driver 的转换层归一成 harness Event 后，逐条驮在
// EngineEvent 帧里上行；CP 落库（盖全局 seq）后按 pid 扇出给前端。反向：前端的用户输入经 CP 下发为 Input
// 帧，driver 收到喂给引擎，并即时回 echo 一条 harness `user` 事件上行（让所有 attach 的前端按 seq 看到这句）。
// 边界：EngineEvent 是「值」（harness 语义流），Input 是「交互」（一个控制动词「把这句喂给引擎」）——
//       同一句话去程是 channel 交互、回程是 harness 值，层界清楚。

/** driver → CP：一条引擎事件（harness 归一后的语义值）。高频热路径，pid 由连接绑定决定，不入帧。
 *  seq：driver 只盖「本次运行内局部单调」的占位值，CP 落库时重盖跨生命周期的全局 seq（见 harness/envelope）。 */
export type EngineEvent = Frame<'event', {
  /** 一条 harness 语义事件（item.start/delta/end、turn.*、user…）。 */
  event: HarnessEvent;
}>;

/** CP → driver：把一条用户输入喂给引擎。低频，带 pid 以便可读/校验（CP 仍以连接绑定的 pid 为准）。 */
export type Input = Frame<'input', {
  pid: string;
  /** 用户输入文本。driver 收到 → engine.pushInput(text) + echo 一条 harness `user` 事件上行。 */
  text: string;
}>;

// ── 方向化 union（扩展点）─────────────────────────────────────────────
/** driver → CP 能发的所有帧。扩展：fs 应答 / 退出… 加到这里。 */
export type DriverFrame = Hello | Ready | RenewRepo | EngineEvent;

/** CP → driver 能发的所有帧。扩展：控制 / ack / fs 请求… 加到这里。 */
export type ControlPlaneFrame = Welcome | Seed | RepoToken | Input;
