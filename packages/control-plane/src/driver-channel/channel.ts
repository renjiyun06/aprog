// CP 侧 driver 通道（南面）。一条 driver 拨入的 WebSocket = 一个沙箱/进程的常驻双工连接。
// 与 driver 侧共用 @aprog/protocol/channel 的帧契约（不重定义）。
//
// 当前只实现握手：driver 发 Hello → CP 据 bindToken 认领（registry.resolve）→ 回 Welcome，
// 并把连接钉到 pid（活连接表，给将来下行 input/control/fs 用）。事件流/输入/控制/seed 等
// 按统一帧格式（Frame<t,p>）后续扩展——此处不预先铺设。
//
// http.ts（唯一 Bun.serve）负责 upgrade 判定 + 把 Bun 的 websocket 回调转给本模块；通道逻辑全在这。

import type { ServerWebSocket } from 'bun';
import {
  CHANNEL_PROTOCOL_VERSION,
  type ControlPlaneFrame,
  type DriverFrame,
  type Hello,
  type Welcome,
} from '@aprog/protocol/channel';
import type { DriverRegistry } from './registry.ts';

/** driver 拨入的 WS 路径（driver 从 APROG_CONTROL_PLANE_URL 推导拨这）。 */
export const DRIVER_CHANNEL_PATH = '/v1/driver/channel';

/** 每条连接挂的状态（Bun 的 ws.data）。握手成功后填 pid/sandboxId。 */
interface SessionData {
  pid?: number;
  sandboxId?: string;
}

type Ws = ServerWebSocket<SessionData>;

/** 一条已绑定的 driver 活连接（Deps.channelFor 背后；当前最小，仅够下发帧）。 */
export interface DriverConnection {
  readonly pid: number;
  readonly sandboxId: string;
  /** 下发一帧（CP→driver）。 */
  send(frame: ControlPlaneFrame): void;
}

/**
 * CP 侧 driver 通道服务。持有 DriverRegistry（bindToken→绑定）与活连接表（pid→ws）。
 * 把 Bun websocket 的 open/message/close 回调收口于此；http.ts 只做装配。
 */
export class DriverChannelServer {
  private readonly conns = new Map<number, Ws>();

  constructor(private readonly registry: DriverRegistry) {}

  /** http.ts：是否是 driver WS 升级路径。 */
  matches(method: string, pathname: string): boolean {
    return method === 'GET' && pathname === DRIVER_CHANNEL_PATH;
  }

  /** http.ts：upgrade 时塞进 ws.data 的初值。 */
  newSessionData(): SessionData {
    return {};
  }

  /** 取某进程当前的活连接（Deps.channelFor 背后）。 */
  connectionFor(pid: number): DriverConnection | undefined {
    const ws = this.conns.get(pid);
    if (ws === undefined || ws.data.pid === undefined || ws.data.sandboxId === undefined) return undefined;
    const sandboxId = ws.data.sandboxId;
    return {
      pid,
      sandboxId,
      send: (frame) => ws.send(JSON.stringify(frame)),
    };
  }

  /** 交给 Bun.serve 的 websocket 回调集。 */
  readonly websocket = {
    open: (_ws: Ws): void => {
      console.log('[driver-channel] WS 已连，等 Hello…');
    },
    message: (ws: Ws, raw: string | Buffer): void => {
      this.onMessage(ws, typeof raw === 'string' ? raw : raw.toString('utf8'));
    },
    close: (ws: Ws): void => {
      const { pid } = ws.data;
      if (pid !== undefined && this.conns.get(pid) === ws) {
        this.conns.delete(pid);
        console.log(`[driver-channel] WS 关闭 pid=${pid}`);
      }
    },
  };

  private onMessage(ws: Ws, raw: string): void {
    let frame: DriverFrame;
    try {
      frame = JSON.parse(raw) as DriverFrame;
    } catch {
      console.warn('[driver-channel] 收到非 JSON 帧，忽略');
      return;
    }
    if (frame.t === 'hello') {
      this.onHello(ws, frame);
      return;
    }
    // 当前只处理握手；其余帧（事件流/fs 等）待扩展。
    console.warn(`[driver-channel] 暂不处理帧 t=${frame.t}`);
  }

  private onHello(ws: Ws, hello: Hello): void {
    const { protocolVersion, bindToken } = hello.p;
    if (protocolVersion !== CHANNEL_PROTOCOL_VERSION) {
      console.warn(`[driver-channel] 协议版本不匹配 driver=${protocolVersion} cp=${CHANNEL_PROTOCOL_VERSION} —— 关连接`);
      ws.close(1002, 'protocol version mismatch');
      return;
    }
    const binding = this.registry.resolve(bindToken);
    if (binding === undefined) {
      // 未知 bindToken：可能是登记/拨号竞态（虽已 register-before-launch，仍兜网络抖动）。关连接，driver 重拨。
      console.warn('[driver-channel] 未知 bindToken —— 关连接（driver 将重拨）');
      ws.close(1008, 'unknown bindToken');
      return;
    }
    ws.data.pid = binding.pid;
    ws.data.sandboxId = binding.sandboxId;
    this.conns.set(binding.pid, ws);
    const welcome: Welcome = {
      t: 'welcome',
      p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, pid: String(binding.pid), mode: 'restore' },
    };
    ws.send(JSON.stringify(welcome));
    console.log(`[driver-channel] driver 拨入 ✓ pid=${binding.pid} sandbox=${binding.sandboxId} → Welcome`);
  }
}
