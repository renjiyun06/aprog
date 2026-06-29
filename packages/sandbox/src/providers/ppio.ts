// PPIO（派欧云）实现——国内档，E2B 协议同构的托管沙箱（中国版 E2B）。Firecracker MicroVM，
// 冷启 ~4s，出站对国内开放（回拨 CP / GLM / npmmirror 均通，无需 VPN）。A 平面只两件事：create / destroy。
// 文件搬运/事件流走 DriverChannel（B 平面）。
//
// 设计要点：
//  - SDK 形态：ppio-sandbox（E2B 同构）。create/kill 是「静态 + 按 sandboxId」——destroy 只凭 id 即可
//    Sandbox.kill(id)，无需缓存会话句柄（故无 sessions Map）。
//  - 鉴权：一把 PPIO_API_KEY（sk_）既作运行时 apiKey、也作 CLI 管理面 accessToken；这里只用运行时那半。
//    显式经 opts.apiKey 注入（不靠进程级 env），DI 友好。
//  - 以 root 跑：base 镜像（ubuntu:24.04）把工具/引擎装进 /root、默认用户设 root。PPIO 是否认 USER root
//    作运行时默认用户未文档化，故这里对每个 files.write/commands.run 显式带 user:'root'——无论默认用户是谁，
//    driver 都以 root 落 /root/aprog、以 root 跑。base 自带 node（nvm LTS 软链到 /usr/local/bin，非交互 PATH 可见）。
//  - driver 不烘镜像、运行时经 files.write 推入 + 后台 node 启动（跑 .mjs 无碍）。
//    凭证（bindToken + 控制平面地址 + injectedEnv）经 commands.run 的 envs 注入到 driver 进程。
//  - 自定义镜像（claude+GLM 路由等）走 images/<名>/<版本>/ppio/bake.ts（ppio.Dockerfile + template build），
//    兑现为不透明的 template id 喂进 ImageRef.id；本层不碰打包。

import { readFileSync } from 'node:fs';
import type { CreateOptions, SandboxProvider } from '../provider.ts';
import type { ImageRef, Resources, SandboxHandle } from '../types.ts';
import { createLogger, type Logger } from '@aprog/log';
import { SandboxConfigError, SandboxError, SandboxValidationError } from '../errors.ts';

/** DI 用的最小 PPIO 沙箱实例面（真实 ppio-sandbox 的 Sandbox 结构上满足）。 */
export interface PPIOSandboxLike {
  readonly sandboxId: string;
  files: {
    write(path: string, data: string, opts?: { user?: string }): Promise<unknown>;
  };
  commands: {
    run(
      cmd: string,
      opts?: { envs?: Record<string, string>; cwd?: string; timeoutMs?: number; background?: boolean; user?: string },
    ): Promise<{ stdout?: string; exitCode?: number; pid?: number }>;
  };
}

/** DI 用的最小 PPIO 静态 API 面（create + 按 id kill）。 */
export interface PPIOSandboxApiLike {
  create(
    template: string | undefined,
    opts: { apiKey?: string; timeoutMs?: number; envs?: Record<string, string> },
  ): Promise<PPIOSandboxLike>;
  kill(sandboxId: string, opts: { apiKey?: string }): Promise<boolean>;
}

export interface PPIOProviderDeps {
  /** PPIO API key（sk_）；缺省取 process.env.PPIO_API_KEY。 */
  apiKey?: string;
  /** driver 拨回的控制平面地址，注入 driver env（公网可达，沙箱据此回连）。https:// 即走 TLS 回拨。 */
  controlPlaneUrl: string;
  /**
   * 控制平面回拨入口的 CA 证书（PEM，公开非密）。配了它：把证书 files.write 进沙箱、并给 driver 设
   * NODE_EXTRA_CA_CERTS，使其 https 回拨时信任这张自签证书。留空 = 明文 http 回拨（开发态/内网）。
   */
  caCertPem?: string;
  /** create 时额外注入 driver 的环境变量（如引擎鉴权 ANTHROPIC_AUTH_TOKEN）。密钥走这里运行时注入，不落镜像。 */
  injectedEnv?: Record<string, string>;
  /** node-target driver bundle（.mjs）的本地路径。create 时读取并 files.write 推入沙箱。 */
  driverBundlePath: string;
  /** 缺省 PPIO 模板（ImageRef.id 为空时用）；为空则用 SDK 默认 base 镜像（code-interpreter）。 */
  defaultTemplate?: string;
  /** 沙箱存活上限（毫秒）。按秒计费，给个合理上限避免空跑；缺省 10 分钟。 */
  sandboxTimeoutMs?: number;
  /** 注入的静态 API（测试用）；缺省用真实 ppio-sandbox。 */
  api?: PPIOSandboxApiLike;
  /** 注入的 logger（测试用）。 */
  logger?: Logger;
}

/** 沙箱内 driver 落点（以 root 跑，落 root home 下可写目录；node18+ 对 .js 默认 CommonJS，bundle 是 ESM → 必须 .mjs）。 */
const DRIVER_DIR = '/root/aprog';
const DRIVER_PATH = `${DRIVER_DIR}/driver.mjs`;
const DRIVER_LOG = `${DRIVER_DIR}/driver.log`;
/** 控制平面回拨入口的 CA 证书在沙箱内的落点（配了 caCertPem 时写入，并经 NODE_EXTRA_CA_CERTS 让 driver 信任）。 */
const DRIVER_CA_PATH = `${DRIVER_DIR}/cp-ca.pem`;
/** 引擎二进制（claude-code）在镜像里的落点：ppio.Dockerfile 把 claude 软链到此。
 *  driver 的 bundle 后 SDK 自带二进制路径解析失效，故经 APROG_ENGINE_BIN 显式指给它（见 driver/engine.ts）。 */
const ENGINE_BIN = '/usr/local/bin/claude';

export class PPIOProvider implements SandboxProvider {
  readonly id = 'ppio' as const;

  private readonly api: PPIOSandboxApiLike;
  private readonly apiKey: string;
  private readonly controlPlaneUrl: string;
  private readonly caCertPem?: string;
  private readonly injectedEnv: Record<string, string>;
  private readonly driverBundle: string;
  private readonly defaultTemplate?: string;
  private readonly sandboxTimeoutMs: number;
  private readonly log: Logger;

  constructor(deps: PPIOProviderDeps) {
    this.controlPlaneUrl = deps.controlPlaneUrl;
    this.caCertPem = deps.caCertPem;
    this.injectedEnv = deps.injectedEnv ?? {};
    this.defaultTemplate = deps.defaultTemplate || undefined;
    this.sandboxTimeoutMs = deps.sandboxTimeoutMs ?? 600_000;
    this.log = deps.logger ?? createLogger('sandbox.ppio');

    // driver bundle 启动期就读入并缓存：缺失/读不到立刻暴露，而非等到第一次 create 才炸。
    try {
      this.driverBundle = readFileSync(deps.driverBundlePath, 'utf8');
    } catch (e) {
      throw new SandboxConfigError(`读不到 driver bundle：${deps.driverBundlePath}`, 'ppio', e);
    }

    const apiKey = deps.apiKey ?? process.env.PPIO_API_KEY;
    if (!apiKey) {
      throw new SandboxConfigError('PPIO apiKey 缺失：设置 deps.apiKey 或环境变量 PPIO_API_KEY', 'ppio');
    }
    this.apiKey = apiKey;

    if (deps.api) {
      this.api = deps.api;
    } else {
      // 延迟 require：仅在真用 PPIO 时加载 SDK，避免 mock 路径白扛依赖。
      // ppio-sandbox 的 Sandbox.create/kill 是静态方法（kill 继承自 SandboxApi）。
      const { Sandbox } = require('ppio-sandbox') as {
        Sandbox: {
          create(template: string, opts: object): Promise<PPIOSandboxLike>;
          create(opts: object): Promise<PPIOSandboxLike>;
          kill(sandboxId: string, opts: object): Promise<boolean>;
        };
      };
      this.api = {
        create: (template, opts) =>
          template ? Sandbox.create(template, opts) : Sandbox.create(opts),
        kill: (sandboxId, opts) => Sandbox.kill(sandboxId, opts),
      };
    }
  }

  async create(image: ImageRef, res: Resources, opts: CreateOptions): Promise<SandboxHandle> {
    if (image.provider !== 'ppio') {
      throw new SandboxValidationError(`期望 ppio 镜像，收到 provider=${image.provider}`, 'ppio');
    }
    const template = image.id || this.defaultTemplate;
    // bindToken 由控制平面侧生成并经 opts 传入——provider 不自造信任凭证，只机械注入。
    const bindToken = opts.bindToken;
    const startedAt = Date.now();
    this.log.info('creating sandbox', { template: template ?? '(base)', requestedResources: res });

    let sbx: PPIOSandboxLike;
    try {
      sbx = await this.api.create(template, { apiKey: this.apiKey, timeoutMs: this.sandboxTimeoutMs });
    } catch (e) {
      throw this.wrap('create', e);
    }

    try {
      // 沙箱已起、driver 尚未启动——这是消除竞态的唯一窗口：先让上层据 sandboxId 完成 bindToken 登记，
      // await 它返回后再放 driver 拨号，保证「登记早于拨号」。
      if (opts.onProvisioned) await opts.onProvisioned({ sandboxId: sbx.sandboxId });

      // 1) 运行时推 driver bundle（.mjs）入沙箱（files.write 自动建父目录）。user:'root' 保证落点 /root 可写
      //    （即便 PPIO 运行时默认用户仍是 user）。
      await sbx.files.write(DRIVER_PATH, this.driverBundle, { user: 'root' });
      // 1b) 若回拨走 TLS：把 CP 边缘的 CA 证书（公开非密）推进沙箱，下面经 NODE_EXTRA_CA_CERTS 让 driver 信任。
      if (this.caCertPem) await sbx.files.write(DRIVER_CA_PATH, this.caCertPem, { user: 'root' });

      // 2) 后台启动 driver：注入回连凭证 env。必须用 background:true——driver 是长驻进程（跑满沙箱生命周期、
      //    且握手失败会退避重试），若用前台 run/`&` 则 commands.run 会一直等它退出而超时。background 立即返回。
      //    登记已先于此完成（见上 onProvisioned），driver 首拨即应命中；retry 仅兜网络抖动，不再兜竞态。
      //    NODE_EXTRA_CA_CERTS 必须在 node 启动前置于其 env（node 启动期一次性读入）——这里随 run 注入即满足。
      const envs: Record<string, string> = {
        APROG_BIND_TOKEN: bindToken,
        APROG_CONTROL_PLANE_URL: this.controlPlaneUrl,
        APROG_ENGINE_BIN: ENGINE_BIN, // driver 据此用镜像烘好的 claude 起引擎
        ...(this.caCertPem ? { NODE_EXTRA_CA_CERTS: DRIVER_CA_PATH } : {}),
        ...this.injectedEnv,
      };
      const lr = await sbx.commands.run(`node ${DRIVER_PATH} > ${DRIVER_LOG} 2>&1`, {
        envs,
        cwd: DRIVER_DIR,
        background: true,
        user: 'root',
      });
      this.log.info('driver launched', { sandboxId: sbx.sandboxId, pid: lr.pid });
    } catch (e) {
      // 推包/启动失败 → 回收沙箱，避免泄漏与计费空跑。
      await this.api.kill(sbx.sandboxId, { apiKey: this.apiKey }).catch(() => {});
      throw this.wrap('bootstrap', e);
    }

    this.log.info('sandbox created', { sandboxId: sbx.sandboxId, template: template ?? '(base)', tookMs: Date.now() - startedAt });
    return { id: sbx.sandboxId, provider: 'ppio', bindToken };
  }

  async destroy(h: SandboxHandle): Promise<void> {
    if (h.provider !== 'ppio') {
      throw new SandboxValidationError(`期望 ppio 句柄，收到 provider=${h.provider}`, 'ppio');
    }
    this.log.info('destroying sandbox', { sandboxId: h.id });
    const startedAt = Date.now();
    try {
      // 按 id 直接杀（静态）；返回 false = 沙箱已不在，幂等当成功。
      const ok = await this.api.kill(h.id, { apiKey: this.apiKey });
      if (!ok) this.log.warn('sandbox already gone, treating destroy as success', { sandboxId: h.id });
    } catch (e) {
      throw this.wrap('destroy', e);
    }
    this.log.info('sandbox destroyed', { sandboxId: h.id, tookMs: Date.now() - startedAt });
  }

  /** 把 PPIO SDK 的错误归一成 SandboxError（最小：统一 unknown，保留 cause/op）。 */
  private wrap(op: string, e: unknown): SandboxError {
    if (e instanceof SandboxError) return e;
    const msg = e instanceof Error ? e.message : String(e);
    this.log.error(`${op} failed`, { op, error: msg });
    return new SandboxError(`ppio ${op} error: ${msg}`, { code: 'unknown', provider: 'ppio', retryable: false, cause: e });
  }
}
