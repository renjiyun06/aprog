// 持久化基座 · SQLite（bun:sqlite，单 VM、嵌入式、零额外服务）。
// 存"平台元数据"：用户、邮箱验证/登录验证码、会话 token，以及后续的进程 PCB / 共享 / 通知。
// 注意：事件流与进程目录是文件（进程目录是权威态），不进这个库——这里只放需要查询/并发写的元数据。

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** 打开（或新建）控制平面库，建表后返回。dataDir 来自 Config。 */
export function openDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'control-plane.sqlite'), { create: true });
  db.run('PRAGMA journal_mode = WAL');
  applyMigrations(db);
  return db;
}

/** 建表（幂等）。测试可对 `new Database(':memory:')` 直接调用。 */
export function applyMigrations(db: Database): void {
  // 用户。注册只填 name+email，password_hash 待邮箱验证后才设；status: pending → active。
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT,
    status        TEXT NOT NULL,
    created_at    TEXT NOT NULL
  )`);
  // 用户名、邮箱大小写不敏感唯一——但只约束「已激活」用户。
  // 未激活(pending)用户不占用标识符：注册了却忘记激活的人，应能用同一用户名/邮箱重新注册（见 users.createPending 的回收逻辑）。
  // DROP+CREATE 而非 IF NOT EXISTS：保证从旧的「全局唯一」定义平滑切到「仅 active」局部唯一。
  db.run('DROP INDEX IF EXISTS users_name_lower');
  db.run('DROP INDEX IF EXISTS users_email_lower');
  db.run("CREATE UNIQUE INDEX users_name_lower ON users (lower(name)) WHERE status = 'active'");
  db.run("CREATE UNIQUE INDEX users_email_lower ON users (lower(email)) WHERE status = 'active'");

  // 邮箱验证 token（kind=verify，长随机）与登录验证码（kind=login，6 位短码）。
  db.run(`CREATE TABLE IF NOT EXISTS auth_codes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS auth_codes_verify ON auth_codes (kind, code)');
  db.run('CREATE INDEX IF NOT EXISTS auth_codes_login ON auth_codes (user_id, kind)');

  // 会话 token。
  db.run(`CREATE TABLE IF NOT EXISTS tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`);

  // 程序目录（薄镜像）。权威态是磁盘 skill 注册表；这里只放可查询的元数据（见 docs/program-model.html）。
  db.run(`CREATE TABLE IF NOT EXISTS programs (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    version   TEXT,
    summary   TEXT,
    category  TEXT,
    publisher TEXT
  )`);

  // 安装记录：用户 × 程序的边。装即在桌面、卸即删行；不存摆放位置（任务栏只显示已打开的进程）。
  db.run(`CREATE TABLE IF NOT EXISTS installations (
    user_id    TEXT NOT NULL,
    program_id TEXT NOT NULL,
    PRIMARY KEY (user_id, program_id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS installations_user ON installations (user_id)');
}
