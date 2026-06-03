import { createSignal, createMemo } from 'solid-js';

// Clock — ticks every second, used by taskbar
const [now, setNow] = createSignal(new Date());
setInterval(() => setNow(new Date()), 1000);

export const useClock = () => {
  const time = createMemo(() => {
    const d = now();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const date = createMemo(() => {
    const d = now();
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  });
  return { time, date };
};

// System status — sandbox pool, online devices, user
// (Stubbed for now; will be wired to backend WebSocket later.)
export const system = {
  sandboxInUse: 7,
  sandboxCap: 16,
  devicesOnline: 2,
  user: 'lamarck@aion',
};
