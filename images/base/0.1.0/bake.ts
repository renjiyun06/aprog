#!/usr/bin/env bun
// images/base/0.1.0 —— aprog 基础沙箱镜像 v0.1.0。
//
// 「打镜像 = 跑这个目录里的 bake.ts」：直接调 @daytonaio/sdk 把 base + 引擎拼成命名 snapshot。
// 由 `aprog-bake base 0.1.0` 调起（见 packages/sandbox/src/cli.ts），也可单独 `bun run` 本文件。
// 版本 = 目录名（0.1.0，人定、发布后不可变）；snapshot 名 = aprog-base:0.1.0。
//
// 当前是基础镜像：OS + Bun + 引擎运行时（Claude Code）。driver / 额外工具（capability）的注入
// ——把编好的 amd64 产物 addLocalDir 到 /opt/aprog/bin——等能力那块落地后在此补上（见
// docs/sandbox.html#image 三层、#tools）。工具是镜像的材料、可各自是独立项目，由本脚本引用 / 构建进来。

import { Daytona, Image } from '@daytonaio/sdk';

const SNAPSHOT = 'aprog-base:0.1.0';

const apiKey = process.env.DAYTONA_API_KEY;
if (!apiKey) {
  console.error('需要 DAYTONA_API_KEY 才能烘镜像（设置环境变量后重试）');
  process.exit(1);
}

// base + 引擎运行时。多语言工具的编译在镜像外先做完，这里只注入成品（暂无）。
const image = Image.base('ubuntu:24.04')
  .runCommands(
    'apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates unzip',
    'curl -fsSL https://bun.sh/install | bash',
    'curl -fsSL https://claude.ai/install.sh | bash', // 引擎运行时：Claude Code
  )
  .env({ PATH: '/opt/aprog/bin:/root/.bun/bin:/root/.local/bin:$PATH' });
// TODO(capability)：.addLocalDir('<staging/bin>', '/opt/aprog/bin') —— driver + 工具，编好 amd64 后注入。

const daytona = new Daytona({ apiKey });
console.log(`[bake] ${SNAPSHOT} 烘制中…`);
await daytona.snapshot.create(
  { name: SNAPSHOT, image, resources: { cpu: 2, memory: 4, disk: 10 } },
  { onLogs: (chunk: string) => process.stdout.write(chunk) },
);
console.log(`[bake] 完成 → ImageRef { provider: 'daytona', id: '${SNAPSHOT}' }`);
