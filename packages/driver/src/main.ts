// aprog-driver 可执行入口。
//
// 这是沙箱里 driver 的启动点。**自启后第一件事 = 拨向 control-plane 建立可信连接**
// （create-time 绑定，见 docs/interaction.html#trust）：持 create 时注入的 APROG_BIND_TOKEN，
// 经注入的 APROG_CONTROL_PLANE_URL 回连。控制平面据 bindToken 把这条连接钉到对应沙箱。
//
// 传输：一条 driver 主动拨出的 WebSocket（全双工）。握手 = 发 Hello → 收 Welcome（帧契约见
// @aprog/protocol/channel）。握手成功后 CP 紧接下发 Seed（要恢复哪个进程：程序坐标 + 仓库地址）；
// driver 据此部署程序与进程态、起引擎，就绪后回 Ready，CP 才把进程由 waking 翻为 running。
//
// 注意：agent 循环本体不在本二进制里——它是 SDK spawn 的另一个原生引擎二进制（见 harness.html#topology）。
// 收到 Seed 后：真实 git clone 进程态（②）+ 真实 OCI pull 程序闭包（③，见 oci.ts/runtime.ts），就绪回 Ready；
// 仓库短票 ~1h 过期，长进程临过期前发 RenewRepo 续签（①）。起引擎仍占位，随后增量补。

import {
  CHANNEL_PROTOCOL_VERSION,
  type ControlPlaneFrame,
  type EngineEvent,
  type Hello,
  type Input,
  type Ready,
  type RenewRepo,
  type RepoCredential,
  type RepoToken,
  type Seed,
  type Welcome,
} from '@aprog/protocol/channel';
import type { Event as HarnessEvent } from '@aprog/protocol/harness';
import { sh } from './exec.ts';
import { maybeStartProxy } from './proxy.ts';
import { prepareRuntime, type Runtime } from './runtime.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 仓库短票临过期前多久续签（留足时钟漂移 + 一次往返余量）。 */
const RENEW_SKEW_MS = 5 * 60 * 1000;

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
    // 同一个持久监听器既完成握手、又服务握手后的下行帧。一体化避免「握手后另挂监听器」的竞态：
    // CP 紧接 Welcome 之后发 Seed，若等 await 返回再挂监听器，Seed 可能已先到而漏接。
    ws.addEventListener('message', (ev: MessageEvent) => {
      let frame: ControlPlaneFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ControlPlaneFrame;
      } catch {
        if (!settled) fail('控制平面应答非 JSON');
        return;
      }
      if (!settled) {
        if (frame.t === 'welcome') {
          settled = true;
          resolve({ ws, welcome: frame });
        } else {
          fail(`期望 welcome 帧，收到 t=${(frame as { t?: string }).t}`);
        }
        return;
      }
      // 握手已成：服务 CP 下行帧（Seed → 部署 + 起引擎 → 回 Ready；RepoToken → 换续签的仓库短票；Input → 喂引擎）。
      if (frame.t === 'seed') void onSeed(ws, frame);
      else if (frame.t === 'repo-token') void onRepoToken(frame);
      else if (frame.t === 'input') onInput(frame);
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
  console.log(`[driver] 握手成功 ✓ welcome=${JSON.stringify(welcome)}（已就绪服务 Seed）`);
  // Seed 由 dialOnce 的持久监听器在握手后直接服务（见其 message 回调），此处无需另挂监听器。
}

// ── 进程态续签所需的轻状态（单沙箱单进程，故用模块级即可）─────────────────
/** 当前进程 id（续签 RenewRepo 用）。 */
let currentPid: string | undefined;
/** 当前进程目录（续签后更新 git remote 用）。 */
let currentProcDir: string | undefined;
/** 当前引擎句柄（持引用防 GC + 让进程常驻；待输入/输出帧桥接接入）。 */
let currentEngine: Runtime['engine'] | undefined;
/** 仓库短票续签定时器（重连/换票时清旧重排）。 */
let renewTimer: ReturnType<typeof setTimeout> | undefined;

/** 收到 Seed：真实克隆进程态 + 拉程序闭包（起引擎占位），就绪后回 Ready；并据短票排程续签。
 *  铺设失败【不回 Ready】——进程留 waking，故障在 driver.log 可见，不假装就绪。 */
async function onSeed(ws: WebSocket, seed: Seed): Promise<void> {
  const { pid, program, repoUrl, mode, repoCredential } = seed.p;
  console.log(
    `[driver] 收到 Seed pid=${pid} mode=${mode} program=${program.id}@${program.version ?? '-'} repo=${repoUrl ?? '-'} repoCred=${repoCredential ? '有' : '无'}`,
  );
  currentPid = pid;
  currentEngine?.stop(); // 重连/重 Seed:先停旧引擎,避免重复（resume 的无缝续跑待后续优化）
  let rt: Runtime;
  try {
    rt = await prepareRuntime(seed.p, sendEvent);
  } catch (e) {
    console.error(`[driver] 运行环境铺设失败 pid=${pid}（不回 Ready，进程留 waking）：`, e);
    return;
  }
  currentProcDir = rt.procDir;
  currentEngine = rt.engine;
  // 拿到带 expiresAt 的短票即排程续签（长进程跑过 1h 仍能 push 检查点）。
  if (repoCredential) scheduleRenew(repoCredential.expiresAt);
  const ready: Ready = { t: 'ready', p: { pid } };
  ws.send(JSON.stringify(ready));
  console.log(`[driver] 运行环境就绪 → 回 Ready pid=${pid}`);
}

/** 上行一条 harness 事件：包成 EngineEvent 帧发往 CP。通道不可用则丢（CP 重连后由 resume/补帧机制兜，待加）。
 *  始终引用模块级 channelWs（而非某次 Seed 的 ws），保证重连后走当前连接。 */
function sendEvent(event: HarnessEvent): void {
  if (!channelWs || channelWs.readyState !== WebSocket.OPEN) return;
  const frame: EngineEvent = { t: 'event', p: { event } };
  channelWs.send(JSON.stringify(frame));
}

/** 收到 Input（CP 下发的用户输入）：喂引擎 + 回显上行。引擎未起则丢弃（不该发生：CP 应在 Ready 后才发）。 */
function onInput(frame: Input): void {
  if (!currentEngine) {
    console.warn(`[driver] 收到 Input 但引擎未起，丢弃 pid=${frame.p.pid}`);
    return;
  }
  const echo = currentEngine.pushInput(frame.p.text);
  sendEvent(echo);
  console.log(`[driver] 喂输入给引擎 pid=${frame.p.pid} len=${frame.p.text.length}`);
}

/** 据短票过期时刻排程续签：到点（提前 RENEW_SKEW）发 RenewRepo 求新票。重连/换票时清旧重排。 */
function scheduleRenew(expiresAt: string): void {
  if (renewTimer) clearTimeout(renewTimer);
  const ms = new Date(expiresAt).getTime() - Date.now() - RENEW_SKEW_MS;
  const delay = Number.isFinite(ms) ? Math.max(0, ms) : RENEW_SKEW_MS;
  renewTimer = setTimeout(() => {
    if (currentPid === undefined || channelWs === undefined || channelWs.readyState !== WebSocket.OPEN) {
      console.warn('[driver] 续签到点但通道不可用，待重连后随新 Seed 重排');
      return;
    }
    const renew: RenewRepo = { t: 'renew-repo', p: { pid: currentPid } };
    channelWs.send(JSON.stringify(renew));
    console.log(`[driver] 仓库短票将过期 → 发 RenewRepo pid=${currentPid}`);
  }, delay);
  console.log(`[driver] 已排程续签：${Math.round(delay / 1000)}s 后（票于 ${expiresAt} 过期）`);
}

/** 收到 RepoToken（续签结果）：替换 git remote 的内嵌凭证 + 重排下一次续签。 */
async function onRepoToken(frame: RepoToken): Promise<void> {
  const cred: RepoCredential = frame.p.repoCredential;
  console.log(`[driver] 收到续签 RepoToken pid=${frame.p.pid} expiresAt=${cred.expiresAt}`);
  if (currentProcDir !== undefined) {
    try {
      await sh('git', ['-C', currentProcDir, 'remote', 'set-url', 'origin', cred.url]);
      console.log('[driver] 已用新短票更新 git remote');
    } catch (e) {
      console.error('[driver] 更新 git remote 失败：', e);
    }
  }
  scheduleRenew(cred.expiresAt);
}

// 起步顺序:先把出网代理拉起来(若 CP 下发了 SS),再拨控制平面。
//  · CP 回拨在 NO_PROXY 放行 → 直连,不依赖代理;但 Seed 后的 clone(github)/pull(ghcr)依赖代理,
//    故把代理就绪挡在拨号之前,保证首个 Seed 到达时 v2ray 已在监听。
//  · maybeStartProxy 自吞错误(不 reject):代理起不来也继续拨 CP,让故障在 onSeed 的 clone/pull 处显形。
maybeStartProxy()
  .then(dialControlPlane)
  .catch((err) => {
    console.error('[driver] fatal', err);
    process.exit(1);
  });
