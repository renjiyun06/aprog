import { createStore, produce } from 'solid-js/store';
import { createMemo } from 'solid-js';

export interface WindowState {
  id: string;
  programId: string;
  title: string;
  pid?: number;
  x: number; y: number;
  w: number; h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /* right directory panel (per-window UI state) */
  treeOpen: boolean;
  treeW: number;
}

interface Store {
  windows: WindowState[];
  nextZ: number;
  focusedId: string | null;
}

const [store, setStore] = createStore<Store>({
  windows: [],
  nextZ: 100,
  focusedId: null,
});

export const windowsStore = store;

const genId = (() => { let i = 0; return () => `w${++i}`; })();

/** Open a new window OR focus an existing one for the given program. */
export function openWindow(programId: string, opts?: Partial<WindowState>) {
  // already-open same-program window? focus it
  const existing = store.windows.find(w => w.programId === programId && !w.minimized);
  if (existing) return focusWindow(existing.id);

  const id = genId();
  setStore(produce((s) => {
    s.nextZ += 1;
    s.windows.push({
      id,
      programId,
      title: opts?.title ?? programId,
      pid: opts?.pid,
      x: opts?.x ?? 80 + (s.windows.length * 24),
      y: opts?.y ?? 40 + (s.windows.length * 24),
      w: opts?.w ?? 830,
      h: opts?.h ?? 620,
      z: s.nextZ,
      minimized: false,
      maximized: false,
      treeOpen: false,
      treeW: 256,
    });
    s.focusedId = id;
  }));
  return id;
}

export function closeWindow(id: string) {
  setStore(produce((s) => {
    s.windows = s.windows.filter(w => w.id !== id);
    if (s.focusedId === id) {
      s.focusedId = s.windows.length ? s.windows[s.windows.length - 1].id : null;
    }
  }));
}

export function focusWindow(id: string) {
  setStore(produce((s) => {
    const w = s.windows.find(w => w.id === id);
    if (!w) return;
    s.nextZ += 1;
    w.z = s.nextZ;
    w.minimized = false;
    s.focusedId = id;
  }));
  return id;
}

export function minimizeWindow(id: string) {
  setStore('windows', w => w.id === id, 'minimized', true);
  if (store.focusedId === id) {
    setStore('focusedId', null);
  }
}

export function toggleMaximize(id: string) {
  setStore('windows', w => w.id === id, 'maximized', m => !m);
}

export function moveWindow(id: string, x: number, y: number) {
  setStore('windows', w => w.id === id, produce((w) => { w.x = x; w.y = y; }));
}

export function resizeWindow(id: string, x: number, y: number, w: number, h: number) {
  setStore('windows', wn => wn.id === id, produce((wn) => {
    wn.x = x; wn.y = y; wn.w = w; wn.h = h;
  }));
}

/** Toggle the right directory panel. Opening/closing WIDENS/NARROWS the
 *  window by the panel width (the conversation keeps its width). */
export function toggleWindowTree(id: string) {
  setStore('windows', wn => wn.id === id, produce((wn) => {
    const dw = wn.treeOpen ? -wn.treeW : wn.treeW;
    wn.treeOpen = !wn.treeOpen;
    if (wn.maximized) return; // can't widen when maximized; panel just overlays the fixed area
    const vw = window.innerWidth;
    const neww = Math.max(480, Math.min(vw - 16, wn.w + dw));
    wn.w = neww;
    if (wn.x + neww > vw - 8) wn.x = Math.max(8, vw - 8 - neww);
  }));
}

/** Resize the directory panel WITHOUT touching the window — the divider moves
 *  with the cursor and the conversation gives/takes the space. */
export function setWindowTreeW(id: string, nw: number) {
  setStore('windows', wn => wn.id === id, 'treeW', Math.max(200, Math.min(560, nw)));
}

/** Reactive: list of programs with at least one open window (taskbar indicator). */
export const openProgramIds = createMemo(() => {
  const ids = new Set<string>();
  for (const w of store.windows) ids.add(w.programId);
  return ids;
});
