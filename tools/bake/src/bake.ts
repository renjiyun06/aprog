#!/usr/bin/env bun
// `aprog-bake <镜像名> <版本> <供应商>` —— 打镜像入口（构建期 / CLI / CI）。
//
// 镜像是抽象的、与平台无关：「base 0.1.0」是一个逻辑镜像，各供应商各自打包。故目录结构：
//   images/<名>/<版本>/        ← 版本目录 = 逻辑镜像（中立；跨供应商共享的材料放这层）
//   images/<名>/<版本>/<供应商>/bake.ts   ← 各家怎么打包（直调各自厂商 SDK，零抽象层）
// 本命令就是「按 名+版本+供应商 找到那个 bake.ts、跑它」。
//   例: aprog-bake base 0.1.0 daytona                       →  跑 images/base/0.1.0/daytona/bake.ts
//   例: aprog-bake base 0.1.0 daytona --cpu 4 --memory 8 --disk 20   →  覆盖资源(经 env 透传给 bake.ts)
// 资源(cpu/内存/磁盘)是平台 Resources 三元组；本命令只转发、不解释——给了才经 env 透传，否则 bake.ts 用自带默认。
//
// 路径靠两层约定，与 cwd 无关：
//   L1 工具→仓库根：锚定 import.meta.dir（Bun 已把 ~/.bun/bin 的软链解析成真实仓库内位置）
//                   向上找标记 = name==="aprog" 的工作区根 package.json；再经 APROG_REPO_ROOT 传给 bake.ts。
//   L2 参数→目标  ：images/<名>/<版本>/<供应商>/bake.ts（文件系统即 registry）。
// 由此 aprog-bake 永远操作「它被 bun link 的那个仓库」的 images/，在任何目录敲都对。

import { defineCommand, runMain } from 'citty';
import consola from 'consola';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// citty 用 consola(同一单例)打 help / version / 错误；consola 在 TTY 下默认给每条输出缀一个
// [时间] 标签，使 `--help` 看着像日志。关掉它即可——date 是 consola 文档化的 formatOptions 开关。
// 标准 runMain 用法不动，只驯服它的输出层。
consola.options.formatOptions.date = false;

/** 从 start 向上，找到 name==="aprog" 的工作区根 package.json 所在目录。 */
function findRepoRoot(start: string): string {
  for (let dir = start; ; ) {
    try {
      if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'aprog') return dir;
    } catch {
      // 该层没有可读的 package.json —— 继续向上。
    }
    const up = dirname(dir);
    if (up === dir) {
      throw new Error('未找到 aprog 仓库根（向上没有 name="aprog" 的 package.json）');
    }
    dir = up;
  }
}

/** 枚举 images/ 下所有「有 bake.ts」的 <名> <版本> <供应商> 三元组，给找不到时当提示。 */
function listImages(imagesDir: string): string[] {
  if (!existsSync(imagesDir)) return [];
  const dirs = (p: string) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory());
  const out: string[] = [];
  for (const name of dirs(imagesDir)) {
    for (const ver of dirs(join(imagesDir, name.name))) {
      for (const prov of dirs(join(imagesDir, name.name, ver.name))) {
        if (existsSync(join(imagesDir, name.name, ver.name, prov.name, 'bake.ts'))) {
          out.push(`${name.name} ${ver.name} ${prov.name}`);
        }
      }
    }
  }
  return out.sort();
}

const main = defineCommand({
  meta: {
    name: 'aprog-bake',
    description: '把 images/<名>/<版本>/<供应商>/bake.ts 烘成厂商镜像（构建期，跑完即退）',
  },
  args: {
    name: { type: 'positional', description: '镜像名 = images/ 下的目录名（例: base）' },
    version: { type: 'positional', description: '版本 = 版本目录名（例: 0.1.0）' },
    provider: { type: 'positional', description: '供应商 = 版本目录下的子目录名（例: daytona）' },
    // 资源覆盖（可选）：平台 Resources 三元组。给了才透传，否则 bake.ts 用它自带的默认。
    cpu: { type: 'string', description: '覆盖 vCPU 核数（默认由 bake.ts 定）' },
    memory: { type: 'string', description: '覆盖内存 GiB（默认由 bake.ts 定）' },
    disk: { type: 'string', description: '覆盖磁盘 GiB（默认由 bake.ts 定）' },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(import.meta.dir);
    const imagesDir = join(repoRoot, 'images');
    const bakePath = join(imagesDir, args.name, args.version, args.provider, 'bake.ts');

    if (!existsSync(bakePath)) {
      console.error(`找不到镜像 ${args.name}@${args.version} 的 ${args.provider} 打包：期望 ${bakePath}`);
      const avail = listImages(imagesDir);
      console.error(avail.length ? `可选:\n  ${avail.join('\n  ')}` : '(images/ 下暂无任何 bake.ts)');
      process.exit(1);
    }

    // 透传给 bake.ts（本命令只转发、不解释）：仓库根 + 给了的资源覆盖。
    // 资源值只在显式提供时塞进 env，缺省让 bake.ts 走自带默认。
    const env: Record<string, string> = { ...process.env, APROG_REPO_ROOT: repoRoot };
    if (args.cpu !== undefined) env.APROG_CPU = String(args.cpu);
    if (args.memory !== undefined) env.APROG_MEMORY = String(args.memory);
    if (args.disk !== undefined) env.APROG_DISK = String(args.disk);

    console.log(`[aprog-bake] 跑 ${bakePath}`);
    const proc = Bun.spawn(['bun', 'run', bakePath], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit', env });
    process.exit(await proc.exited);
  },
});

runMain(main);
