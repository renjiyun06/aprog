// 路由 · driver 握手（南面，不走用户鉴权）。
//
// driver 自启后第一件事就是拨这里（POST /v1/driver/hello），带上 create 时注入的 bindToken。
// 控制平面据 bindToken 认领、把这条连接绑到对应沙箱（create-time 绑定，见 docs/interaction.html#trust），
// 回一个 Welcome。这是最小握手；完整双工通道（事件流/输入/fs/bundle）后续在 driver-channel/ 落地。

import type { Router } from '../router.ts';
import type { ReqCtx } from '../context.ts';
import { withErrors, validation } from '../errors.ts';
import { json, readJson } from '../respond.ts';

/** POST /driver/hello {bindToken} → Welcome{pid,mode}。未知 bindToken 拒绝。 */
async function hello(ctx: ReqCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const bindToken = typeof b.bindToken === 'string' ? b.bindToken : '';
  if (bindToken === '') throw validation('缺少 bindToken');

  const binding = ctx.deps.drivers.resolve(bindToken);
  if (binding === undefined) {
    // 未知凭证 = 握手被拒。（语义上更接近 401；最小实现先用 validation 的 400，带清晰消息。）
    throw validation('未知 bindToken —— 握手被拒');
  }

  console.log(`[driver-channel] driver 拨入 ✓ pid=${binding.pid} sandbox=${binding.sandboxId}`);
  // mode：冷唤醒/新沙箱新 driver = restore（完整通道会据「同一 driver 是否还活着」分流 resume）。
  return json({ pid: String(binding.pid), mode: 'restore' });
}

export function mount(r: Router): void {
  r.add('POST', '/driver/hello', withErrors(hello));
}
