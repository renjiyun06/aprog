// 跑后存快照策略。Morph（Infinibranch）这类没有 build-time 文件 API 的厂商专用：
// boot 一个实例 → 经 exec/SSH 把 engines + localBins 装进去 → save snapshot → 返回 snapshot 作 ImageRef。
// 是四种里最异类的——所以单独隔离，绝不勉强塞进声明式/Dockerfile 的形状。

import type { ImageBaker, BakeSpec } from '../baker.ts';
import type { ImageRef } from '../types.ts';

export class SnapshotBaker implements ImageBaker {
  readonly strategy = 'snapshot' as const;

  async bake(spec: BakeSpec): Promise<ImageRef> {
    void spec;
    throw new Error('not implemented'); // boot → exec 安装 → save snapshot
  }
}
