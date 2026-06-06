// 声明式 builder 策略。最贴 aprog 的烘法：本地先编好 binary，再注入。
// Daytona / E2B 2.0 / Modal 都属此类——共享「步骤顺序 + 注入约定」这套骨架，厂商无关。
//
// 厂商差异（addLocalDir vs copy、snapshot.create vs build）不在这里，而在注入的 ImageBuilder
// 实现里（见 providers/daytona-builder.ts 等）。本类一字不提任何厂商 SDK。详见 docs/sandbox.html#seam。

import type { ImageBaker, BakeSpec, ImageBuilder } from '../baker.ts';
import type { ImageRef } from '../types.ts';

/** 注入的 ImageBuilder 工厂——每次 bake 现取一个新 builder（builder 内部累积状态）。 */
export type ImageBuilderFactory = () => ImageBuilder;

export class DeclarativeBaker implements ImageBaker {
  readonly strategy = 'declarative' as const;

  constructor(private readonly newBuilder: ImageBuilderFactory) {}

  async bake(spec: BakeSpec): Promise<ImageRef> {
    const b = this.newBuilder();
    b.base(spec.base);
    for (const e of spec.engines) b.run(e);
    for (const d of spec.localBins) b.copyDir(d, '/opt/aprog/bin'); // 注入约定：成品架统一落 /opt/aprog/bin
    for (const c of spec.commands) b.run(c);
    if (spec.env) b.env(spec.env);
    return b.finalize(spec.name, spec.resources);
  }
}
