// 会话 token 存储（SQLite）。opaque token：登录签发、存库；authenticate 查库校验 + 看过期。
// 登出 = 删 token。无状态 JWT 的反面——换来"能即时吊销"，对内部工具更省心。

import type { Database } from 'bun:sqlite';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export class TokenStore {
  constructor(private readonly db: Database) {}

  /** 给 userId 签发一个 token，返回 token 与过期时刻（ISO）。 */
  issue(userId: string): { token: string; expiresAt: string } {
    const token = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '');
    const now = Date.now();
    const expiresAt = new Date(now + TTL_MS).toISOString();
    this.db
      .query('INSERT INTO tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, new Date(now).toISOString(), expiresAt);
    return { token, expiresAt };
  }

  /** 解析 token → userId；无效或已过期返回 undefined（过期则顺手清掉）。 */
  resolve(token: string): string | undefined {
    const row = this.db
      .query('SELECT user_id, expires_at FROM tokens WHERE token = ?')
      .get(token) as { user_id: string; expires_at: string } | null;
    if (row === null) return undefined;
    if (Date.parse(row.expires_at) < Date.now()) {
      this.revoke(token);
      return undefined;
    }
    return row.user_id;
  }

  revoke(token: string): void {
    this.db.query('DELETE FROM tokens WHERE token = ?').run(token);
  }
}
