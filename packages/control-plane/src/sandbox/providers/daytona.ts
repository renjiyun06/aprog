// Daytona 实现——aprog 的默认档（容器级 + gVisor 隔离）。
// A 平面只两件事：create / destroy（进程 hibernate 就是 destroy，让出全部资源；不用 stop——stop 仍计 disk 费）。
// 文件搬运、事件流全走 DriverChannel（B 平面）。
//
// 设计要点：
//  - 依赖注入：client / logger 可注入，便于单测（不需要真实凭据）。缺省用 @daytonaio/sdk 的 Daytona。
//  - 异常：所有 SDK 错误经 mapDaytonaError 归一成 SandboxError（带 code / retryable / cause）。
//  - 重试：仅对 retryable（网络 / 限流 / 超时）做指数退避，次数受 config.maxRetries 限。
//  - 日志：每个操作 info 起、info 成、warn 重试、error 失败，带 sandboxId / snapshot / 耗时。
//  - bootstrap：create 时生成 bindToken 并连同控制平面地址注入沙箱 env，driver 自启后据此拨回（见 docs/interaction.html#trust）。

import { Daytona } from '@daytonaio/sdk';
import type { SandboxProvider } from '../provider.ts';
import type { ImageRef, Resources, SandboxHandle } from '../types.ts';
import type { DaytonaConfig } from '../../config.ts';
import { createLogger, type Logger } from '../../log.ts';
import {
  SandboxConfigError,
  SandboxNotFoundError,
  SandboxValidationError,
  mapDaytonaError,
  type SandboxErrorCode,
} from '../errors.ts';

/** create 入参（与 @daytonaio/sdk CreateSandboxFromSnapshotParams 结构兼容的子集）。 */
interface CreateParams {
  snapshot?: string;
  envVars?: Record<string, string>;
  labels?: Record<string, string>;
  autoStopInterval?: number;
}

/** DI 用的最小 Daytona 客户端面（真实 Daytona 结构上满足）。 */
export interface DaytonaClientLike {
  create(params: CreateParams, options?: { timeout?: number }): Promise<{ id: string }>;
  get(id: string): Promise<{ id: string }>;
  delete(sandbox: { id: string }, timeout?: number): Promise<void>;
}

export interface DaytonaProviderDeps {
  config: DaytonaConfig;
  /** driver 拨回的控制平面地址，注入沙箱 env。 */
  controlPlaneUrl: string;
  /** 注入的客户端（测试用）；缺省用真实 Daytona。 */
  client?: DaytonaClientLike;
  /** 注入的 logger（测试用）；缺省 createLogger('sandbox.daytona')。 */
  logger?: Logger;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class DaytonaProvider implements SandboxProvider {
  readonly id = 'daytona' as const;

  private readonly client: DaytonaClientLike;
  private readonly cfg: DaytonaConfig;
  private readonly controlPlaneUrl: string;
  private readonly log: Logger;

  constructor(deps: DaytonaProviderDeps) {
    this.cfg = deps.config;
    this.controlPlaneUrl = deps.controlPlaneUrl;
    this.log = deps.logger ?? createLogger('sandbox.daytona');

    if (deps.client) {
      this.client = deps.client;
    } else {
      const apiKey = this.cfg.apiKey ?? process.env.DAYTONA_API_KEY;
      if (!apiKey) {
        // 启动期就暴露，而不是等到第一次 create 才炸。
        throw new SandboxConfigError(
          'Daytona apiKey 缺失：设置 config.sandbox.daytona.apiKey 或环境变量 DAYTONA_API_KEY',
          'daytona',
        );
      }
      this.client = new Daytona({
        apiKey,
        apiUrl: this.cfg.apiUrl,
        target: this.cfg.target,
      }) as unknown as DaytonaClientLike;
    }
  }

  async create(image: ImageRef, res: Resources): Promise<SandboxHandle> {
    if (image.provider !== 'daytona') {
      throw new SandboxValidationError(`期望 daytona 镜像，收到 provider=${image.provider}`, 'daytona');
    }
    if (!image.id) {
      throw new SandboxValidationError('image.id（snapshot 名）为空', 'daytona');
    }

    // create-time 绑定凭证 + 控制平面回连地址，注入沙箱环境供 driver 自启后拨回。
    const bindToken = crypto.randomUUID();
    const envVars: Record<string, string> = {
      APROG_BIND_TOKEN: bindToken,
      APROG_CONTROL_PLANE_URL: this.controlPlaneUrl,
    };

    // 注：资源（cpu/mem/disk）在 Daytona 是烘进 snapshot 的，运行期 create 不再传；这里只记录以便观测。
    this.log.info('creating sandbox', {
      snapshot: image.id,
      requestedResources: res,
      autoStopIntervalMin: this.cfg.autoStopIntervalMin,
    });
    const startedAt = Date.now();

    const sandbox = await this.withRetry('create', () =>
      this.client.create(
        {
          snapshot: image.id,
          envVars,
          labels: { 'aprog.managed': 'true' },
          autoStopInterval: this.cfg.autoStopIntervalMin,
        },
        { timeout: this.cfg.createTimeoutSec },
      ),
    );

    this.log.info('sandbox created', { sandboxId: sandbox.id, snapshot: image.id, tookMs: Date.now() - startedAt });
    return { id: sandbox.id, provider: 'daytona', bindToken };
  }

  async destroy(h: SandboxHandle): Promise<void> {
    if (h.provider !== 'daytona') {
      throw new SandboxValidationError(`期望 daytona 句柄，收到 provider=${h.provider}`, 'daytona');
    }

    this.log.info('destroying sandbox', { sandboxId: h.id });
    const startedAt = Date.now();

    try {
      await this.withRetry(
        'destroy',
        async () => {
          const sandbox = await this.client.get(h.id);
          await this.client.delete(sandbox, this.cfg.destroyTimeoutSec);
        },
        ['not_found'], // 预期结果：沙箱已不在 = 幂等成功，不该按 error 级别记
      );
    } catch (e) {
      // 幂等：沙箱已经不在 = 目标达成（休眠/已删），不算失败。
      if (e instanceof SandboxNotFoundError) {
        this.log.warn('sandbox already gone, treating destroy as success', { sandboxId: h.id });
        return;
      }
      throw e;
    }

    this.log.info('sandbox destroyed', { sandboxId: h.id, tookMs: Date.now() - startedAt });
  }

  /**
   * 仅对 retryable 错误做指数退避重试。非 retryable 立即抛；映射后的 SandboxError 一律向上抛。
   * expectedCodes 里的终态错误是调用方预期会处理的（如 destroy 的 not_found 幂等），按 debug 记而非 error。
   */
  private async withRetry<T>(op: string, fn: () => Promise<T>, expectedCodes: SandboxErrorCode[] = []): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        const err = mapDaytonaError(e);
        if (!err.retryable || attempt >= this.cfg.maxRetries) {
          if (expectedCodes.includes(err.code)) {
            this.log.debug(`${op} ended with expected error`, { op, code: err.code });
          } else {
            this.log.error(`${op} failed`, { op, attempt, error: err });
          }
          throw err;
        }
        attempt += 1;
        const backoffMs = 250 * 2 ** (attempt - 1);
        this.log.warn(`${op} transient error, retrying`, { op, attempt, code: err.code, backoffMs, error: err });
        await sleep(backoffMs);
      }
    }
  }
}
