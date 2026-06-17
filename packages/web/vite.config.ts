import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  // HTTPS so secure-context Web APIs (navigator.getBattery, connection) work
  // over the LAN. Access via https://<vm-ip>:5174 and accept the self-signed
  // cert once. To go back to plain http, remove basicSsl() from plugins.
  plugins: [solid(), basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // 把控制平面北向 API 同源代理过来：前端调 /cp-api/*（https，同源）→ 控制平面 :8099（http）。
    // 一并解决跨域 + https→http 混合内容拦截。控制平面端口可用 APROG_PORT 改，这里同步。
    proxy: {
      '/cp-api': {
        target: 'http://localhost:8099',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cp-api/, ''),
      },
    },
  },
});
