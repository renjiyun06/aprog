// 烘镜像抽象。这是厂商间「最不能统一」的一步——四种互不兼容的模型：
//   声明式 code builder（Daytona addLocalDir / E2B 2.0 / Modal）
//   Dockerfile / registry 镜像（Fly / Northflank / Cloudflare / Kata 自托管）
//   blueprint / template（Runloop / CodeSandbox）
//   跑起来再存快照（Morph Infinibranch）
// 所以这里只定一个统一「输入」(BakeSpec) 和「不透明产物」(ImageRef)，
// 具体怎么烘交给各策略实现（见 bakers/）。

import type { ImageRef, Resources } from './types.ts';

/**
 * 烘一个 aprog 沙箱镜像的统一描述。与底层策略无关：
 * 声明式策略直接消费它；Dockerfile 策略据此生成 Dockerfile + COPY；
 * 快照策略据此 boot→exec 安装→save。
 */
export interface BakeSpec {
  /**
   * 镜像名（content-hash tag，如 `aprog-sandbox:<sha12>`）。由 bake 策略层算好传入。
   * ImageRef-always：通常恒有值——Daytona 等无匿名镜像，且让 SandboxProvider.create 的
   * ImageRef 契约在 dev/prod、各厂商间保持一致。可选仅为给「支持匿名构建」的策略留口子。
   */
  name?: string;
  /** 基础镜像，必须钉死 tag（Daytona 等不接受 latest）。 */
  base: string;
  /** 引擎运行时的安装命令（Claude Agent SDK / Codex），作为 RUN 注入。 */
  engines: string[];
  /** 本地已编好的 amd64 产物目录/文件（capabilities 的 staging/bin、driver），注入 /opt/aprog/bin。 */
  localBins: string[];
  /** 额外 RUN 命令。 */
  commands: string[];
  /** 环境变量（如把 /opt/aprog/bin 加进 PATH）。 */
  env?: Record<string, string>;
  /** 资源规格——Daytona 烘进 snapshot；别的厂商可能在 create 时才用。 */
  resources?: Resources;
}

export interface ImageBaker {
  readonly strategy: 'declarative' | 'dockerfile' | 'snapshot';
  /** 烘镜像，返回不透明 ImageRef 供 SandboxProvider.create 消费。 */
  bake(spec: BakeSpec): Promise<ImageRef>;
}

/**
 * 厂商分叉接缝。declarative 策略下 Daytona / E2B / Modal 步骤顺序相同、只是 SDK 方言不同——
 * DeclarativeBaker 持步骤骨架（厂商无关），把这 4 个动词 + finalize 交给各厂商的 ImageBuilder 实现。
 * 详见 docs/sandbox.html#seam。
 */
export interface ImageBuilder {
  /** 基础镜像。 */
  base(image: string): void;
  /** 一条 RUN。 */
  run(cmd: string): void;
  /** 把本地目录注入镜像（Daytona addLocalDir / E2B copy）。 */
  copyDir(local: string, dest: string): void;
  /** 环境变量。 */
  env(vars: Record<string, string>): void;
  /** 物化：注册/构建镜像，返回不透明 ImageRef。name 为镜像名（content-hash），res 为资源规格。 */
  finalize(name: string | undefined, res: Resources | undefined): Promise<ImageRef>;
}
