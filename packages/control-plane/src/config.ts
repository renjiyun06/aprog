// control-plane 运行配置。从环境变量读（占位默认值便于本地起）。
// provider 各自的配置形状（如 DaytonaConfig）住在 @aprog/sandbox——它是 provider 入参契约，
// 这里只 import 再组合进总 Config。

import type { DaytonaConfig } from '@aprog/sandbox';

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
