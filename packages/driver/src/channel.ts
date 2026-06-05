// Channel · 链路/传输（driver 侧）。见 docs/interaction.html#schema。
// driver 自启后持「烘入镜像的凭证」拨向 control-plane，建一条常驻 HTTP/2 双工连接，
// 内部按 stream 多路复用：control-stream 跑交互帧，bulk-stream 跑大块。这是 driver
// 其余模块看到的「线」——本接口只定义语义操作，分帧/多路复用/重连是实现细节。
//
// 与 control-plane/src/driver-channel/driver-channel.ts 是同一条连接的两端（镜像）。

import type { Event, ItemId } from '@aprog/protocol';

/** 带内控制信号（与 control-plane 侧一致）。 */
export type ControlSignal = 'interrupt' | 'checkpoint-now' | 'hibernate-prepare';

/** 一条输入：用户消息 / 文件。 */
export interface InputItem {
  kind: 'message' | 'file';
  content: string;
  /** kind==='file' 时的目标路径。 */
  path?: string;
}

/** 错误信封（复用北向 API 的 {code,message,retryable}，见 docs/api.html#shapes）。 */
export interface ChannelError {
  code: string;
  message: string;
  retryable: boolean;
}

// ── fs（实时目录读，⇆）─────────────────────────────────
export interface FsRequest {
  op: 'list' | 'read';
  path: string;
  /** read 的字节区间，可选。 */
  range?: [number, number];
}
export interface FsEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: string;
}
export type FsResponse =
  | { ok: true; op: 'list'; entries: FsEntry[] }
  | { ok: true; op: 'read'; bytes: Uint8Array; truncated: boolean }
  | { ok: false; error: ChannelError };

// ── bundle（大块传输）─────────────────────────────────
export type BundleKind = 'bootstrap' | 'restore' | 'checkpoint';
export interface BundleManifest {
  entries: { path: string; size: number }[];
}
/** CP → driver 推下来的 bundle（bootstrap / restore）。 */
export interface IncomingBundle {
  kind: 'bootstrap' | 'restore';
  manifest: BundleManifest;
  /** 整体完整性校验。 */
  sha256: string;
  /** 有序分片流。 */
  chunks: AsyncIterable<Uint8Array>;
}

// ── 握手 ─────────────────────────────────
/** hello 的应答（见 docs/interaction.html#s-wake）。CP 在此分流瞬时重连与冷唤醒。 */
export interface Welcome {
  pid: string;
  /** resume = 同一 driver 还活着的网络抖动重连；restore = 冷唤醒（新沙箱/新 driver）。 */
  mode: 'resume' | 'restore';
  /** 仅 mode==='resume'：从这个 localSeq 起重放 driver 缓冲区。 */
  resendFromLocalSeq?: number;
}

/** 上行事件的传输单元：协议事件 + driver 局部序（未盖全局 seq）。 */
export interface EventFrame {
  /** 一次运行内单调递增的局部序，重连重放用。 */
  localSeq: number;
  // ❓ eventId 与 protocol Event 自带的 id 是否重复？item.* 事件已有 id，turn 级没有。
  //    若 folding 键统一取 event.id，这个字段可删；保留是为对齐 #schema-frames 的 Event 帧。
  eventId?: ItemId;
  event: Omit<Event, 'seq'>;
}

/** driver 侧的连接端点。dial 建连握手后，其余模块把处理器绑上来。 */
export interface DriverChannel {
  /** 拨出 + 版本握手 + create-time 绑定，返回 CP 的指示（重放 or 等 restore bundle）。 */
  dial(): Promise<Welcome>;

  /** ← driver→CP：上行一个事件帧。 */
  emit(frame: EventFrame): void;

  // → CP→driver：绑定下行处理器
  onInput(handler: (item: InputItem) => void): void;
  onControl(handler: (signal: ControlSignal) => void): void;
  onFsRequest(handler: (req: FsRequest) => Promise<FsResponse>): void;
  /** 收 bootstrap/restore bundle（冷唤醒灌注）。 */
  onBundlePush(handler: (bundle: IncomingBundle) => Promise<void>): void;

  /** ← driver→CP：上行一份 checkpoint（quiescent 点自发，或 checkpoint-now/hibernate-prepare 触发）。
   *  ❓ control-plane 侧现有 driver-channel.ts 是 pullBundle（CP 主动拉），与 #s-ckpt 的「driver 主动推」
   *     方向相反——两边须统一。这里按 schema 用 push。 */
  pushCheckpoint(manifest: BundleManifest, sha256: string, chunks: AsyncIterable<Uint8Array>): Promise<void>;

  close(): void;
}
