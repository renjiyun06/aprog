// AgentBay（阿里云无影）实现——国内档。MicroVM 隔离，出站开放（不像 Daytona Tier1/2 锁死出站），
// 原生 betaPause/betaResume（内存级休眠/唤醒，比「destroy+检查点重放」更省更快，后续可据此优化 hibernate/wake）。
// A 平面只两件事：create / destroy（与 Daytona 一致）。文件搬运/事件流走 DriverChannel（B 平面）。
//
// 与 Daytona 的关键差异：
//  - Daytona 把 driver 烘进镜像、随 entrypoint 自启；AgentBay 暂用公共镜像 code_latest（node18），
//    driver 不烘镜像，create 时经 fileSystem.writeFile 运行时推入 + 后台 node 启动（见 driverBundlePath）。
//    （生产化要烘自定义镜像需 Pro 档；运行时推可免 Pro，代价是每次 create 多 ~1s 推包。）
//  - 资源规格：AgentBay 由 imageId/镜像设置决定，create 不传 cpu/mem（res 仅作日志/契约）。
//  - 凭证注入：bindToken + 控制平面地址 + injectedEnv 经 command.run 的 envs 注入到 driver 进程。

import { readFileSync } from 'node:fs';
import type { SandboxProvider } from '../provider.ts';
import type { ImageRef, Resources, SandboxHandle } from '../types.ts';
import { createLogger, type Logger } from '@aprog/log';
import { SandboxConfigError, SandboxError, SandboxValidationError } from '../errors.ts';

/** DI 用的最小 AgentBay 会话面（真实 wuying-agentbay-sdk 的 Session 结构上满足）。 */
export interface AgentBaySessionLike {
  sessionId: string;
  fileSystem: {
    createDirectory(path: string): Promise<unknown>;
    writeFile(path: string, content: string): Promise<unknown>;
  };
  command: {
    run(
      command: string,
      timeoutMs?: number,
      cwd?: string,
      envs?: Record<string, string>,
    ): Promise<{ output?: string; exitCode?: number; success?: boolean }>;
  };
}

/** DI 用的最小 AgentBay 客户端面。 */
export interface AgentBayClientLike {
  create(params: { imageId?: string }): Promise<{ session?: AgentBaySessionLike; success?: boolean }>;
  get(sessionId: string): Promise<{ session?: AgentBaySessionLike; success?: boolean }>;
  delete(session: AgentBaySessionLike): Promise<unknown>;
}

export interface AgentBayProviderDeps {
  /** AgentBay API key；缺省取 process.env.AGENTBAY_API_KEY。 */
  apiKey?: string;
  /** driver 拨回的控制平面地址，注入 driver env（公网 nginx:80 反代 → frps → CP）。 */
  controlPlaneUrl: string;
  /** create 时额外注入 driver 的环境变量（如引擎鉴权 ANTHROPIC_AUTH_TOKEN）。密钥走这里运行时注入，不落镜像。 */
  injectedEnv?: Record<string, string>;
  /** node-target driver bundle（.mjs）的本地路径。create 时读取并 writeFile 推入沙箱。 */
  driverBundlePath: string;
  /** 缺省 AgentBay imageId（ImageRef.id 为空时用）。 */
  defaultImageId?: string;
  /** 注入的客户端（测试用）；缺省用真实 AgentBay。 */
  client?: AgentBayClientLike;
  /** 注入的 logger（测试用）。 */
  logger?: Logger;
}

/** 沙箱内 driver 落点（node18 对 .js 默认按 CommonJS，bundle 是 ESM → 必须 .mjs）。 */
const DRIVER_DIR = '/opt/aprog/bin';
const DRIVER_PATH = `${DRIVER_DIR}/driver.mjs`;
const DRIVER_LOG = '/var/log/aprog-driver.log';

export class AgentBayProvider implements SandboxProvider {
  readonly id = 'agentbay' as const;

  private readonly client: AgentBayClientLike;
  private readonly controlPlaneUrl: string;
  private readonly injectedEnv: Record<string, string>;
  private readonly driverBundle: string;
  private readonly defaultImageId: string;
  private readonly log: Logger;
  /** sandboxId → 活跃 Session，供 destroy 直接删（CP 重启即失，与内存态 DriverRegistry 一致）。 */
  private readonly sessions = new Map<string, AgentBaySessionLike>();

  constructor(deps: AgentBayProviderDeps) {
    this.controlPlaneUrl = deps.controlPlaneUrl;
    this.injectedEnv = deps.injectedEnv ?? {};
    this.defaultImageId = deps.defaultImageId ?? 'code_latest';
    this.log = deps.logger ?? createLogger('sandbox.agentbay');

    // driver bundle 启动期就读入并缓存：缺失/读不到立刻暴露，而非等到第一次 create 才炸。
    try {
      this.driverBundle = readFileSync(deps.driverBundlePath, 'utf8');
    } catch (e) {
      throw new SandboxConfigError(`读不到 driver bundle：${deps.driverBundlePath}`, 'agentbay', e);
    }

    if (deps.client) {
      this.client = deps.client;
    } else {
      const apiKey = deps.apiKey ?? process.env.AGENTBAY_API_KEY;
      if (!apiKey) {
        throw new SandboxConfigError(
          'AgentBay apiKey 缺失：设置 deps.apiKey 或环境变量 AGENTBAY_API_KEY',
          'agentbay',
        );
      }
      // 延迟 require：仅在真用 AgentBay 时加载重 SDK，避免 mock/Daytona 路径白扛依赖。
      const { AgentBay } = require('wuying-agentbay-sdk') as { AgentBay: new (o: { apiKey: string }) => AgentBayClientLike };
      this.client = new AgentBay({ apiKey });
    }
  }

  async create(image: ImageRef, res: Resources): Promise<SandboxHandle> {
    if (image.provider !== 'agentbay') {
      throw new SandboxValidationError(`期望 agentbay 镜像，收到 provider=${image.provider}`, 'agentbay');
    }
    const imageId = image.id || this.defaultImageId;
    const bindToken = crypto.randomUUID();
    const startedAt = Date.now();
    this.log.info('creating sandbox', { imageId, requestedResources: res });

    let session: AgentBaySessionLike;
    try {
      const r = await this.client.create({ imageId });
      if (!r.session) throw new Error(`create 未返回 session（success=${r.success}）`);
      session = r.session;
    } catch (e) {
      throw this.wrap('create', e);
    }

    try {
      // 1) 运行时推 driver bundle（.mjs）入沙箱。
      await session.fileSystem.createDirectory(DRIVER_DIR);
      await session.fileSystem.writeFile(DRIVER_PATH, this.driverBundle);

      // 2) 后台启动 driver：注入回连凭证 env，nohup 脱离，立即返回（driver 自启即拨 CP）。
      const envs: Record<string, string> = {
        APROG_BIND_TOKEN: bindToken,
        APROG_CONTROL_PLANE_URL: this.controlPlaneUrl,
        ...this.injectedEnv,
      };
      const launch = `cd ${DRIVER_DIR} && nohup node ${DRIVER_PATH} > ${DRIVER_LOG} 2>&1 & echo "launched pid=$!"`;
      const lr = await session.command.run(launch, 30000, DRIVER_DIR, envs);
      this.log.info('driver launched', { sandboxId: session.sessionId, out: (lr.output ?? '').trim().slice(0, 80) });
    } catch (e) {
      // 推包/启动失败 → 回收会话，避免泄漏。
      await this.client.delete(session).catch(() => {});
      throw this.wrap('bootstrap', e);
    }

    this.sessions.set(session.sessionId, session);
    this.log.info('sandbox created', { sandboxId: session.sessionId, imageId, tookMs: Date.now() - startedAt });
    return { id: session.sessionId, provider: 'agentbay', bindToken };
  }

  async destroy(h: SandboxHandle): Promise<void> {
    if (h.provider !== 'agentbay') {
      throw new SandboxValidationError(`期望 agentbay 句柄，收到 provider=${h.provider}`, 'agentbay');
    }
    this.log.info('destroying sandbox', { sandboxId: h.id });
    const startedAt = Date.now();
    try {
      let session = this.sessions.get(h.id);
      if (!session) {
        // CP 重启后 map 已失 → 用 sessionId 重新取回会话句柄再删。
        const r = await this.client.get(h.id);
        session = r.session ?? undefined;
      }
      if (!session) {
        this.log.warn('session already gone, treating destroy as success', { sandboxId: h.id });
        return;
      }
      await this.client.delete(session);
      this.sessions.delete(h.id);
    } catch (e) {
      throw this.wrap('destroy', e);
    }
    this.log.info('sandbox destroyed', { sandboxId: h.id, tookMs: Date.now() - startedAt });
  }

  /** 把 AgentBay SDK 的错误归一成 SandboxError（最小：统一 unknown，保留 cause/op）。 */
  private wrap(op: string, e: unknown): SandboxError {
    if (e instanceof SandboxError) return e;
    const msg = e instanceof Error ? e.message : String(e);
    this.log.error(`${op} failed`, { op, error: msg });
    return new SandboxError(`agentbay ${op} error: ${msg}`, { code: 'unknown', provider: 'agentbay', retryable: false, cause: e });
  }
}
