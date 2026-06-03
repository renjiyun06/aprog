// B 平面 · 数据平面（control-plane 侧）。见 docs/interaction.html。
//
// driver 自启后持「烘入镜像的凭证」拨向控制平面；控制平面按 bindToken 把这条连接钉到
// 对应沙箱（create-time 绑定，见 docs/interaction.html#trust）。一个沙箱一条常驻
// DriverChannel，活满沙箱整个生命周期——不是 per-attach 的临时管道。
//
// 它带内承载「一切」：事件流上行、输入/控制下行、UI 实时 fs 读、大块 bundle 进出
// （bootstrap / 检查点 / 恢复）。A 平面 SandboxProvider 碰都不碰文件。
// 落地硬约束：必须多路复用——几十 MB 的 bundle 绝不能头部阻塞实时事件流。

import type { Event } from '@aprog/protocol';
import type { SandboxHandle } from '../sandbox/index.ts';

/** 带内控制信号。 */
export type ControlSignal = 'interrupt' | 'checkpoint-now' | 'hibernate-prepare';

/** 一条输入：用户消息 / 文件。落到 harness 的 input.md 流。 */
export interface InputItem {
  kind: 'message' | 'file';
  content: string;
}

/** UI 目录浏览的实时读——driver 在沙箱内 ls/cat 自己的 cwd（见 docs/interaction.html#dir-read）。 */
export interface DriverFs {
  list(path: string): Promise<{ name: string; kind: 'file' | 'dir' }[]>;
  read(path: string): Promise<string>;
}

/** 对单个沙箱内 driver 的一条常驻双工连接。 */
export interface DriverChannel {
  readonly sandboxId: string;

  /** driver → control-plane：上行事件（未盖全局 seq——control-plane 落库时盖，见 stream/store.ts）。 */
  onEvent(handler: (e: Omit<Event, 'seq'>) => void): void;

  // control-plane → driver
  sendInput(item: InputItem): Promise<void>;
  respond(actionId: string, decision: 'allow' | 'deny'): Promise<void>;
  control(signal: ControlSignal): Promise<void>;

  /** UI 实时目录浏览。 */
  readonly fs: DriverFs;

  // 大块传输（bootstrap / 检查点 / 恢复）
  /** 把一段 tar 灌进沙箱指定路径（bootstrap 进程目录 / 唤醒灌回检查点）。 */
  pushBundle(destPath: string, tar: Uint8Array): Promise<void>;
  /** 从沙箱取出 state 子集（quiescent 点检查点）。 */
  pullBundle(srcPath: string, globs?: string[]): Promise<Uint8Array>;

  close(): void;
}

/**
 * driver 拨入的受理方。driver 持烘入镜像的「共享凭证」拨上来，acceptor 校验凭证 +
 * 按 bindToken 把连接钉到刚 create 的那个沙箱（create-time 绑定补齐「我是进程 X」，
 * 见 docs/interaction.html#trust）。
 */
export interface DriverChannelServer {
  /** 等待并绑定某个 create 出来的沙箱的 driver 连接。 */
  accept(sandbox: SandboxHandle): Promise<DriverChannel>;
}
