// 各 provider 的配置形状。与 provider 实现同包——它是 provider 的入参契约，
// control-plane 的总 Config 从这里 import 再组合（见 control-plane/src/config.ts）。

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
