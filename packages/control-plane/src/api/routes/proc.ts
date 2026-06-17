// 路由 · 进程。生命周期（ps/spawn/wake/hibernate）+ 对话区反向指令（input/interrupt）+ 目录读（fs）。
// 处理器只做 鉴权→授权→校验→调子系统→序列化；真正干活的是 deps.procs / deps.channelFor(pid)。
// 事件流 GET /proc/:pid/stream 在 sse.ts（流式响应自成一路）。

import type { Router } from '../router.ts';
import type { AuthCtx } from '../context.ts';
import { withErrors } from '../errors.ts';
import { withAuth, authorize } from '../middleware/auth.ts';
import { parsePid } from '../respond.ts';

/** GET /proc — 列出当前用户的进程（ps）。 */
async function list(ctx: AuthCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: GET /proc → deps.procs.list');
}

/** GET /proc/:pid — 单进程详情（需成员）。 */
async function get(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'viewer', ctx.deps);
  throw new Error('not implemented: GET /proc/:pid → deps.procs.get');
}

/** POST /proc — spawn：建记录 + 进程目录，不起沙箱（见 docs/api.html#lifecycle）。 */
async function spawn(ctx: AuthCtx): Promise<Response> {
  void ctx;
  throw new Error('not implemented: POST /proc → deps.procs.spawn');
}

/** POST /proc/:pid/wake — 起沙箱 + 灌 bundle + 运行/resume（owner，见 Q11）。 */
async function wake(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  throw new Error('not implemented: POST /proc/:pid/wake → deps.procs.wake');
}

/** POST /proc/:pid/hibernate — 末次检查点后释放沙箱（owner，见 Q11）。 */
async function hibernate(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'owner', ctx.deps);
  throw new Error('not implemented: POST /proc/:pid/hibernate → deps.procs.hibernate');
}

/** POST /proc/:pid/input — 投递用户输入（editor）→ DriverChannel.sendInput。 */
async function input(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'editor', ctx.deps);
  throw new Error('not implemented: POST /proc/:pid/input → channelFor(pid).sendInput');
}

/** POST /proc/:pid/interrupt — 打断当前回合（editor）→ DriverChannel.control('interrupt')。 */
async function interrupt(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'editor', ctx.deps);
  throw new Error("not implemented: POST /proc/:pid/interrupt → channelFor(pid).control('interrupt')");
}

/** GET /proc/:pid/fs?op=list|read — 只读进程目录（viewer）：running 穿透 driver，休眠读检查点。 */
async function fs(ctx: AuthCtx): Promise<Response> {
  const pid = parsePid(ctx);
  await authorize(ctx.user, pid, 'viewer', ctx.deps);
  throw new Error('not implemented: GET /proc/:pid/fs → channelFor(pid).fs | 检查点');
}

export function mount(r: Router): void {
  r.add('GET', '/proc', withErrors(withAuth(list)));
  r.add('POST', '/proc', withErrors(withAuth(spawn)));
  r.add('GET', '/proc/:pid', withErrors(withAuth(get)));
  r.add('POST', '/proc/:pid/wake', withErrors(withAuth(wake)));
  r.add('POST', '/proc/:pid/hibernate', withErrors(withAuth(hibernate)));
  r.add('POST', '/proc/:pid/input', withErrors(withAuth(input)));
  r.add('POST', '/proc/:pid/interrupt', withErrors(withAuth(interrupt)));
  r.add('GET', '/proc/:pid/fs', withErrors(withAuth(fs)));
}
