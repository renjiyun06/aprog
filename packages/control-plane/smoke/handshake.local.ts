// 本地 WS 握手 smoke（无沙箱、无 frp/nginx）：CP 的 DriverChannelServer + 真 driver 二进制做 client。
// 验「Hello → Welcome」协议链路本身正确，把它和基础设施问题隔离。零密钥、零计费，可随时复跑。
//   跑：bun smoke/handshake.local.ts          （或自带 driver bundle：APROG_DRIVER_BUNDLE=... 覆盖）
import { DriverRegistry } from '../src/driver-channel/registry.ts';
import { DriverChannelServer } from '../src/driver-channel/channel.ts';

const PORT = Number(process.env.APROG_PORT ?? 8097);
const TOKEN = 'local-test-token-abcdef';
// 默认按文件位置解析 driver bundle（smoke/ → ../../driver/dist），不依赖 CWD。
const BUNDLE = process.env.APROG_DRIVER_BUNDLE ?? `${import.meta.dir}/../../driver/dist/driver.mjs`;

const registry = new DriverRegistry();
registry.register(TOKEN, { pid: 1, sandboxId: 'local-sbx' }); // 预登记（模拟 register-before-launch）
const dc = new DriverChannelServer(registry);

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (dc.matches(req.method, url.pathname)) {
      if (srv.upgrade(req, { data: dc.newSessionData() })) return undefined;
      return new Response('upgrade failed', { status: 400 });
    }
    return new Response('not found', { status: 404 });
  },
  websocket: dc.websocket,
});
console.log(`[local] CP WS server :${PORT}，预登记 token，起 driver…`);

const proc = Bun.spawn(['node', BUNDLE], {
  env: { ...process.env, APROG_CONTROL_PLANE_URL: `http://127.0.0.1:${PORT}`, APROG_BIND_TOKEN: TOKEN },
  stdout: 'inherit',
  stderr: 'inherit',
});

// 成功判据：driver 握手后 CP 的活连接表出现 pid=1。
const deadline = Date.now() + 15_000;
let ok = false;
while (Date.now() < deadline) {
  if (dc.connectionFor(1) !== undefined) {
    ok = true;
    break;
  }
  await Bun.sleep(200);
}

console.log(ok ? '\n[local] ✓ 握手成功：CP 活连接表已绑定 pid=1' : '\n[local] ✗ 超时未握手');
proc.kill();
server.stop(true);
process.exit(ok ? 0 : 1);
