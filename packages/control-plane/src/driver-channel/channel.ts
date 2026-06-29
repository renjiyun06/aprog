// CP 侧 driver 通道（南面）。一条 driver 拨入的 WebSocket = 一个沙箱/进程的常驻双工连接。
// 与 driver 侧共用 @aprog/protocol/channel 的帧契约（不重定义）。
//
// 唤醒闭环：driver 发 Hello → CP 据 bindToken 认领（registry.resolve）→ 回 Welcome → 紧接下发 Seed
// （要恢复哪个进程：程序坐标 + 进程仓库地址 + 现签短票，由 seedFor 从 PCB 取）。driver 据 Seed 部署程序与
// 进程态、起引擎，就绪后回 Ready → CP 经 onReady 把进程由 waking 翻为 running。连接钉到 pid（活连接表，给
// 将来下行 input/control/fs 用）。
// 凭证续签：进程态仓短票 TTL ~1h，长进程会跑过期，故 driver 临过期前发 RenewRepo，CP 经 renewRepoFor 重签
// 回 RepoToken（以连接绑定的 pid 为准，防越权）。事件流/输入/控制等按统一帧格式后续扩展——此处不预先铺设。
//
// http.ts（唯一 Bun.serve）负责 upgrade 判定 + 把 Bun 的 websocket 回调转给本模块；通道逻辑全在这。

import type { ServerWebSocket } from 'bun';
import {
  CHANNEL_PROTOCOL_VERSION,
  type ControlPlaneFrame,
  type DriverFrame,
  type Hello,
  type RepoCredential,
  type RepoToken,
  type Seed,
  type Welcome,
} from '@aprog/protocol/channel';
import type { Event as HarnessEvent } from '@aprog/protocol/harness';
import type { DriverRegistry } from './registry.ts';

/** driver 拨入的 WS 路径（driver 从 APROG_CONTROL_PLANE_URL 推导拨这）。 */
export const DRIVER_CHANNEL_PATH = '/v1/driver/channel';

/** 握手成功后向 driver 下发的恢复种子载荷（由 http.ts 组装：PCB + issuer 现签的短票）。
 *  异步：签票要调 GitHub App。undefined = 无此进程，跳过下发。 */
export type SeedFor = (pid: number) => Promise<Seed['p'] | undefined>;
/** driver 回 Ready 时的回调（http.ts 接 ProcessManager.markReady）。 */
export type OnReady = (pid: number) => void;
/** driver 求续签时为某进程重签仓库短票（http.ts 接 issuer.mintRepoToken）。undefined = 无 PCB / 未配 issuer。 */
export type RenewRepoFor = (pid: number) => Promise<RepoCredential | undefined>;
/** driver 上行一条 harness 事件时的回调（http.ts 接 store.append + hub.publish）。pid 取连接绑定者。 */
export type OnEvent = (pid: number, event: HarnessEvent) => void;

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

  constructor(
    private readonly registry: DriverRegistry,
    /** 取某进程的恢复种子（程序坐标 + 仓库地址）；握手后下发给 driver。 */
    private readonly seedFor: SeedFor,
    /** driver 回 Ready 的去向：把进程从 waking 翻为 running。 */
    private readonly onReady: OnReady,
    /** driver 求续签时重签仓库短票（默认不签：未配 issuer / 测试场景）。 */
    private readonly renewRepoFor: RenewRepoFor = async () => undefined,
    /** driver 上行 harness 事件的去向（默认丢弃：未装配 stream / 测试场景）。 */
    private readonly onEvent: OnEvent = () => {},
  ) {}

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
    if (frame.t === 'ready') {
      const pid = ws.data.pid;
      if (pid === undefined) {
        console.warn('[driver-channel] 收到 Ready 但连接未握手，忽略');
        return;
      }
      console.log(`[driver-channel] driver Ready pid=${pid} → 置 running`);
      this.onReady(pid);
      return;
    }
    if (frame.t === 'renew-repo') {
      // 以连接绑定的 pid 为准（防越权续他人之票）；帧内 pid 仅作可读，不取信。
      const pid = ws.data.pid;
      if (pid === undefined) {
        console.warn('[driver-channel] 收到 RenewRepo 但连接未握手，忽略');
        return;
      }
      void this.sendRepoToken(ws, pid);
      return;
    }
    if (frame.t === 'event') {
      // 引擎事件上行 → 交给 onEvent（盖全局 seq + 落库 + 扇出）。pid 取连接绑定者（不信帧）。
      const pid = ws.data.pid;
      if (pid === undefined) {
        console.warn('[driver-channel] 收到 event 但连接未握手，忽略');
        return;
      }
      this.onEvent(pid, frame.p.event);
      return;
    }
    // 其余帧（输入/fs 等下行帧不该由 driver 发；未知帧）——cast 仅为前向兼容。
    console.warn(`[driver-channel] 暂不处理帧 t=${(frame as DriverFrame).t}`);
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
    // 紧接下发 Seed（异步：签票要调 GitHub App）。告诉 driver 要恢复哪个进程 + 现签的短命窄权凭证。
    void this.sendSeed(ws, binding.pid);
  }

  /** 组装并下发 Seed。bindToken 已在 onHello 验过 → 此刻才为该进程现签凭证（防冒认闸门）。 */
  private async sendSeed(ws: Ws, pid: number): Promise<void> {
    let seedP: Seed['p'] | undefined;
    try {
      seedP = await this.seedFor(pid);
    } catch (e) {
      console.error(`[driver-channel] pid=${pid} 组装 Seed 失败（签票出错？）:`, e);
      return;
    }
    if (seedP === undefined) {
      console.warn(`[driver-channel] pid=${pid} 无 PCB，未下发 Seed`);
      return;
    }
    if (this.conns.get(pid) !== ws) return; // 期间连接已换/关，丢弃
    ws.send(JSON.stringify({ t: 'seed', p: seedP } satisfies Seed));
    console.log(
      `[driver-channel] 下发 Seed pid=${pid} program=${seedP.program.id}@${seedP.program.version ?? '-'} repoCred=${seedP.repoCredential ? '有' : '无'}`,
    );
  }

  /** 应 RenewRepo：为该进程重签仓库短票并回 RepoToken。pid 已是连接绑定者（onMessage 取自 ws.data）。 */
  private async sendRepoToken(ws: Ws, pid: number): Promise<void> {
    let cred: RepoCredential | undefined;
    try {
      cred = await this.renewRepoFor(pid);
    } catch (e) {
      console.error(`[driver-channel] pid=${pid} 续签仓库短票失败:`, e);
      return;
    }
    if (cred === undefined) {
      console.warn(`[driver-channel] pid=${pid} 无法续签（无 PCB / 未配 issuer），未回 RepoToken`);
      return;
    }
    if (this.conns.get(pid) !== ws) return; // 期间连接已换/关，丢弃
    ws.send(JSON.stringify({ t: 'repo-token', p: { pid: String(pid), repoCredential: cred } } satisfies RepoToken));
    console.log(`[driver-channel] 续签 RepoToken pid=${pid} expiresAt=${cred.expiresAt}`);
  }
}
