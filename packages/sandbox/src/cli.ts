#!/usr/bin/env bun
// `aprog-bake <镜像名> <版本>` —— 打镜像入口（构建期 / CLI / CI）。
//
// 镜像 = 仓库顶层 images/<名>/<版本>/ 一个目录；本命令就是「找到那个目录、跑它的 bake.ts」。
// 不在这里做任何策略 / 厂商抽象——每个 bake.ts 自己直调厂商 SDK（见 docs/sandbox.html#bake）。
//   例: aprog-bake base 0.1.0   →   跑 images/base/0.1.0/bake.ts

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [name, version] = process.argv.slice(2);
if (!name || !version) {
  console.error('用法: aprog-bake <镜像名> <版本>   例: aprog-bake base 0.1.0');
  process.exit(2);
}

// images/ 在仓库顶层：本文件位于 packages/sandbox/src/cli.ts → 上溯三层到仓库根。
const repoRoot = join(import.meta.dir, '..', '..', '..');
const bakePath = join(repoRoot, 'images', name, version, 'bake.ts');
if (!existsSync(bakePath)) {
  console.error(`找不到镜像 ${name}@${version}：期望 ${bakePath}`);
  process.exit(1);
}

console.log(`[aprog-bake] 跑 ${bakePath}`);
const proc = Bun.spawn(['bun', 'run', bakePath], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
process.exit(await proc.exited);
