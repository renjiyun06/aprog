// aprog-driver 可执行入口。
//
// 这是沙箱里 driver 的启动点。**自启后第一件事 = 拨向 control-plane 建立可信连接**
// （create-time 绑定，见 docs/interaction.html#trust）：持 create 时注入的 APROG_BIND_TOKEN，
// 经注入的 APROG_CONTROL_PLANE_URL 回连。控制平面据 bindToken 把这条连接钉到对应沙箱。
//
// 现为「最小握手」：POST /v1/driver/hello → 拿 Welcome。完整双工通道（事件流上行、输入/控制
// 下行、fs 实时读、bundle/checkpoint，见 channel.ts）后续落地。
//
// 注意：agent 循环本体不在本二进制里——它是 SDK spawn 的另一个原生引擎二进制（见 harness.html#topology）。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAdapter } from './engines/claude.ts';

/** hello 应答（见 channel.ts Welcome / docs/interaction.html#s-wake）。 */
interface Welcome {
  pid: string;
  mode: 'resume' | 'restore';
  resendFromLocalSeq?: number;
}

async function dialControlPlane(): Promise<void> {
  const baseUrl = process.env.APROG_CONTROL_PLANE_URL;
  const bindToken = process.env.APROG_BIND_TOKEN;
  if (!baseUrl || !bindToken) {
    console.error('[driver] 缺少 APROG_CONTROL_PLANE_URL / APROG_BIND_TOKEN —— 无法回连控制平面');
    process.exit(1);
  }
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/driver/hello`;
  console.log(`[driver] 启动 —— 第一件事：拨向控制平面 ${endpoint}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bindToken }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error(`[driver] 握手被拒 HTTP ${res.status}: ${detail}`);
    process.exit(1);
  }
  const welcome = (await res.json()) as Welcome;
  console.log(`[driver] 握手成功 ✓ welcome=${JSON.stringify(welcome)}`);

  // 引用引擎胶水，确保被打进 bundle（不被 tree-shake）；真正的 run 循环（attach/wake 后跑 agent）后续接上。
  console.log(`[driver] 引擎就绪：query=${typeof query}, adapter=${ClaudeAdapter.name}（agent 循环待实现）`);
}

dialControlPlane().catch((err) => {
  console.error('[driver] fatal', err);
  process.exit(1);
});
