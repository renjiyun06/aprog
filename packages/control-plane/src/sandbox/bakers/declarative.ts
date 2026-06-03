// 声明式 builder 策略。最贴 aprog 的烘法：本地先编好 binary，再注入。
// Daytona / E2B 2.0 / Modal 都属此类——核心是一个 addLocalDir 把 staging/bin 塞进镜像。
//
// Daytona 实现示意（@daytona/sdk）：
//   Image.base(spec.base)
//     .runCommands(...spec.engines)
//     .addLocalDir(localBin, '/opt/aprog/bin')
//     .runCommands('chmod +x /opt/aprog/bin/*')
//     .env(spec.env)
//   → daytona.snapshot.create({ name: `aprog-sandbox:${hash}`, image, resources })
// 构建发生在 Daytona 云端 runner，无需本地 Docker。

import type { ImageBaker, BakeSpec } from '../baker.ts';
import type { ImageRef } from '../types.ts';

export class DeclarativeBaker implements ImageBaker {
  readonly strategy = 'declarative' as const;

  async bake(spec: BakeSpec): Promise<ImageRef> {
    void spec;
    throw new Error('not implemented'); // 首个落地：Daytona snapshot.create
  }
}
