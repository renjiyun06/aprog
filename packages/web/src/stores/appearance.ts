import { createSignal } from 'solid-js';

/* 个性化外观：窗口与状态栏的不透明度（用户在设置里调）。
   写入 :root 的 CSS 变量 --win-alpha / --tb-alpha，由 app.css 的背景色消费。
   localStorage 持久化（mock；真实平台进用户偏好）。 */
const KEY = 'aprog.appearance';

interface Appearance { win: number; tb: number; }

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Appearance;
  } catch { /* ignore */ }
  return { win: 1, tb: 0.78 }; // 默认：窗口不透明、状态栏沿用原本的 0.78
}

const init = load();
const [windowOpacity, setWin] = createSignal<number>(init.win);
const [taskbarOpacity, setTb] = createSignal<number>(init.tb);

function apply() {
  const r = document.documentElement.style;
  r.setProperty('--win-alpha', String(windowOpacity()));
  r.setProperty('--tb-alpha', String(taskbarOpacity()));
  try { localStorage.setItem(KEY, JSON.stringify({ win: windowOpacity(), tb: taskbarOpacity() })); } catch { /* ignore */ }
}

apply(); // set initial CSS vars at module load

export { windowOpacity, taskbarOpacity };
export function setWindowOpacity(v: number) { setWin(v); apply(); }
export function setTaskbarOpacity(v: number) { setTb(v); apply(); }
