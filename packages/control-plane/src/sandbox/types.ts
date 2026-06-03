// 沙箱层的公共类型。运行时控制面在各厂商间高度一致，所以这些类型是 provider-neutral 的；
// 唯独「烘镜像」差异大，被关进 ImageBaker（见 baker.ts）后只对外暴露一个不透明的 ImageRef。

/** 厂商标识。 */
export type ProviderId = 'daytona' | 'e2b' | 'northflank' | 'morph';

/** 一个已烘好的镜像/快照的不透明引用。怎么烘出来的（声明式/Dockerfile/跑后存）对运行时不可见。 */
export interface ImageRef {
  provider: ProviderId;
  /** 厂商侧的句柄：Daytona 的 snapshot 名、E2B 的 template id… */
  id: string;
}

/** 资源规格。注意 Daytona 把它烘进 snapshot；别的厂商在 create 时给。 */
export interface Resources {
  cpu: number;     // vCPU
  memory: number;  // GiB
  disk: number;    // GiB
  gpu?: number;
}

/**
 * 厂商能力位。运行时控制面虽相似，但几个关键点必须按能力分流，不能假设：
 *  - pty：交互式 PTY（harness 桥接靠它）。Daytona/E2B 一等；Modal/Cloudflare 缺。
 *  - memorySnapshot：内存级挂起恢复（有则 hibernate 可省去 tar-out）。E2B/Fly/Morph 有。
 *  - egressAllowlist：出站白名单（capability 访问企业系统按 scope 放行）。
 */
export interface ProviderCaps {
  pty: boolean;
  memorySnapshot: boolean;
  egressAllowlist: boolean;
}

/** 运行中沙箱的句柄。 */
export interface SandboxHandle {
  id: string;
  provider: ProviderId;
  /** driver 监听的连接信息，供 Bridge 建管道。 */
  endpoint: string;
}

/**
 * 休眠态。hibernate 的产物，对调用方不透明——provider 内部决定它是
 * 「内存快照」还是「导出的进程目录」，wake 时按同一形态还原。
 */
export type Dormant =
  | { kind: 'memory-snapshot'; provider: ProviderId; snapshotId: string }
  | { kind: 'extracted'; provider: ProviderId; snapshotPath: string };

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 交互式 PTY 会话（仅当 caps.pty 为 true）。 */
export interface PtySession {
  write(data: string): void;
  onData(handler: (chunk: string) => void): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
