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

  // 程序身份（目录薄镜像，跨版本稳定）。权威态是磁盘 skill 注册表；这里只放可查询的元数据。
  // version 不在此表——拆到 program_versions（每版本一行）；current_version 指当前版本。见 docs/data-model.html#program-versions。
  db.run(`CREATE TABLE IF NOT EXISTS programs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    summary         TEXT,
    category        TEXT,
    publisher       TEXT,
    current_version TEXT
  )`);

  // 程序版本（每版本一行，发布后不可变）。核心是承载「这版程序依赖哪版镜像」。
  // image 用 name + version 两列（非合成串）→ 便于「谁还指着某镜像版本」查询（GC）。镜像本身是仓库目录，不入库。
  db.run(`CREATE TABLE IF NOT EXISTS program_versions (
    program_id    TEXT NOT NULL,
    version       TEXT NOT NULL,
    image_name    TEXT NOT NULL,
    image_version TEXT NOT NULL,
    published_at  TEXT,
    PRIMARY KEY (program_id, version)
  )`);

  // 安装记录：用户 × 程序的边。装即在桌面、卸即删行；不存摆放位置（任务栏只显示已打开的进程）。
  db.run(`CREATE TABLE IF NOT EXISTS installations (
    user_id    TEXT NOT NULL,
    program_id TEXT NOT NULL,
    PRIMARY KEY (user_id, program_id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS installations_user ON installations (user_id)');

  // 进程控制块（PCB）。一个 program 的一次运行，类比 OS 进程（pid 自增整数）。模型见 docs/data-model.html#process。
  // state 只由「有没有关联沙箱」驱动：spawned / running / hibernating，无终止态、状态永不删除（无 deleted 列）。
  // name 必填（spawn 校验）。repo_url = 进程 git 仓库实际 clone URL（spawn 建库时写入；见 docs/proc-storage.html#provisioning）。
  // 不存 commit 指针：「最新检查点」= 仓库 HEAD，可推导故不入表（故无 checkpoint_ref 列）。
  // phase/status 是程序内部 FSM 态，住进程目录 meta.yml，不进此表。沙箱动作当前为 mock。
  // 开发期：schema 直接是目标态（CREATE TABLE IF NOT EXISTS），不写迁移代码——破坏性改动时删库重建即可（无生产数据）。
  // 等首次有需保留的数据 / 多环境时，再引入版本化迁移（db/migrations + schema_version 表）。
  db.run(`CREATE TABLE IF NOT EXISTS processes (
    pid             INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    program_id      TEXT NOT NULL,
    program_version TEXT,
    state           TEXT NOT NULL,
    provider        TEXT,
    sandbox_id      TEXT,
    repo_url        TEXT,
    created_at      TEXT NOT NULL,
    last_active_at  TEXT
  )`);
  db.run('CREATE INDEX IF NOT EXISTS processes_user ON processes (user_id)');
}
