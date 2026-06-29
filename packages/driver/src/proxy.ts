// driver 侧「出网代理」——沙箱在国内,访问被墙的 github / ghcr 等外网需经代理。
//
// 形态(职责切分):
//  · 代理「策略」由控制平面决定,经 driver 启动 env 下发(见 control-plane buildSandboxGateway):
//      NODE_USE_ENV_PROXY=1 + HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:<port> + NO_PROXY=<CP 回拨主机>,<GLM 端点>…
//    —— Node(全局 fetch / WebSocket，含本 driver 拉 ghcr 的 OCI fetch)、git 子进程、引擎子进程
//    一律据此出网;NO_PROXY 放行的(CP 国内回拨、GLM 国内模型端点)直连。本模块【不碰】这套路由策略。
//  · 代理「机制」由本模块负责:用 CP 下发的 SS 节点(APROG_PROXY_SS_*,密钥)起一个本地 v2ray http 入站代理,
//    监听 127.0.0.1:<port>(= 上面 HTTP_PROXY 里的端口),上游走 shadowsocks 出去。起好即退,生命周期随 driver。
//
// 为何端口从 HTTP_PROXY 解析:provider 注入的 HTTP_PROXY 是「代理在哪」的唯一真相,driver 把 v2ray
// 监听到同一端口即对齐,避免两个包各写一个魔数而漂移。未下发 SS(mock/dev)→ 不起代理,直连出网。
//
// SS 密钥(APROG_PROXY_SS_*)是 APROG_ 前缀 → scrubEngineEnv 自动从引擎子进程剥除(引擎只拿到 HTTP_PROXY
// 这种指向本地的非密变量,看不到上游 SS 密码)。v2ray 配置含密码,落 root 私有文件 0600(沙箱内 root
// 仍可读是不可约的现实,但不经 env 直送用户程序)。

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** v2ray 主程序路径:镜像把绿色版二进制软链到 /usr/local/bin/v2ray;dev 可经 APROG_V2RAY_BIN 覆盖。 */
const V2RAY_BIN = process.env.APROG_V2RAY_BIN ?? 'v2ray';
/** 解析不到 HTTP_PROXY 端口时的回退本地端口(应与 provider 注入的 HTTP_PROXY 端口一致)。 */
const FALLBACK_PORT = 1081;

/** CP 下发的 shadowsocks 上游节点(密钥)。 */
interface SsConfig {
  server: string;
  port: number;
  password: string;
  method: string;
}

/** 从 env 读 SS 节点;未配齐(无 server/password/有效 port)→ undefined(= 不起代理,直连)。 */
function readSs(): SsConfig | undefined {
  const server = process.env.APROG_PROXY_SS_SERVER;
  const password = process.env.APROG_PROXY_SS_PASSWORD;
  const port = Number(process.env.APROG_PROXY_SS_PORT);
  if (!server || !password || !Number.isFinite(port) || port <= 0) return undefined;
  return { server, port, password, method: process.env.APROG_PROXY_SS_METHOD ?? 'aes-256-gcm' };
}

/** 本地 http 代理监听端口 = HTTP_PROXY(形如 http://127.0.0.1:1081)里的端口;解析不到回退 FALLBACK_PORT。 */
function localProxyPort(): number {
  const raw = process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (raw) {
    try {
      const p = Number(new URL(raw).port);
      if (Number.isFinite(p) && p > 0) return p;
    } catch {
      // 非法 URL → 用回退端口
    }
  }
  return FALLBACK_PORT;
}

/** 生成 v2ray 配置:单 http 入站(本地)+ shadowsocks 出站(上游)。无 routing 段 → v2ray 不需 geoip/geosite 数据。 */
function v2rayConfig(ss: SsConfig, listenPort: number): string {
  return JSON.stringify({
    log: { loglevel: 'warning' },
    inbounds: [{ tag: 'http-in', listen: '127.0.0.1', port: listenPort, protocol: 'http', settings: {} }],
    outbounds: [
      {
        tag: 'ss-out',
        protocol: 'shadowsocks',
        settings: { servers: [{ address: ss.server, port: ss.port, method: ss.method, password: ss.password }] },
      },
    ],
  });
}

/** 轮询本地端口直到可连(代理就绪)或超时。 */
function waitPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = (): void => {
      const sock = connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

/**
 * 若 CP 下发了 SS 节点则起本地 v2ray http 代理并等其就绪;未下发(mock/dev)→ 直接返回(直连出网)。
 * 【不致命】:起代理失败只记日志返回——后续 clone/pull 会因连不上外网而显错(进程留 waking,故障可见),
 * 而 GLM(NO_PROXY 放行)仍直连可用,不因代理故障连模型都断。
 */
export async function maybeStartProxy(): Promise<void> {
  const ss = readSs();
  if (!ss) {
    console.log('[driver] 未下发出网代理(SS)—— 直连出网');
    return;
  }
  const port = localProxyPort();
  const dir = join(homedir(), '.aprog');
  const cfgPath = join(dir, 'v2ray.json');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(cfgPath, v2rayConfig(ss, port), { encoding: 'utf8', mode: 0o600 });
    const child = spawn(V2RAY_BIN, ['run', '-c', cfgPath], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (e) => console.error('[driver] v2ray 启动失败(出网代理不可用):', e.message));
    child.on('exit', (code) => console.error(`[driver] v2ray 退出 code=${code}(出网代理中断)`));
    const ok = await waitPort(port, 10_000);
    if (ok) console.log(`[driver] 出网代理就绪 v2ray@127.0.0.1:${port} → SS ${ss.server}:${ss.port}（${ss.method}）`);
    else console.error(`[driver] 出网代理未在 10s 内就绪(127.0.0.1:${port} 未监听)—— 外网访问可能失败`);
  } catch (e) {
    console.error('[driver] 起 v2ray 出网代理失败(外网访问可能失败):', e);
  }
}
