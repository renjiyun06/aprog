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
import { existsSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;
const TEMPLATE_NAME = process.env.APROG_PPIO_TEMPLATE_NAME ?? 'aprog-base-glm';
const CLI = process.env.PPIO_SANDBOX_CLI ?? 'ppio-sandbox-cli';

/** 出网代理 v2ray 二进制：vendor 进构建上下文（Dockerfile `COPY v2ray`），但不入库（见 .gitignore）。
 *  构建前确保它在位——缺则从 github releases 下载并解压（一次性、在 dev 机上，构建本身不再依赖被墙的 github）。
 *  固定版本，避免漂移；APROG_V2RAY_VERSION 可覆盖。 */
const V2RAY_VERSION = process.env.APROG_V2RAY_VERSION ?? 'v5.49.0';

async function ensureV2ray(): Promise<void> {
  const bin = join(HERE, 'v2ray');
  if (existsSync(bin)) {
    console.log('[bake:ppio] v2ray 二进制已在位，跳过下载。');
    return;
  }
  const url = `https://github.com/v2fly/v2ray-core/releases/download/${V2RAY_VERSION}/v2ray-linux-64.zip`;
  console.log(`[bake:ppio] v2ray 缺失 → 下载 ${url}（约 19MB，国内可能较慢）`);
  const zip = join(HERE, 'v2ray.zip');
  await run('curl', ['-sS', '-L', '--connect-timeout', '8', '--retry', '3', '--retry-delay', '2', '-o', zip, url]);
  await run('unzip', ['-o', zip, 'v2ray', '-d', HERE]); // 只取主程序（无 routing 段不需 geoip/geosite）
  chmodSync(bin, 0o755);
  await run('rm', ['-f', zip]);
  console.log('[bake:ppio] v2ray 二进制就位。');
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit' });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

const token = process.env.PPIO_ACCESS_TOKEN ?? process.env.PPIO_API_KEY;
if (!token) {
  console.error('缺少 PPIO 鉴权：设 PPIO_ACCESS_TOKEN（= PPIO_API_KEY，sk_）');
  process.exit(1);
}

// 构建前确保 vendor 的 v2ray 二进制在位（Dockerfile 会 COPY 它）。
await ensureV2ray();

// -p 把构建根目录设到本目录：CLI 在其中默认找 ppio.Dockerfile，COPY settings.json / v2ray 也相对它。
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
