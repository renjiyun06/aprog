// 路由 · 进程。生命周期（ps/spawn/wake/hibernate/kill）+ 对话区反向指令（input/interrupt）+ 目录读（fs）。
// 处理器只做 鉴权→授权→校验→调子系统→序列化；真正干活的是 deps.procs / deps.channelFor(pid)。
// 生命周期已落地（PCB + 状态机，沙箱动作经 MockSandboxGateway，见 process/manager.ts）；
// input/interrupt/fs 依赖与运行中沙箱的 DriverChannel，尚未对接，保持占位。
// 事件流 GET /proc/:pid/stream 在 sse.ts（流式响应自成一路）。

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors, validation } from '../errors.ts';
import { withAuth, authorize } from '../middleware/auth.ts';
import { paged, created, json, parsePid, readJson } from '../respond.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** GET /proc — 列出当前用户的进程（ps）。 */
async function list(ctx: AuthCtx): Promise<Response> {
  return paged(ctx.deps.procs.list(ctx.user.id));
}

/** GET /proc/:pid — 单进程详情（需成员）。 */
async function get(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'viewer', ctx.deps); // 存在性 + 归属在此校验
  return json(ctx.deps.procs.get(pid));
}

/** POST /proc {programId, version?, name?} — spawn：建 PCB（state=spawned），不起沙箱。 */
async function spawn(ctx: AuthCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const programId = str(b.programId).trim();
  if (programId === '') throw validation('缺少 programId');
  const prog = ctx.deps.catalog.get(programId);
  if (prog === undefined) throw validation(`未知程序 ${programId}`);
  const programVersion = str(b.version).trim() || prog.currentVersion; // 不传则钉当前目录版本
  if (ctx.deps.catalog.resolveImage(programId, programVersion) === undefined)
    throw validation(`程序 ${programId} 无此版本 ${programVersion}`); // 版本须存在（兼校验镜像依赖可解析）
  const name = str(b.name).trim();
  if (name === '') throw validation('缺少进程名 name'); // name 必填
  const rec = await ctx.deps.procs.spawn({ userId: ctx.user.id, programId, programVersion, name });
  return created(rec);
}

/** POST /proc/:pid/wake — 起沙箱 + 运行/resume（owner）。覆盖 attach 首跑与休眠唤醒。 */
async function wake(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  return json(await ctx.deps.procs.wake(pid));
}

/** POST /proc/:pid/hibernate — 末次检查点后释放沙箱（owner）。 */
async function hibernate(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  return json(await ctx.deps.procs.hibernate(pid));
}

/** POST /proc/:pid/kill — 释放沙箱（owner）。与 hibernate 同效，回到 hibernating（无终止态）。 */
async function kill(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  return json(await ctx.deps.procs.kill(pid));
}

/** POST /proc/:pid/input — 投递用户输入（editor）→ DriverChannel.sendInput。 */
async function input(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'editor', ctx.deps);
  throw new Error('not implemented: POST /proc/:pid/input → channelFor(pid).sendInput（待对接沙箱）');
}

/** POST /proc/:pid/interrupt — 打断当前回合（editor）→ DriverChannel.control('interrupt')。 */
async function interrupt(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'editor', ctx.deps);
  throw new Error("not implemented: POST /proc/:pid/interrupt → channelFor(pid).control('interrupt')（待对接沙箱）");
}

/** GET /proc/:pid/fs?op=list|read — 只读进程目录（viewer）：running 穿透 driver，休眠读检查点。 */
async function fs(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'viewer', ctx.deps);
  throw new Error('not implemented: GET /proc/:pid/fs → channelFor(pid).fs | 检查点（待对接沙箱）');
}

export function mount(r: Router): void {
  r.add('GET', '/proc', withErrors(withAuth(list)));
  r.add('POST', '/proc', withErrors(withAuth(spawn)));
  r.add('GET', '/proc/:pid', withErrors(withAuth(get)));
  r.add('POST', '/proc/:pid/wake', withErrors(withAuth(wake)));
  r.add('POST', '/proc/:pid/hibernate', withErrors(withAuth(hibernate)));
  r.add('POST', '/proc/:pid/kill', withErrors(withAuth(kill)));
  r.add('POST', '/proc/:pid/input', withErrors(withAuth(input)));
  r.add('POST', '/proc/:pid/interrupt', withErrors(withAuth(interrupt)));
  r.add('GET', '/proc/:pid/fs', withErrors(withAuth(fs)));
}
