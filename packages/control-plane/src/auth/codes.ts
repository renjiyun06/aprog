// 邮箱验证 token + 登录验证码（SQLite，表 auth_codes）。
//   verify：注册后发的长随机 token，进设密码页用，TTL 24h，按 token 查。
//   login ：邮箱+验证码登录用的 6 位短码，TTL 10min，按 (user_id, code) 查。
// 用一次即删（consume）。

import type { Database } from 'bun:sqlite';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 10 * 60 * 1000;

export class CodeStore {
  constructor(private readonly db: Database) {}

  /** 发一个邮箱验证 token，返回该 token（放进验证邮件链接）。 */
  createVerify(userId: string): string {
    const token = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '');
    this.insert(userId, 'verify', token, VERIFY_TTL_MS);
    return token;
  }

  /** 校验并消费验证 token，返回 userId；无效/过期返回 undefined。 */
  consumeVerify(token: string): string | undefined {
    const row = this.db
      .query("SELECT id, user_id, expires_at FROM auth_codes WHERE kind = 'verify' AND code = ?")
      .get(token) as { id: string; user_id: string; expires_at: string } | null;
    if (row === null) return undefined;
    this.deleteById(row.id);
    return Date.parse(row.expires_at) < Date.now() ? undefined : row.user_id;
  }

  /** 给某用户发 6 位登录验证码，返回该码（放进邮件）。先清掉其旧的 login 码。 */
  createLogin(userId: string): string {
    this.db.query("DELETE FROM auth_codes WHERE kind = 'login' AND user_id = ?").run(userId);
    const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
    const code = String(n).padStart(6, '0');
    this.insert(userId, 'login', code, LOGIN_TTL_MS);
    return code;
  }

  /** 校验并消费某用户的登录验证码。 */
  consumeLogin(userId: string, code: string): boolean {
    const row = this.db
      .query("SELECT id, expires_at FROM auth_codes WHERE kind = 'login' AND user_id = ? AND code = ?")
      .get(userId, code) as { id: string; expires_at: string } | null;
    if (row === null) return false;
    this.deleteById(row.id);
    return Date.parse(row.expires_at) >= Date.now();
  }

  private insert(userId: string, kind: string, code: string, ttlMs: number): void {
    const now = Date.now();
    this.db
      .query('INSERT INTO auth_codes (id, user_id, kind, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), userId, kind, code, new Date(now + ttlMs).toISOString(), new Date(now).toISOString());
  }
  private deleteById(id: string): void {
    this.db.query('DELETE FROM auth_codes WHERE id = ?').run(id);
  }
}
