// Daytona 的 declarative ImageBuilder —— DeclarativeBaker 在 Daytona 一侧的「方言适配器」。
// 把厂商无关的 4 个动词翻译成 @daytonaio/sdk 的 Image 链式调用，finalize 走 snapshot.create。
//
// 跟 DaytonaProvider 同目录、同风格：client / logger 可注入（便于单测，不需真实凭据），
// SDK 错误经 mapDaytonaError 归一成 SandboxError。详见 docs/sandbox.html#seam。
//
// 注意：Daytona 的 snapshot.create 的 name 必填——没有匿名/on-the-fly 的命名镜像。
// 所以 finalize 要求 BakeSpec.name 有值（ImageRef-always）：bake 永远产出一个命名 ImageRef，
// 让 SandboxProvider.create 的 ImageRef 契约在 dev/prod、各厂商间保持一致。

import { Daytona, Image } from '@daytonaio/sdk';
import type { Resources as DaytonaResources } from '@daytonaio/sdk';
import type { ImageBuilder } from '../baker.ts';
import type { ImageRef, Resources } from '../types.ts';
import type { DaytonaConfig } from '../config.ts';
import { createLogger, type Logger } from '@aprog/log';
import { SandboxConfigError, SandboxValidationError, mapDaytonaError } from '../errors.ts';

/** DI 用的最小快照客户端面（真实 Daytona 的 .snapshot 结构上满足）。 */
export interface DaytonaSnapshotClientLike {
  snapshot: {
    create(
      params: { name: string; image: Image; resources?: DaytonaResources },
      options?: { onLogs?: (chunk: string) => void },
    ): Promise<unknown>;
  };
}

export interface DaytonaImageBuilderDeps {
  /** Daytona 凭据/配置；缺省从环境变量 DAYTONA_API_KEY 取。 */
  config?: DaytonaConfig;
  /** 注入的快照客户端（测试用）；缺省用真实 Daytona。 */
  client?: DaytonaSnapshotClientLike;
  /** 注入的 logger（测试用）。 */
  logger?: Logger;
}

export class DaytonaImageBuilder implements ImageBuilder {
  private readonly client: DaytonaSnapshotClientLike;
  private readonly log: Logger;
  // 累积中的镜像定义。base() 会重置它；DeclarativeBaker 保证 base() 最先调。
  private img: Image = Image.base('ubuntu:24.04');

  constructor(deps: DaytonaImageBuilderDeps = {}) {
    this.log = deps.logger ?? createLogger('sandbox.daytona.bake');
    if (deps.client) {
      this.client = deps.client;
    } else {
      const apiKey = deps.config?.apiKey ?? process.env.DAYTONA_API_KEY;
      if (!apiKey) {
        throw new SandboxConfigError(
          'Daytona apiKey 缺失：设置环境变量 DAYTONA_API_KEY 或注入 config',
          'daytona',
        );
      }
      this.client = new Daytona({
        apiKey,
        apiUrl: deps.config?.apiUrl,
        target: deps.config?.target,
      }) as unknown as DaytonaSnapshotClientLike;
    }
  }

  base(image: string): void {
    this.img = Image.base(image);
  }

  run(cmd: string): void {
    this.img = this.img.runCommands(cmd);
  }

  copyDir(local: string, dest: string): void {
    this.img = this.img.addLocalDir(local, dest);
  }

  env(vars: Record<string, string>): void {
    this.img = this.img.env(vars);
  }

  async finalize(name: string | undefined, res: Resources | undefined): Promise<ImageRef> {
    if (!name) {
      throw new SandboxValidationError(
        'Daytona 需要 snapshot 名（content-hash）才能注册镜像；BakeSpec.name 为空',
        'daytona',
      );
    }
    this.log.info('baking snapshot', { name });
    const startedAt = Date.now();
    try {
      await this.client.snapshot.create(
        { name, image: this.img, resources: res },
        { onLogs: (chunk) => this.log.debug('daytona build', { name, chunk }) },
      );
    } catch (e) {
      const err = mapDaytonaError(e);
      this.log.error('snapshot bake failed', { name, error: err });
      throw err;
    }
    this.log.info('snapshot baked', { name, tookMs: Date.now() - startedAt });
    return { provider: 'daytona', id: name };
  }
}
