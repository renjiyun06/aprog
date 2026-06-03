// Bridge：per-attach 的临时管道，连接沙箱内常驻的 driver 与 control-plane。
// driver 把引擎事件经 Bridge 推给 control-plane（→ stream/store）；用户输入经 Bridge 下发给 driver。
// Bridge 是 ephemeral 的——随 attach 建立、随 detach 拆除，不持有状态。

import type { Event } from '@aprog/protocol';
import type { SandboxHandle } from '../sandbox/index.ts';

export interface Bridge {
  /** driver → control-plane：上行事件（尚未盖 seq）。 */
  onEvent(handler: (e: Omit<Event, 'seq'>) => void): void;
  /** control-plane → driver：下发用户输入（由 driver echo 回流，见 echo-from-stream）。 */
  submitInput(content: string): Promise<void>;
  close(): void;
}

export interface BridgeFactory {
  connect(sandbox: SandboxHandle): Promise<Bridge>;
}
