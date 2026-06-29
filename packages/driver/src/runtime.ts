// driver 侧运行环境准备：把一个进程「铺」到沙箱里——克隆进程态 git 仓库、拉取并铺设程序闭包、（占位）起引擎。
// 进程目录约定 ~/.aprog/<pid>/（类比 /proc/<pid>/）：git 仓库的工作树即进程态（execution-state/ / input.md /
// session.jsonl…），程序闭包铺到其下 skills/<名>/（target 由 lockfile 给）。
//
// 凭证用后即弃：clone/pull 持 Seed 现签的短票，落盘后不再保留明文（git remote 里嵌的 token 由续签按需替换）。
// 引擎拉起仍占位——本轮只落地 clone（②）与 pull（③）；起引擎随后增量补。

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Seed } from '@aprog/protocol/channel';
import type { Event as HarnessEvent } from '@aprog/protocol/harness';
import { sh } from './exec.ts';
import { pullProgram } from './oci.ts';
import { startEngine, type EngineHandle } from './engine.ts';

/** 进程目录：~/.aprog/<pid>/。沙箱内以 root 跑 → /root/.aprog/<pid>/。 */
export function procDirOf(pid: string): string {
  return join(homedir(), '.aprog', pid);
}

/**
 * 克隆/同步进程态仓库到进程目录。
 * cloneUrl 须为带凭证的 URL（repoCredential.url，内嵌 x-access-token:<token>）。
 * 已存在 .git（resume/重连）→ 换 remote + fetch + 硬重置到上游；否则全新 clone。
 */
export async function cloneRepo(cloneUrl: string, procDir: string): Promise<void> {
  if (existsSync(join(procDir, '.git'))) {
    await sh('git', ['-C', procDir, 'remote', 'set-url', 'origin', cloneUrl]);
    await sh('git', ['-C', procDir, 'fetch', '--prune', 'origin']);
    // 上游默认分支：fetch 后取 origin/HEAD；取不到（裸新仓）则跳过重置，留当前工作树。
    try {
      const head = (await sh('git', ['-C', procDir, 'rev-parse', '--abbrev-ref', 'origin/HEAD'])).trim();
      if (head) await sh('git', ['-C', procDir, 'reset', '--hard', head]);
    } catch {
      console.warn('[driver] 上游无 HEAD（空仓？），跳过硬重置');
    }
    console.log(`[driver] 进程态已同步（resume）→ ${procDir}`);
    return;
  }
  await mkdir(dirname(procDir), { recursive: true });
  await sh('git', ['clone', cloneUrl, procDir]);
  console.log(`[driver] 进程态已克隆（restore）→ ${procDir}`);
}

/** 程序闭包落地根：~/.claude（→ ~/.claude/skills/<名>，与烘进镜像的 ~/.claude/settings.json GLM 路由同处，
 *  引擎以 cwd=家目录 + settingSources:['user'] 即可发现）。 */
function skillsRootOf(): string {
  return join(homedir(), '.claude');
}

/** prepareRuntime 的产物：进程目录（续签更新 git remote 用）+ 引擎句柄（喂输入/停引擎）。 */
export interface Runtime {
  procDir: string;
  engine: EngineHandle;
}

/**
 * 据 Seed 铺设运行环境并起引擎。
 *  · 有 repoCredential → 用带凭证 URL 克隆进程态到 ~/.aprog/<pid>；仅 repoUrl（公有/mock）也尝试克隆；都无则只建目录。
 *  · 有 registry → 匿名拉程序闭包（公有包）到 ~/.claude/skills/；无则跳过（如 smoke 桩）。
 *  · 起引擎：Claude Agent SDK，cwd=家目录，全自动（bypassPermissions），模型凭证用 Seed 的口子或共享 env。
 *    引擎产出经转换层归一成 harness Event，交 emit 上行（由调用方包成 EngineEvent 帧发往 CP）。
 * 任一真实步骤失败即抛——调用方据此【不回 Ready】（进程留 waking，故障可见，不假装就绪）。
 */
export async function prepareRuntime(seed: Seed['p'], emit: (event: HarnessEvent) => void): Promise<Runtime> {
  const { pid, program, registry, repoUrl, repoCredential, engineCredential } = seed;
  const procDir = procDirOf(pid);

  // 1) 进程态：clone / sync → ~/.aprog/<pid>。
  const cloneUrl = repoCredential?.url ?? repoUrl ?? undefined;
  if (cloneUrl) {
    await cloneRepo(cloneUrl, procDir);
  } else {
    await mkdir(procDir, { recursive: true });
    console.log(`[driver] 无进程仓库地址，建空进程目录 ${procDir}`);
  }

  // 2) 程序闭包：匿名 pull → ~/.claude/skills/（公有包，无需凭证）。
  if (registry) {
    await pullProgram({ registry, program, installRoot: skillsRootOf() });
  } else {
    console.log(`[driver] 无 registry，跳过程序闭包拉取 ${program.id}@${program.version ?? '-'}`);
  }

  // 3) 起引擎（cwd=家目录，全自动）。模型凭证：Seed 口子优先，否则共享 env。引擎产出经转换层 emit 上行。
  const engine = startEngine({ engineCredential, emit });

  return { procDir, engine };
}
