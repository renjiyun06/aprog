// control-plane 运行配置。从环境变量读（占位默认值便于本地起）。

export interface DaytonaConfig {
  /** Daytona API key。缺省读 DAYTONA_API_KEY。没有则 DaytonaProvider 构造期报 SandboxConfigError。 */
  apiKey?: string;
  /** Daytona API URL。缺省走 SDK 默认（https://app.daytona.io/api）或 DAYTONA_API_URL。 */
  apiUrl?: string;
  /** 目标区域。缺省 DAYTONA_TARGET。 */
  target?: string;
  /** create 的默认超时（秒）。 */
  createTimeoutSec: number;
  /** destroy 的默认超时（秒）。 */
  destroyTimeoutSec: number;
  /** 瞬态错误（网络/限流/超时）最大重试次数。 */
  maxRetries: number;
  /**
   * 沙箱 auto-stop 闲置分钟数（0=禁用）。我们的休眠是显式 destroy，留个兜底防失联沙箱常驻烧钱。
   */
  autoStopIntervalMin: number;
}

export interface Config {
  /** API 监听端口。 */
  port: number;
  /** 进程目录与快照的根（平台侧）。 */
  dataDir: string;
  /** driver 拨回的控制平面地址（注入沙箱环境，driver 据此回连）。 */
  controlPlaneUrl: string;
  /** 沙箱提供方配置。 */
  sandbox: {
    provider: 'daytona';
    daytona: DaytonaConfig;
  };
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APROG_PORT ?? 8099),
    dataDir: process.env.APROG_DATA_DIR ?? '/var/lib/aprog',
    controlPlaneUrl: process.env.APROG_CONTROL_PLANE_URL ?? 'https://localhost:8099',
    sandbox: {
      provider: 'daytona',
      daytona: {
        apiKey: process.env.DAYTONA_API_KEY,
        apiUrl: process.env.DAYTONA_API_URL,
        target: process.env.DAYTONA_TARGET,
        createTimeoutSec: Number(process.env.APROG_DAYTONA_CREATE_TIMEOUT_SEC ?? 120),
        destroyTimeoutSec: Number(process.env.APROG_DAYTONA_DESTROY_TIMEOUT_SEC ?? 60),
        maxRetries: Number(process.env.APROG_DAYTONA_MAX_RETRIES ?? 2),
        autoStopIntervalMin: Number(process.env.APROG_DAYTONA_AUTOSTOP_MIN ?? 30),
      },
    },
  };
}
