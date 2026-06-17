// 安装记录（installations）。用户 × 程序的边——"这个程序装在我桌面上"。
// 模型见 docs/program-model.html：(user_id, program_id) 复合主键；装=插行、卸=删行（硬删）。
// 进程与数据在别处，重装即恢复，故无需软删/历史，也不存摆放位置。

import type { Database } from 'bun:sqlite';

export class InstallStore {
  constructor(private readonly db: Database) {}

  /** 某用户已安装的程序 id 列表。 */
  listFor(userId: string): string[] {
    const rows = this.db
      .query('SELECT program_id FROM installations WHERE user_id = ?')
      .all(userId) as { program_id: string }[];
    return rows.map((r) => r.program_id);
  }

  isInstalled(userId: string, programId: string): boolean {
    return (
      this.db
        .query('SELECT 1 FROM installations WHERE user_id = ? AND program_id = ? LIMIT 1')
        .get(userId, programId) !== null
    );
  }

  /** 安装（幂等：已装则无操作）。 */
  install(userId: string, programId: string): void {
    this.db
      .query('INSERT OR IGNORE INTO installations (user_id, program_id) VALUES (?, ?)')
      .run(userId, programId);
  }

  /** 卸载（幂等）。 */
  uninstall(userId: string, programId: string): void {
    this.db.query('DELETE FROM installations WHERE user_id = ? AND program_id = ?').run(userId, programId);
  }
}
