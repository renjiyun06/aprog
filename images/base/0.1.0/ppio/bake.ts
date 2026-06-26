#!/usr/bin/env bun
// images/base/0.1.0/ppio/bake.ts —— 把本目录的 ppio.Dockerfile 烘成 PPIO 自定义模板。
// 由 `aprog-bake base 0.1.0 ppio` 调起（见 tools/bake/src/bake.ts），或直接 `bun run` 本文件。
//
// 零抽象：直调 ppio-sandbox-cli `template build`（本地 docker build + push + 注入 envd 层），产出
// 一个不透明 template_id。把它设给 control-plane 的 APROG_PPIO_TEMPLATE，沙箱即从该模板起
// （内含 claude-code + GLM 路由；密钥/driver 运行时注入，不在镜像里）。
//
// 前置：
//   · 本机 Docker 可用、已 docker login 到 PPIO registry（image.ppinfra.com）。
//   · PPIO 鉴权：环境变量 PPIO_ACCESS_TOKEN（= PPIO_API_KEY，sk_）。
//   · ppio-sandbox-cli 在 PATH 上（或经 PPIO_SANDBOX_CLI 指定其路径）。

import { spawn } from 'node:child_process';

const HERE = import.meta.dir;
const TEMPLATE_NAME = process.env.APROG_PPIO_TEMPLATE_NAME ?? 'aprog-base-glm';
const CLI = process.env.PPIO_SANDBOX_CLI ?? 'ppio-sandbox-cli';

const token = process.env.PPIO_ACCESS_TOKEN ?? process.env.PPIO_API_KEY;
if (!token) {
  console.error('缺少 PPIO 鉴权：设 PPIO_ACCESS_TOKEN（= PPIO_API_KEY，sk_）');
  process.exit(1);
}

// -p 把构建根目录设到本目录：CLI 在其中默认找 ppio.Dockerfile，COPY settings.json 也相对它。
// （不传 -d：设了 -p 后 CLI 会把 -d 当作相对 root 再拼接，绝对路径会被毁成 ./<abs>。）
// 不设 -c 启动命令：driver 在运行时推入并自启，envd 才是真正的常驻入口。
const args = ['template', 'build', '-n', TEMPLATE_NAME, '-p', HERE];

console.log(`[bake:ppio] ${CLI} ${args.join(' ')}`);
const child = spawn(CLI, args, {
  stdio: 'inherit',
  env: { ...process.env, PPIO_ACCESS_TOKEN: token },
});
child.on('exit', (code) => {
  if (code === 0) {
    console.log(`[bake:ppio] 完成。模板名=${TEMPLATE_NAME}。`);
    console.log('[bake:ppio] 取 template_id：ppio-sandbox-cli template list；设 APROG_PPIO_TEMPLATE=<id> 即生效。');
  }
  process.exit(code ?? 1);
});
