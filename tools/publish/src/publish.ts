#!/usr/bin/env bun
// `aprog-publish push <名> <版本>` —— 发布期入口（CLI / CI，跑完即退）。
//
// 程序对 harness 是个目录;对平台是个「包」:版本化、内容寻址、自带依赖闭包与安装清单。
// 本工具把 programs/<名>/<版本>/ 烘成一个 OCI artifact 推到 registry——driver 唤醒时拉的就是它。
//
// 两层解析的「重」那半在这里跑(见 docs/program-package.html#deps):
//   声明  : programs/<名>/<版本>/aprog.json 的 dependencies —— { "state": "0.1.0" }(键=关系给 harness,值=版本给 packager)
//   解析  : 走传递闭包、每个依赖按 digest 钉死、拍平进 config(= lockfile)。SKILL.md 不背依赖、不写版本
//   产物  : 每个程序发成「自己」的 OCI artifact —— 只含本程序一层;config(=lockfile)记整条闭包(每成员 名@版本 + digest + 落地 target)
//           依赖的层不并入,各自待在它的包仓里(分开布局:共享库单一归属、跨仓引用、去重有保证)
// driver(spawn 期)只做「轻」那半:GET 本程序 manifest + config,按 lockfile 逐成员去各自包仓(registry 由 CP 经 seed 下发)取未缓存的层、untar 并排到 skills/。
// 它不读 aprog.json、不递归、不求解——闭包已被本工具拍平钉死。
//
// 载体用 OCI + oras(白嫖 registry/分发/鉴权,与镜像同一套)。本地 registry 用 --plain-http;
// 指向 GHCR 时先 `oras login ghcr.io`(需 write:packages 的 PAT)。
//
// 路径与 cwd 无关:锚 import.meta.dir 向上找 name==="aprog" 的工作区根,再定位 programs/。

import { defineCommand, runMain } from 'citty';
import consola from 'consola';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// citty 借 consola 打 help/错误;TTY 下 consola 默认给每行缀时间戳,关掉(同 aprog-bake)。
consola.options.formatOptions.date = false;

const LAYER_MT = 'application/vnd.aprog.skill.layer.v1.tar+gzip';
const CFG_MT = 'application/vnd.aprog.program.manifest.v1+json';
// 默认指向 GHCR(真发布目标);本地 registry:2 只是验证脚手架,用 --registry localhost:5000 覆盖。
const DEFAULT_REGISTRY = 'ghcr.io/kybera';

// ── 仓库定位（与 aprog-bake 同法）──────────────────────────────────────────
function findRepoRoot(start: string): string {
  for (let dir = start; ; ) {
    try {
      if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'aprog') return dir;
    } catch {
      // 该层没有可读的 package.json —— 继续向上。
    }
    const up = dirname(dir);
    if (up === dir) throw new Error('未找到 aprog 仓库根（向上没有 name="aprog" 的 package.json）');
    dir = up;
  }
}

// ── 闭包解析 ────────────────────────────────────────────────────────────
interface Member {
  name: string;
  version: string;
  dir: string;
}

/** 一条依赖:被依赖程序名 + 精确版本(现阶段写死;range 等真有多版本时再加 resolver)。 */
interface DepRef {
  name: string;
  version: string;
}

/** 读版本目录的 aprog.json,返回 dependencies(名→精确版本)。无 aprog.json = 叶子,无依赖。
 *  依赖声明只在 aprog.json,不在 SKILL.md——SKILL.md 是给 harness 的纯 skill 内容(版本无关、只认关系)。 */
function readDependencies(versionDir: string): DepRef[] {
  const manifestPath = join(versionDir, 'aprog.json');
  if (!existsSync(manifestPath)) return [];
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> };
  return Object.entries(m.dependencies ?? {}).map(([name, version]) => {
    if (typeof version !== 'string' || version.length === 0) {
      throw new Error(`${manifestPath} 的依赖 ${name} 需写精确版本(如 "0.1.0")`);
    }
    return { name, version };
  });
}

/** 从 root 走 aprog.json 依赖传递闭包,按 名@版本 去重(回边即止,容 DAG)。返回含 root 的全集。 */
function resolveClosure(programsDir: string, name: string, version: string): Member[] {
  const seen = new Map<string, Member>();
  const visit = (n: string, v: string): void => {
    const key = `${n}@${v}`;
    if (seen.has(key)) return;
    const dir = join(programsDir, n, v);
    if (!existsSync(dir)) throw new Error(`程序 ${key} 找不到目录:${dir}`);
    seen.set(key, { name: n, version: v, dir });
    for (const d of readDependencies(dir)) visit(d.name, d.version);
  };
  visit(name, version);
  // 按名排序 → manifest 层序确定 → 同内容同 manifest digest(可复现)。
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── 打包 ───────────────────────────────────────────────────────────────
function sh(cmd: string[], cwd?: string): void {
  const p = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error(`命令失败(${p.exitCode}):${cmd.join(' ')}`);
}

/** 确定性打包某 <名>/<版本>/ 目录的内容 → .tar.gz,返回 {文件名, sha256 digest}。
 *  排序 + 固定 mtime + 剥 owner + gzip -n(不写名/时间)→ 同内容 = 同 digest(内容寻址的前提)。 */
function buildLayer(m: Member, workDir: string): { file: string; digest: string } {
  const base = `${m.name}-${m.version}.tar`;
  const tarPath = join(workDir, base);
  sh([
    'tar', '--sort=name', '--owner=0', '--group=0', '--numeric-owner',
    '--mtime=2020-01-01 00:00:00', '-C', m.dir, '-cf', tarPath, '.',
  ]);
  sh(['gzip', '-n', '-f', tarPath]); // → base + ".gz"
  const file = `${base}.gz`;
  const digest = 'sha256:' + createHash('sha256').update(readFileSync(join(workDir, file))).digest('hex');
  return { file, digest };
}

// ── oras 封装 ───────────────────────────────────────────────────────────
function orasExists(): boolean {
  return Bun.spawnSync(['oras', 'version'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
}
function plainHttpFor(registry: string, flag: boolean): boolean {
  return flag || /^(localhost|127\.0\.0\.1)(:|$|\/)/.test(registry);
}
function orasCapture(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(' ')}\n${p.stderr.toString()}`);
  return p.stdout.toString();
}

/** 分开布局:依赖的层必须已发布在它自己的包仓里(driver 跨仓拉取的前提)。
 *  取依赖已发布 manifest 的层 digest,与本地确定性重算的 digest 比对:不存在→提示先发;不一致→提示重发。 */
function verifyDepPublished(registry: string, plain: boolean, m: Member, localDigest: string): void {
  const ref = `${registry}/${m.name}:${m.version}`;
  const flag = plain ? ['--plain-http'] : [];
  let manifest: { layers?: { digest?: string }[] };
  try {
    manifest = JSON.parse(orasCapture(['oras', 'manifest', 'fetch', ...flag, ref]));
  } catch {
    throw new Error(`依赖 ${m.name}@${m.version} 尚未发布(${ref})。分开布局需自底向上先发它:\n  aprog-publish push ${m.name} ${m.version}`);
  }
  const published = manifest.layers?.[0]?.digest;
  if (published !== localDigest) {
    throw new Error(
      `依赖 ${m.name}@${m.version} 已发布的层 digest 与本地不一致:\n  已发布 ${published}\n  本地   ${localDigest}\n源已改或打包不确定,请重发该依赖:aprog-publish push ${m.name} ${m.version}`,
    );
  }
  console.log(`  依赖 ${m.name}@${m.version} 已发布且层 digest 一致 ✓`);
}

// ── push ───────────────────────────────────────────────────────────────
const push = defineCommand({
  meta: { name: 'push', description: '解依赖闭包、组 OCI artifact、推到 registry' },
  args: {
    name: { type: 'positional', description: '程序名 = programs/ 下的目录名(如 design)' },
    version: { type: 'positional', description: '版本 = 版本目录名(如 0.1.0)' },
    registry: { type: 'string', description: `目标 registry[/命名空间](默认 ${DEFAULT_REGISTRY})`, default: DEFAULT_REGISTRY },
    'plain-http': { type: 'boolean', description: 'HTTP 明文(localhost 自动开启)', default: false },
    'dry-run': { type: 'boolean', description: '只解析闭包、打印将推什么,不真推', default: false },
  },
  run({ args }) {
    const repoRoot = findRepoRoot(import.meta.dir);
    const programsDir = join(repoRoot, 'programs');
    const rootDir = join(programsDir, args.name, args.version);
    if (!existsSync(rootDir)) {
      console.error(`找不到程序 ${args.name}@${args.version}:期望 ${rootDir}`);
      const avail = existsSync(programsDir)
        ? readdirSync(programsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
        : [];
      console.error(avail.length ? `programs/ 下有:${avail.join(', ')}` : '(programs/ 为空)');
      process.exit(1);
    }

    const closure = resolveClosure(programsDir, args.name, args.version);
    console.log(`[publish] ${args.name}@${args.version} 闭包(${closure.length}):${closure.map((m) => `${m.name}@${m.version}`).join(', ')}`);

    const workDir = mkdtempSync(join(tmpdir(), 'aprog-publish-'));
    // 对每个闭包成员都确定性打层(为拿 digest 写进 lockfile);但只推「自己」那一层——
    // 分开布局:依赖的层各自待在它的包仓里,driver 按 lockfile 逐成员回各仓拉(digest 因确定性打包跨仓一致)。
    const layers = closure.map((m) => ({ m, ...buildLayer(m, workDir) }));
    const isSelf = (m: Member): boolean => m.name === args.name && m.version === args.version;
    const self = layers.find((l) => isSelf(l.m));
    if (self === undefined) throw new Error(`内部错误:闭包里没有自身 ${args.name}@${args.version}`);
    for (const l of layers) {
      console.log(`  层 ${l.m.name}@${l.m.version}  ${l.digest}  ${isSelf(l.m) ? '(本包·推送)' : '(依赖·引用其包仓)'}`);
    }

    // config blob = lockfile:闭包按 digest 钉死 + 每层落地 target。
    // 分开布局:成员的层在 `<registry>/<成员名>` 仓(registry 运行时由 CP 经 seed 下发给 driver),
    // 故 lockfile 只记 name/version/target/layer,定位靠「同命名空间 + 成员名」约定,不写死 registry。
    const config = {
      schemaVersion: 1,
      name: args.name,
      version: args.version,
      // 源码声明在 aprog.json;产物里原样记录 名@版本(版本只在清单/产物出现,SKILL.md 不背)。
      dependsOn: readDependencies(rootDir).map((d) => `${d.name}@${d.version}`),
      closure: layers.map((l) => ({ name: l.m.name, version: l.m.version, target: `skills/${l.m.name}`, layer: l.digest })),
      install: { bins: [], env: {}, config: {} },
    };
    const cfgFile = `${args.name}-${args.version}.manifest.json`;
    writeFileSync(join(workDir, cfgFile), JSON.stringify(config, null, 2));

    const ref = `${args.registry}/${args.name}:${args.version}`;
    const deps = layers.filter((l) => !isSelf(l.m));
    if (args['dry-run']) {
      console.log(
        `[publish] dry-run:将推 ${ref}(config + 1 自身层)。依赖(${deps.length})引用其包仓:${deps.map((l) => `${l.m.name}@${l.m.version}`).join(', ') || '(无)'}。工件在 ${workDir}`,
      );
      return;
    }
    if (!orasExists()) {
      console.error('未找到 oras。装:https://oras.land/docs/installation 或 `brew/apt` 等。');
      process.exit(1);
    }
    const plain = plainHttpFor(args.registry, args['plain-http']);
    // 分开布局:依赖必须已发布在各自包仓里(driver 跨仓拉取的前提)。逐个校验存在 + digest 一致。
    for (const l of deps) verifyDepPublished(args.registry, plain, l.m, l.digest);

    const cmd = [
      'oras', 'push', ...(plain ? ['--plain-http'] : []), ref,
      '--config', `${cfgFile}:${CFG_MT}`,
      `${self.file}:${LAYER_MT}`, // 只推自身层(依赖层在各自包仓)
    ];
    console.log(`[publish] 推 ${ref}${plain ? '(plain-http)' : ''}(仅自身层;依赖引用 ${deps.length} 个包仓)`);
    sh(cmd, workDir); // cwd=workDir 用相对名,避开 oras 绝对路径校验
    console.log(`[publish] ✓ 已发布 ${ref}`);
  },
});

// ── ls ─────────────────────────────────────────────────────────────────
const ls = defineCommand({
  meta: { name: 'ls', description: '列 registry 里的程序(给名则列其版本 tag)' },
  args: {
    name: { type: 'positional', required: false, description: '程序名(省略=列所有仓库)' },
    registry: { type: 'string', description: `registry(默认 ${DEFAULT_REGISTRY})`, default: DEFAULT_REGISTRY },
    'plain-http': { type: 'boolean', default: false },
  },
  run({ args }) {
    if (!orasExists()) { console.error('未找到 oras。'); process.exit(1); }
    const plain = plainHttpFor(args.registry, args['plain-http']) ? ['--plain-http'] : [];
    if (args.name) {
      // 带名 = 列该程序的版本 tag(GHCR 也支持这条)。
      console.log(orasCapture(['oras', 'repo', 'tags', ...plain, `${args.registry}/${args.name}`]).trim() || '(无 tag)');
      return;
    }
    // 无名 = 全库 catalog。GHCR 不开放 _catalog 列举(会挂),改给指引。
    if (args.registry.startsWith('ghcr.io')) {
      const owner = args.registry.split('/')[1];
      console.error('GHCR 不支持全库 catalog 列举。');
      console.error(`  看所有程序:网页 https://github.com/${owner ? `${owner}?tab=packages` : 'settings/packages'}`);
      console.error('  看某程序版本:aprog-publish ls <名>');
      process.exit(2);
    }
    console.log(orasCapture(['oras', 'repo', 'ls', ...plain, args.registry]).trim() || '(无仓库)');
  },
});

// ── inspect ────────────────────────────────────────────────────────────
const inspect = defineCommand({
  meta: { name: 'inspect', description: '看某版本的 manifest + 依赖闭包(driver 会拿到的那份)' },
  args: {
    name: { type: 'positional', description: '程序名(如 design)' },
    version: { type: 'positional', description: '版本(如 0.1.0)' },
    registry: { type: 'string', description: `registry(默认 ${DEFAULT_REGISTRY})`, default: DEFAULT_REGISTRY },
    'plain-http': { type: 'boolean', default: false },
  },
  run({ args }) {
    if (!orasExists()) { console.error('未找到 oras。'); process.exit(1); }
    const plain = plainHttpFor(args.registry, args['plain-http']) ? ['--plain-http'] : [];
    const ref = `${args.registry}/${args.name}:${args.version}`;
    const manifest = JSON.parse(orasCapture(['oras', 'manifest', 'fetch', ...plain, ref]));
    console.log(`manifest ${ref}`);
    console.log(`  artifactType: ${manifest.artifactType ?? manifest.config?.mediaType}`);
    console.log(`  层数(本仓): ${manifest.layers?.length ?? 0}（分开布局:只含本程序层,依赖层在各自包仓）`);
    // 取 config blob(lockfile),按 layer digest 映射出闭包落地。
    const cfg = JSON.parse(orasCapture(['oras', 'blob', 'fetch', ...plain, '--output', '-', `${args.registry}/${args.name}@${manifest.config.digest}`]));
    console.log('  依赖闭包(name@version → target ← layer):');
    for (const c of cfg.closure ?? []) {
      const here = c.name === args.name && c.version === args.version;
      console.log(`    ${c.name}@${c.version}  →  ${c.target}  ←  ${String(c.layer).slice(0, 19)}…  ${here ? '(本包层·在本仓)' : `(依赖·在 ${c.name} 仓)`}`);
    }
  },
});

const main = defineCommand({
  meta: {
    name: 'aprog-publish',
    description: '把 programs/<名>/<版本>/ 发布成 OCI 程序包(解依赖闭包 + digest 钉死)。子命令:push / ls / inspect',
  },
  subCommands: { push, ls, inspect },
});

runMain(main);
