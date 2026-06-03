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
