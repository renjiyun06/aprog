import { createSignal } from 'solid-js';

/* ──────────────────────────────────────────────────────────────────────
   Host machine info read through browser Web APIs.

   IMPORTANT: the browser runs on the user's Windows host (the VM only serves
   the page), so these values reflect the *Windows machine*, not the VM.

   Secure-context caveat: navigator.getBattery() and navigator.connection
   require a secure context (https:// or localhost). Over plain http://<lan-ip>
   they are undefined — the dev server runs HTTPS (see vite.config.ts) so they
   resolve. When unavailable we fall back to null and the UI hides/degrades.
   ──────────────────────────────────────────────────────────────────────── */

interface BatteryManagerLike {
  level: number;          // 0..1
  charging: boolean;
  addEventListener(type: string, cb: () => void): void;
}

// ─── Battery ───────────────────────────────────────────────────────
const [batteryLevel, setBatteryLevel] = createSignal<number | null>(null); // 0..100
const [batteryCharging, setBatteryCharging] = createSignal(false);
const [batterySupported, setBatterySupported] = createSignal(false);

const navAny = navigator as unknown as {
  getBattery?: () => Promise<BatteryManagerLike>;
  connection?: { effectiveType?: string; addEventListener?: (t: string, cb: () => void) => void };
  hardwareConcurrency?: number;
  deviceMemory?: number;
};

if (typeof navAny.getBattery === 'function') {
  navAny.getBattery().then((b) => {
    setBatterySupported(true);
    const sync = () => {
      setBatteryLevel(Math.round(b.level * 100));
      setBatteryCharging(b.charging);
    };
    sync();
    b.addEventListener('levelchange', sync);
    b.addEventListener('chargingchange', sync);
  }).catch(() => { /* unsupported / blocked — stays null */ });
}

// ─── Network ───────────────────────────────────────────────────────
const [online, setOnline] = createSignal(navigator.onLine);
const [connType, setConnType] = createSignal<string | null>(null);

window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

const conn = navAny.connection;
if (conn) {
  const sync = () => setConnType(conn.effectiveType ?? null);
  sync();
  conn.addEventListener?.('change', sync);
}

// ─── Static capabilities ───────────────────────────────────────────
const cores = navAny.hardwareConcurrency ?? null;
const memoryGB = navAny.deviceMemory ?? null;

export const host = {
  batteryLevel,
  batteryCharging,
  batterySupported,
  online,
  connType,
  cores,
  memoryGB,
};
