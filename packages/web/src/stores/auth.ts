// 登录态。身份(id/用户名/邮箱)是后端真值；显示名/头像是本地装饰(沿用旧 Profile 字段，
// 不动 Avatar/UserFlyout/settings)。登录/注册/设密码/验证码全走控制平面（lib/api）。

import { createSignal } from 'solid-js';
import { api, getToken, setToken } from '../lib/api';

interface Identity {
  id: string;
  name: string;
  email: string;
}

/** UI 用的用户视图：后端身份 + 本地装饰。沿用旧字段名以兼容现有组件。 */
export interface Profile {
  id: string;
  username: string; // = identity.name
  email: string;
  displayName: string; // 本地可改，默认 = username
  avatar: string | null;
}

const LS_IDENTITY = 'aprog.identity';
const cosmeticKey = (id: string): string => `aprog.cosmetic.${id}`;

function loadIdentity(): Identity | null {
  const raw = localStorage.getItem(LS_IDENTITY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}
function loadCosmetic(id: string): { displayName?: string; avatar?: string | null } {
  const raw = localStorage.getItem(cosmeticKey(id));
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as { displayName?: string; avatar?: string | null };
  } catch {
    return {};
  }
}
function toProfile(idn: Identity): Profile {
  const c = loadCosmetic(idn.id);
  return {
    id: idn.id,
    username: idn.name,
    email: idn.email,
    displayName: c.displayName ?? idn.name,
    avatar: c.avatar ?? null,
  };
}

const initialIdn = getToken() !== null ? loadIdentity() : null;
const [user, setUser] = createSignal<Profile | null>(initialIdn ? toProfile(initialIdn) : null);

function establish(idn: Identity, token: string): void {
  setToken(token);
  localStorage.setItem(LS_IDENTITY, JSON.stringify(idn));
  setUser(toProfile(idn));
}

interface LoginResp {
  token: string;
  expiresAt: string;
  user: Identity;
}

export const auth = {
  user,
  // 先读信号 user()，确保响应式作用域订阅它；getToken() 是普通变量（非信号），
  // 若放在 && 左侧会在未登录时短路、导致登录后 Show 不重渲染（停在登录页）。
  isAuthed: (): boolean => user() !== null && getToken() !== null,

  /** 登录屏「记住的账号」（仅装饰）。 */
  savedProfile: (): Profile => {
    const idn = loadIdentity();
    return idn ? toProfile(idn) : { id: '', username: '', email: '', displayName: '', avatar: null };
  },

  /** 用户名或邮箱 + 密码。含 '@' 视为邮箱。 */
  async loginWithPassword(idOrEmail: string, password: string): Promise<void> {
    const body = idOrEmail.includes('@') ? { email: idOrEmail, password } : { username: idOrEmail, password };
    const r = await api.post<LoginResp>('/auth/login', body);
    establish(r.user, r.token);
  },

  /** 邮箱 + 验证码。 */
  async loginWithCode(email: string, code: string): Promise<void> {
    const r = await api.post<LoginResp>('/auth/login', { email, code });
    establish(r.user, r.token);
  },

  /** 请求邮箱登录验证码。 */
  async requestLoginCode(email: string): Promise<void> {
    await api.post('/auth/login-code', { email });
  },

  /** 注册：用户名 + 邮箱（随后邮箱验证）。 */
  async register(username: string, email: string): Promise<void> {
    await api.post('/auth/register', { username, email });
  },

  /** 邮箱验证 token + 设密码激活。 */
  async setPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/set-password', { token, password });
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch {
      /* 即便后端失败也清本地 */
    }
    setToken(null);
    localStorage.removeItem(LS_IDENTITY);
    setUser(null);
  },

  /** 本地装饰：改显示名 / 头像（不入后端）。 */
  updateProfile(patch: Partial<Pick<Profile, 'displayName' | 'avatar'>>): void {
    const cur = user();
    if (cur === null) return;
    const next = { ...cur, ...patch };
    localStorage.setItem(cosmeticKey(cur.id), JSON.stringify({ displayName: next.displayName, avatar: next.avatar }));
    setUser(next);
  },

  /** 改密：后端尚无改密端点，暂走邮箱重置（待接入）。 */
  changePassword(_oldPwd: string, _newPwd: string): { ok: boolean; error?: string } {
    return { ok: false, error: '改密请通过邮箱验证重置（待接入）' };
  },
};
