// driver 侧的 DriverChannel 端点。driver 自启后持「烘入镜像的凭证」拨向 control-plane，
// 在这条常驻连接上：上行翻译好的 aprog 事件（未盖全局 seq）、接收下发的输入 / 控制 / fs 请求 / 大块 bundle。
// 与 control-plane/src/driver-channel/driver-channel.ts 是同一条连接的两端。

import type { Event } from '@aprog/protocol';

/** 带内控制信号（与 control-plane 侧对应）。 */
export type ControlSignal = 'interrupt' | 'checkpoint-now' | 'hibernate-prepare';

export interface InputItem {
  kind: 'message' | 'file';
  content: string;
}

export interface DriverChannel {
  /** 上行一个 aprog 事件——未盖全局 seq（driver 只保证局部顺序，control-plane 落库时盖）。 */
  emit(event: Omit<Event, 'seq'>): void;
  /** 接收 control-plane 下发的用户输入。 */
  onInput(handler: (item: InputItem) => void): void;
  /** 接收带内控制信号（中断 / 立即检查点 / 休眠前落盘）。 */
  onControl(handler: (signal: ControlSignal) => void): void;
  /** 接收 UI 实时 fs 读请求；driver 在沙箱内 ls/cat 自己的 cwd 后回应。 */
  onFsRequest(handler: (req: { op: 'list' | 'read'; path: string }) => Promise<unknown>): void;
}
