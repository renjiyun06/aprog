// 用户存储（SQLite）。注册只填 name+email（status=pending、无密码）；邮箱验证后 setPassword 激活。
// 登录支持 用户名+密码 / 邮箱+密码 / 邮箱+验证码。密码用 Bun.password（argon2）。用户名/邮箱大小写不敏感唯一。

import type { Database } from 'bun:sqlite';
import type { User } from '../api/context.ts';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  status: 'pending' | 'active';
  created_at: string;
}

const view = (r: UserRow): User => ({ id: r.id, name: r.name, email: r.email });

export class UserStore {
  constructor(private readonly db: Database) {}

  private rowById(id: string): UserRow | null {
    return this.db.query('SELECT * FROM users WHERE id = ?').get(id) as UserRow | null;
  }
  private rowByName(name: string): UserRow | null {
    return this.db.query('SELECT * FROM users WHERE lower(name) = lower(?)').get(name) as UserRow | null;
  }
  private rowByEmail(email: string): UserRow | null {
    return this.db.query('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as UserRow | null;
  }

  // 「占用」只看已激活用户：pending 用户不占用用户名/邮箱（忘记激活者可重注册）。
  nameTaken(name: string): boolean {
    return this.db.query("SELECT 1 FROM users WHERE lower(name) = lower(?) AND status = 'active' LIMIT 1").get(name) !== null;
  }
  emailTaken(email: string): boolean {
    return this.db.query("SELECT 1 FROM users WHERE lower(email) = lower(?) AND status = 'active' LIMIT 1").get(email) !== null;
  }

  /** 注册：建 pending 用户（无密码），返回公开视图。
   *  先回收同名/同邮箱的旧 pending（及其验证码/token）——未激活用户不占用标识符，
   *  这样既支持「忘记激活后重注册」，也避免激活时撞上 active 唯一索引。active 唯一性由调用方先查 + 索引兜底。 */
  createPending(name: string, email: string): User {
    this.purgePending(name, email);
    const id = crypto.randomUUID();
    this.db
      .query('INSERT INTO users (id, name, email, password_hash, status, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
      .run(id, name, email, 'pending', new Date().toISOString());
    return { id, name, email };
  }

  /** 删除同名或同邮箱的未激活用户及其残留验证码/token。 */
  private purgePending(name: string, email: string): void {
    const rows = this.db
      .query("SELECT id FROM users WHERE status = 'pending' AND (lower(name) = lower(?) OR lower(email) = lower(?))")
      .all(name, email) as { id: string }[];
    for (const { id } of rows) {
      this.db.query('DELETE FROM auth_codes WHERE user_id = ?').run(id);
      this.db.query('DELETE FROM tokens WHERE user_id = ?').run(id);
      this.db.query('DELETE FROM users WHERE id = ?').run(id);
    }
  }

  /** 邮箱验证后设密码并激活。 */
  async setPassword(userId: string, password: string): Promise<void> {
    const hash = await Bun.password.hash(password);
    this.db.query("UPDATE users SET password_hash = ?, status = 'active' WHERE id = ?").run(hash, userId);
  }

  getById(id: string): User | undefined {
    const r = this.rowById(id);
    return r ? view(r) : undefined;
  }

  /** 取 active 用户（按邮箱），供"邮箱+验证码"登录定位账户。 */
  activeByEmail(email: string): User | undefined {
    const r = this.rowByEmail(email);
    return r !== null && r.status === 'active' ? view(r) : undefined;
  }

  /** 用户名 + 密码校验（仅 active 且已设密码）。 */
  async verifyByName(name: string, password: string): Promise<User | undefined> {
    return this.verifyRow(this.rowByName(name), password);
  }
  /** 邮箱 + 密码校验。 */
  async verifyByEmail(email: string, password: string): Promise<User | undefined> {
    return this.verifyRow(this.rowByEmail(email), password);
  }

  private async verifyRow(r: UserRow | null, password: string): Promise<User | undefined> {
    if (r === null || r.status !== 'active' || r.password_hash === null) return undefined;
    return (await Bun.password.verify(password, r.password_hash)) ? view(r) : undefined;
  }

  count(): number {
    return (this.db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }
}
