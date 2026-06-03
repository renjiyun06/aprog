import { createSignal } from 'solid-js';
import { PROGRAMS } from '../programs/registry';

/* Which programs the user has installed onto their desktop.
   Install/uninstall is pure desktop curation — uninstalling only hides a
   program from desktop + taskbar; its processes & data are retained (in the
   real platform: DB ownership flag flips, process dirs stay), so reinstalling
   brings everything back. Persisted locally here as a mock for that ownership.

   NOTE: this module is part of an import cycle (registry → store → installed →
   registry), so it must NOT touch PROGRAMS at module-eval time — only inside
   functions, which run after registry has finished initializing. Hence the
   static seed list and the lazy installedPrograms() function (not a createMemo,
   which would eagerly read PROGRAMS on module load). */
const KEY = 'aprog.installed';

// default-installed seed (the desktop:true programs) — kept static to avoid
// reading PROGRAMS during this module's initialization.
const DEFAULT_INSTALLED = ['requirement', 'design', 'jinglan', 'ruxiayuan', 'codebase', 'docs', 'testgen'];

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return DEFAULT_INSTALLED;
}

const [ids, setIds] = createSignal<string[]>(load());

function persist(next: string[]) {
  setIds(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

export const installedIds = ids;
/** lazy + reactive: reads ids() so callers in reactive scopes re-run on change. */
export function installedPrograms() {
  return PROGRAMS.filter((p) => ids().includes(p.id));
}
export function isInstalled(id: string): boolean { return ids().includes(id); }

export function installProgram(id: string) {
  if (ids().includes(id)) return;
  persist([...ids(), id]);
}
export function uninstallProgram(id: string) {
  persist(ids().filter((x) => x !== id));
}
