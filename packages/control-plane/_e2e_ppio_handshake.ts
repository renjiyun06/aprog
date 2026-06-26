// 临时 e2e：在 PPIO 沙箱上跑通「driver↔控制平面握手」初步链路。
// 复用真实组件：DriverRegistry + 真实 /v1/driver/hello 路由 + PPIOProvider + ProviderSandboxGateway。
// 链路：gateway.create → PPIOProvider 起 PPIO 沙箱 + 推 driver + 注入 bindToken/CP地址 →
//       driver 自启拨 http://8.134.166.10/aprog/v1/driver/hello → nginx→frps→frpc→本机:8099 →
//       本路由 resolve(bindToken) 命中 = 握手成功。
//
// 跑：APROG_DRIVER_BUNDLE=.../driver.mjs PPIO_API_KEY=... APROG_CONTROL_PLANE_URL=http://8.134.166.10/aprog \
//     APROG_PPIO_TEMPLATE='' bun _e2e_ppio_handshake.ts
import { DriverRegistry, type DriverBinding } from './src/driver-channel/registry.ts';
import { ProviderSandboxGateway } from './src/process/sandbox-gateway.ts';
import { Router } from './src/api/router.ts';
import * as driver from './src/api/routes/driver.ts';
import { toErrorResponse, notFound } from './src/api/errors.ts';
import { PPIOProvider } from '@aprog/sandbox';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.APROG_PORT ?? 8099);
const cpUrl = process.env.APROG_CONTROL_PLANE_URL ?? 'http://8.134.166.10/aprog';
const template = process.env.APROG_PPIO_TEMPLATE ?? '';
// 走 HTTPS 回拨时：把 CP 边缘 CA 证书注入沙箱，driver 经 NODE_EXTRA_CA_CERTS 信任自签证书。
const caCertPem = process.env.APROG_CP_CA_CERT ? readFileSync(process.env.APROG_CP_CA_CERT, 'utf8') : undefined;

// DriverRegistry 包一层，记录握手命中（resolve 被真实路由调用时翻 flag）。
let helloHit: (DriverBinding & { token: string }) | null = null;
const real = new DriverRegistry();
const drivers = {
  register: (t: string, b: DriverBinding) => {
    console.log(`[e2e] register bindToken=${t.slice(0, 8)}… pid=${b.pid} sandbox=${b.sandboxId}`);
    real.register(t, b);
  },
  resolve: (t: string) => {
    const b = real.resolve(t);
    console.log(`[e2e] resolve bindToken=${t.slice(0, 8)}… → ${b ? 'HIT' : 'MISS'}`);
    if (b) helloHit = { token: t, ...b };
    return b;
  },
  unregister: (t: string) => real.unregister(t),
} as unknown as DriverRegistry;

const router = new Router();
driver.mount(router);
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    console.log(`[e2e] ← 收到请求 ${req.method} ${url.pathname}`);
    const path = url.pathname.replace(/^\/v\d+(?=\/)/, '');
    const hit = router.match(req.method, path);
    if (!hit) return toErrorResponse(notFound(`no ${req.method} ${url.pathname}`));
    return hit.handler({ req, params: hit.params, query: url.searchParams, deps: { drivers } as never });
  },
});
console.log(`[e2e] 握手服务器 listening :${PORT}（经隧道暴露在 ${cpUrl}）`);

const provider = new PPIOProvider({
  apiKey: process.env.PPIO_API_KEY,
  controlPlaneUrl: cpUrl,
  caCertPem,
  driverBundlePath: process.env.APROG_DRIVER_BUNDLE!,
  defaultTemplate: template,
  injectedEnv: process.env.APROG_ENGINE_AUTH_TOKEN ? { ANTHROPIC_AUTH_TOKEN: process.env.APROG_ENGINE_AUTH_TOKEN } : undefined,
  sandboxTimeoutMs: 300_000,
});
const gateway = new ProviderSandboxGateway(
  provider,
  drivers,
  () => ({ provider: 'ppio', id: template }),
  { cpu: 2, memory: 4, disk: 10 },
);

const t0 = Date.now();
let sandboxId = '';
try {
  const created = await gateway.create({ pid: 1, programId: 'e2e-ppio', programVersion: null });
  sandboxId = created.sandboxId;
  console.log(`[e2e] gateway.create ✓ sandbox=${created.sandboxId} provider=${created.provider}（${Date.now() - t0}ms，已登记 bindToken，等 driver 回拨…）`);

  // 等握手（driver 冷启 + 拨回，给 90s）。
  const deadline = Date.now() + 90_000;
  while (helloHit === null && Date.now() < deadline) await Bun.sleep(1000);

  if (helloHit) {
    console.log(`[e2e] ✓✓ 握手成功！driver 拨入 pid=${(helloHit as any).pid} sandbox=${(helloHit as any).sandboxId}（端到端 ${Date.now() - t0}ms）`);
  } else {
    console.error('[e2e] ✗ 90s 内未收到 driver 回拨。抓沙箱内 driver 日志排查…');
  }
} catch (e: any) {
  console.error('[e2e] ✗ create 失败:', e?.message ?? e);
} finally {
  // 不论成败，尽量回收沙箱。
  if (sandboxId) {
    try { await provider.destroy({ id: sandboxId, provider: 'ppio', bindToken: '' }); console.log('[e2e] 沙箱已销毁', sandboxId); }
    catch (e: any) { console.error('[e2e] destroy 失败(手动清):', sandboxId, e?.message ?? e); }
  }
  server.stop(true);
  process.exit(helloHit ? 0 : 1);
}
