// aprog-driver 可执行入口。
//
// 这是沙箱里 driver 的启动点。**自启后第一件事 = 拨向 control-plane 建立可信连接**
// （create-time 绑定，见 docs/interaction.html#trust）：持 create 时注入的 APROG_BIND_TOKEN，
// 经注入的 APROG_CONTROL_PLANE_URL 回连。控制平面据 bindToken 把这条连接钉到对应沙箱。
//
// 传输：一条 driver 主动拨出的 WebSocket（全双工）。握手 = 发 Hello → 收 Welcome（帧契约见
// @aprog/protocol/channel）。握手成功后保持连接，留给后续 run/收 两幕（事件流上行、输入/控制下行）。
//
// 注意：agent 循环本体不在本二进制里——它是 SDK spawn 的另一个原生引擎二进制（见 harness.html#topology）。
// 握手之后的 run/收（引擎拉起、双向帧）待重设计后接入——当前仅保留"起"这一幕。

import { CHANNEL_PROTOCOL_VERSION, type Hello, type Welcome } from '@aprog/protocol/channel';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 由控制平面基址推导 driver 通道的 WS URL：http(s)://host/base → ws(s)://host/base/v1/driver/channel。 */
function toChannelWsUrl(baseUrl: string): string {
  const u = baseUrl
    .replace(/\/+$/, '')
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:');
  return `${u}/v1/driver/channel`;
}

interface DialResult {
  ws: WebSocket;
  welcome: Welcome;
}

/** 拨一次 WS 并完成握手（发 Hello → 等 Welcome）。成功后【不关】连接，连同 Welcome 一并返回。 */
function dialOnce(wsUrl: string, bindToken: string): Promise<DialResult> {
  return new Promise<DialResult>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const fail = (msg: string): void => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(msg));
    };
    ws.addEventListener('open', () => {
      const hello: Hello = { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, bindToken } };
      ws.send(JSON.stringify(hello));
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (settled) return;
      let frame: Welcome;
      try {
        frame = JSON.parse(String(ev.data)) as Welcome;
      } catch {
        fail('控制平面应答非 JSON');
        return;
      }
      if (frame.t === 'welcome') {
        settled = true;
        resolve({ ws, welcome: frame });
      } else {
        fail(`期望 welcome 帧，收到 t=${(frame as { t?: string }).t}`);
      }
    });
    ws.addEventListener('error', () => fail('WS 连接错误'));
    ws.addEventListener('close', (ev: CloseEvent) =>
      fail(`WS 在握手完成前关闭 code=${ev.code}${ev.reason ? ` ${ev.reason}` : ''}`),
    );
  });
}

/**
 * 带退避重试的握手。整条 WS 拨号+握手作为一个原子重试单元，失败即重拨：
 *  - 连接错误（隧道/网关瞬时抖动、CP 还没起）；
 *  - 握手前被关（尤其 1008「未知 bindToken」——登记/拨号竞态虽已 register-before-launch，仍兜网络抖动：
 *    首拨偶尔早于登记到达，稍后重拨即命中）。
 * 退避：1s、2s、3s…（封顶 3s）；max 次都不成才抛（由顶层 fatal 兜底 exit(1)）。
 */
async function dialWithRetry(wsUrl: string, bindToken: string): Promise<DialResult> {
  const maxAttempts = 20;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await dialOnce(wsUrl, bindToken);
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

/** 握手成功后持有的通道连接——保持引用，既防 GC 也让进程不退出（等后续 run/收 接入）。 */
let channelWs: WebSocket | undefined;

async function dialControlPlane(): Promise<void> {
  const baseUrl = process.env.APROG_CONTROL_PLANE_URL;
  const bindToken = process.env.APROG_BIND_TOKEN;
  if (!baseUrl || !bindToken) {
    console.error('[driver] 缺少 APROG_CONTROL_PLANE_URL / APROG_BIND_TOKEN —— 无法回连控制平面');
    process.exit(1);
  }
  const wsUrl = toChannelWsUrl(baseUrl);
  console.log(`[driver] 启动 —— 第一件事：拨向控制平面 ${wsUrl}`);

  const { ws, welcome } = await dialWithRetry(wsUrl, bindToken);
  channelWs = ws;
  console.log(`[driver] 握手成功 ✓ welcome=${JSON.stringify(welcome)}（WS 保持，等后续 run/收 接入）`);
  // 后续：据 welcome.p.mode（resume/restore）铺设进程目录、拉起引擎、在本 WS 上开双向帧——待重设计。
}

dialControlPlane().catch((err) => {
  console.error('[driver] fatal', err);
  process.exit(1);
});
