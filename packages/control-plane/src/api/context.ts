// API 层的公共类型：请求上下文、处理器签名、以及 API 能够到达的子系统集合（Deps）。
//
// 关键约定（见 docs/api-impl.html）：route 处理器是「翻译膜」——只做
//   鉴权 → 授权 → 校验 → 调子系统 → 序列化
// 业务逻辑住在 Deps 指向的子系统里（ProcessManager / stream / driver-channel），不在 API 层。

import type { ProcessManager } from '../process/manager.ts';
import type { LifecycleHub } from '../process/lifecycle.ts';
import type { StreamStore } from '../stream/store.ts';
import type { StreamHub } from '../stream/hub.ts';
import type { DriverConnection } from '../driver-channel/channel.ts';
import type { DriverRegistry } from '../driver-channel/registry.ts';
import type { UserStore } from '../auth/users.ts';
import type { TokenStore } from '../auth/tokens.ts';
import type { CodeStore } from '../auth/codes.ts';
import type { EmailSender } from '../auth/email.ts';
import type { ProgramCatalog } from '../catalog/programs.ts';
import type { InstallStore } from '../catalog/installs.ts';

/** 用户对某进程的角色（见 docs/api.html#sharing）。 */
export type Role = 'owner' | 'editor' | 'viewer';

/** 鉴权后的用户。 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * API 层能够到达的子系统（在 http.ts 组装时注入）。
 * 这是 API 与"真正干活的核"之间的唯一接缝——处理器只调这里的方法。
 */
export interface Deps {
  /** 用户存储：注册、激活、登录校验、取用户。 */
  users: UserStore;
  /** 会话 token：签发 / 解析 / 吊销。 */
  tokens: TokenStore;
  /** 邮箱验证 token + 登录验证码。 */
  codes: CodeStore;
  /** 发邮件（验证链接 / 登录码）。 */
  email: EmailSender;
  /** 程序目录：列出可装的智能程序。 */
  catalog: ProgramCatalog;
  /** 安装记录：列出 / 安装 / 卸载用户的程序。 */
  installs: InstallStore;
  /** 进程编排：ps / spawn / wake / hibernate / 取 PCB。 */
  procs: ProcessManager;
  /** 进程生命周期扇出：状态变更广播给该用户的 SSE 订阅（账号级 GET /proc/stream）。 */
  lifecycle: LifecycleHub;
  /** 事件流存储：盖 seq、落库、回放。 */
  store: StreamStore;
  /** 事件流扇出：live 广播给多个订阅者。 */
  hub: StreamHub;
  /** 取某进程当前的 driver 通道（running 时有；input/interrupt/fs 实时穿透用）。 */
  channelFor(pid: number): DriverConnection | undefined;
  /** driver 握手登记簿：create 沙箱时登记 bindToken，driver 拨入时认领绑定（见 routes/driver.ts）。 */
  drivers: DriverRegistry;
}

/** 基础请求上下文（鉴权前）。 */
export interface ReqCtx {
  req: Request;
  /** 路径参数（如 :pid）。 */
  params: Record<string, string>;
  /** 查询串。 */
  query: URLSearchParams;
  /** 注入的子系统。 */
  deps: Deps;
}

/** 鉴权后的上下文：必带 user（由 withAuth 填充）。 */
export interface AuthCtx extends ReqCtx {
  user: User;
}

/** 路由级处理器（鉴权前；如 /auth/login）。 */
export type Handler = (ctx: ReqCtx) => Response | Promise<Response>;

/** 需登录的处理器（拿到带 user 的 AuthCtx）。 */
export type AuthHandler = (ctx: AuthCtx) => Response | Promise<Response>;
