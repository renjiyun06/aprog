// driver 侧的 Bridge 端点：把翻译好的 aprog 事件上行给 control-plane，
// 接收 control-plane 下发的用户输入。与 control-plane/src/bridge/bridge.ts 是同一管道的两端。

import type { Event } from '@aprog/protocol';

export interface DriverBridge {
  /** 上行一个 aprog 事件（已盖 seq）。 */
  emit(event: Event): void;
  /** 接收 control-plane 下发的用户输入。 */
  onInput(handler: (content: string) => void): void;
}
