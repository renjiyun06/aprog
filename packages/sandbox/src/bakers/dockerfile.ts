// Dockerfile 策略。给只接受 OCI 镜像 / Dockerfile 的厂商（Fly / Northflank / Cloudflare / Kata 自托管）。
// 据 BakeSpec 生成一个 Dockerfile：FROM base → RUN engines → COPY localBins /opt/aprog/bin → ENV，
// 然后走该厂商的镜像构建/推送通道，返回 registry 镜像引用作 ImageRef。
//
// 与声明式策略的差别：注入靠 COPY（构建上下文自带），构建可能要本地 Docker 或厂商 builder。

import type { ImageBaker, BakeSpec } from '../baker.ts';
import type { ImageRef } from '../types.ts';

export class DockerfileBaker implements ImageBaker {
  readonly strategy = 'dockerfile' as const;

  async bake(spec: BakeSpec): Promise<ImageRef> {
    void spec;
    throw new Error('not implemented'); // 生成 Dockerfile + COPY，推到目标 registry
  }
}
