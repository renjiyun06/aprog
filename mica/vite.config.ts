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
  },
});
