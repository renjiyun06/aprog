import { createSignal } from 'solid-js';

/* ──────────────────────────────────────────────────────────────────────
   Demo auth — NO backend. Persists to localStorage so refresh keeps you
   logged in. Demo account: ren / yunjiren123 (password is changeable and
   then stored locally). This whole module is a stand-in for a real auth
   service; swap login()/changePassword() for API calls when the backend
   lands.
   ──────────────────────────────────────────────────────────────────────── */

const LS_SESSION = 'aprog.session';
const LS_PROFILE = 'aprog.profile';
const LS_PWD = 'aprog.pwd';

const DEMO_USER = 'ren';
const DEFAULT_PWD = 'yunjiren123';

export interface Profile {
  username: string;
  displayName: string;
  avatar: string | null; // dataURL or null (→ render initial)
}

function loadPwd(): string {
  return localStorage.getItem(LS_PWD) ?? DEFAULT_PWD;
}
function loadProfile(): Profile {
  const raw = localStorage.getItem(LS_PROFILE);
  if (raw) {
    try { return JSON.parse(raw) as Profile; } catch { /* fall through */ }
  }
  return { username: DEMO_USER, displayName: 'Ren', avatar: null };
}

const [user, setUser] = createSignal<Profile | null>(
  localStorage.getItem(LS_SESSION) === '1' ? loadProfile() : null,
);

export const auth = {
  user,
  isAuthed: () => user() !== null,

  /** Saved profile even when logged out — login screen shows it (like Win11). */
  savedProfile: loadProfile,

  login(username: string, password: string): { ok: boolean; error?: string } {
    if (username.trim().toLowerCase() !== DEMO_USER) return { ok: false, error: '用户名不存在' };
    if (password !== loadPwd()) return { ok: false, error: '密码错误' };
    localStorage.setItem(LS_SESSION, '1');
    setUser(loadProfile());
    return { ok: true };
  },

  logout() {
    localStorage.removeItem(LS_SESSION);
    setUser(null);
  },

  updateProfile(patch: Partial<Profile>) {
    const cur = user();
    if (!cur) return;
    const next = { ...cur, ...patch };
    localStorage.setItem(LS_PROFILE, JSON.stringify(next));
    setUser(next);
  },

  changePassword(oldPwd: string, newPwd: string): { ok: boolean; error?: string } {
    if (oldPwd !== loadPwd()) return { ok: false, error: '当前密码错误' };
    if (newPwd.length < 6) return { ok: false, error: '新密码至少 6 位' };
    localStorage.setItem(LS_PWD, newPwd);
    return { ok: true };
  },
};
