// control-plane 运行配置。占位——后续从环境变量 / 配置文件读。

export interface Config {
  /** API 监听端口。 */
  port: number;
  /** 进程目录与快照的根（平台侧）。 */
  dataDir: string;
  /** 沙箱提供方配置（Daytona）。 */
  sandbox: {
    provider: 'daytona';
    // endpoint / token 等待补。
  };
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APROG_PORT ?? 8099),
    dataDir: process.env.APROG_DATA_DIR ?? '/var/lib/aprog',
    sandbox: { provider: 'daytona' },
  };
}
