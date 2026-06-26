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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 带退避重试的握手。两类失败都重试：
 *  - fetch 抛错（隧道/网关瞬时抖动、CP 还没起）；
 *  - 非 2xx（尤其 4xx「未知 bindToken」——控制平面登记 bindToken 与 driver 自启拨号存在天然竞态：
 *    driver 可能比 provider 完成登记更早拨到，首拨落空是预期的，稍后重试即命中）。
 * 退避：1s、2s、3s…（封顶 3s）；max 次都不成才抛（由顶层 fatal 兜底 exit(1)）。
 */
async function dialWithRetry(endpoint: string, bindToken: string): Promise<Welcome> {
  const maxAttempts = 20;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bindToken }),
      });
      if (res.ok) return (await res.json()) as Welcome;
      lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    if (attempt < maxAttempts) {
      const delay = Math.min(3000, 1000 * attempt);
      console.warn(`[driver] 握手未成（第 ${attempt}/${maxAttempts} 次）：${lastErr} —— ${delay}ms 后重试`);
      await sleep(delay);
    }
  }
  throw new Error(`握手失败：${maxAttempts} 次均未成。最后错误：${lastErr}`);
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

  const welcome = await dialWithRetry(endpoint, bindToken);
  console.log(`[driver] 握手成功 ✓ welcome=${JSON.stringify(welcome)}`);

  // 引用引擎胶水，确保被打进 bundle（不被 tree-shake）；真正的 run 循环（attach/wake 后跑 agent）后续接上。
  console.log(`[driver] 引擎就绪：query=${typeof query}, adapter=${ClaudeAdapter.name}（agent 循环待实现）`);
}

dialControlPlane().catch((err) => {
  console.error('[driver] fatal', err);
  process.exit(1);
});
