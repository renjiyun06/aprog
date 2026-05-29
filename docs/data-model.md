# aprog Platform Data Model

aprog 平台需要一个 **控制面 (control-plane)** 来管理 process 元数据. 这份文档描述实体、字段、关系, 以及 source of truth 归属.

组件 / 通信 / 部署形态见 [architecture.md](./architecture.md). 本文只关心数据.

**术语**: "沙箱" 指 Daytona 提供的环境容器, 里面跑 **engine driver** + **engine** (当前 Claude Agent SDK TS) + program 工作目录. engine 是可替换的"执行引擎", 类似 CPU; sandbox 是其运行环境. 详见 architecture.md.

## 核心原则

- **平台快照 + 沙箱工作副本**: 进程的状态文件 (`meta.yml / input.md / execution-state/`) 在平台上以 **快照** 形态存在; 在沙箱里以 **工作副本** 形态存在. 同一时刻只有一份是 authoritative —— 沙箱在跑时是工作副本; 沙箱不在时是平台快照.
- **状态穿越沙箱生死**: spawn 时初始化快照; 首次 attach 把快照注入沙箱; `/exit` 把沙箱里的工作副本打包回平台覆盖快照. 沙箱反复销毁重建, 快照永存.
- **engine session 也在快照里**: engine (当前 Claude Agent SDK) 自己的会话以 `session.jsonl` 形态躺在工作目录, 跟 program state 一起 tar 进出. attach mode 2 (exit 后重启) 因此可以让对话上下文延续, 不是冷启动. 换 engine 时 session 不可移植, 那次冷启动一下, 可接受.
- **状态永不删除**: 进程一旦 spawn, 它的快照就在那里. 没有 delete / kill 概念.

## 实体

### User

aprog 的人类用户. 现阶段假设由管理员 out-of-band 创建 (无 self-signup, 无 `aprog user create` 命令).

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 唯一标识 |
| username | string | 唯一, 登录时输入 |
| password_hash | string | argon2 / bcrypt, 不出库 |
| created_at | timestamp | |
| last_login_at | timestamp? | |

**Authoritative**: control-plane DB.

### AuthSession

`aprog login` 创建; `aprog logout` 失效. 一个 User 可以同时持有多个 (多设备一设备一个).

| 字段 | 类型 | 说明 |
|---|---|---|
| id (= token) | string | 客户端持有的不透明字符串, 每次请求带上 |
| user_id | string | User.id 引用 |
| created_at | timestamp | login 时刻 |
| last_used_at | timestamp | 每次命令验证时更新 |
| expires_at | timestamp | 到期时刻, 之后拒绝 (即使未 revoke). 默认 TTL **30 天** |
| revoked_at | timestamp? | logout 时填; 之后此 token 拒绝 |

token 验证: `revoked_at IS NULL AND expires_at > now()`. 任一失败 → 401, 客户端应清掉本地 credentials 并提示 `aprog login` 重新登录.

**Authoritative**:
- 服务端记录 → control-plane DB
- 客户端 token 缓存 → `~/.aprog/credentials` (mode 0600)

### Program

可被 spawn 的程序 (= 一个 skill). 静态实体, 不在 control-plane 持久化, 由文件系统扫描得到. **全平台共享, 不按 user 隔离** —— 任何登录用户看到同一份 program catalog.

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 唯一标识, 如 `grasp` |
| version | semver | 程序版本 |
| kind | enum {application, library} | application 可直接 spawn; library 只被依赖 |
| description | string | 一行说明 |
| entry | path | 程序在文件系统中的位置 (`~/.aprog/programs/<name>/SKILL.md`) |

**Authoritative**: 文件系统 (`~/.aprog/programs/`).

### Process

一次 program 执行的实例. 主 noun.

| 字段 | 类型 | 说明 |
|---|---|---|
| pid | string | `yyMMdd-<4-char nanoid>`, 如 `260521-x9k4` |
| program | string | Program.name 引用 |
| user_id | string | User.id 引用 (= owner) |
| state | enum | `spawned / running / exited` (见状态机) |
| phase | string? | program 内部的语义阶段 (如 grasp 的 `concepts / mechanisms / flows`), 由 program 自己写, 平台只读 |
| snapshot_path | path | 控制面上的快照目录, 如 `/var/lib/aprog/proc/<pid>/` |
| sandbox_id | string? | 当前 Daytona sandbox ID, 没沙箱时 null. 是控制面访问沙箱的桥. |
| sandbox_started_at | timestamp? | 当前沙箱起来的时刻 (= 上次 attach mode 1/2 时刻) |
| created_at | timestamp | spawn 时刻 |
| last_attached_at | timestamp? | 最近一次 attach |
| last_exited_at | timestamp? | 最近一次 exit |

**Authoritative**: control-plane DB (元数据); `snapshot_path` 指向的目录 (内容, 详见下节).

**关于沙箱**: 没有独立 Sandbox 实体, 沙箱信息全在 Process 这一行 (`sandbox_id` + `sandbox_started_at` 两个字段). 沙箱实际生命由 Daytona authoritative, 控制面只持 `sandbox_id` 做反查. 沙箱镜像现阶段固定 (`aprog/base:0.1`), 代码硬编码, 不入表.

`sandbox_id` 的 null-ness 完全对应"有没有沙箱":

| 状态转换 | sandbox_id 变化 |
|---|---|
| spawn | 创建时 = null |
| attach mode 1/2 | null → 新 ID |
| /detach | 不变 (沙箱还在) |
| /exit | → null (沙箱销毁) |
| attach mode 3 | 不变 |

代价: 丢失沙箱历史 (一个 process 一生可能起过 N 个沙箱, 只留当前那个). MVP 不需要; 真要审计 / 算 compute 账可以后加 `sandbox_history` 表.

## Process Snapshot

进程的状态文件目录, 跟随 Process 终身. 不是独立实体, 是 Process 的 `snapshot_path` 字段指向的目录.

### 目录结构

```
<snapshot_path>/        (e.g. /var/lib/aprog/proc/260521-x9k4/)
├── meta.yml            ← 标准化元数据 + state_schema 声明 (state skill 协议)
├── input.md            ← append-only 用户输入流 (state skill 协议)
├── execution-state/    ← 程序私有数据 (state skill 协议)
│   ├── state.yaml      ← KV 索引, 大值 $file 引用
│   └── blobs/
└── session.jsonl       ← engine 自己的会话日志 (engine 写; aprog 只搬运)
```

前三项 (meta + input + execution-state) 由 [state skill](../state/SKILL.md) 定义, 是 aprog 协议层的内容. `session.jsonl` 是 engine 自己的, aprog 不解释, 只随 tar 进出.

**实时事件流 (driver 缓冲的 events.log) 不属于快照** —— 那是沙箱活着时给 reattach 兜底的环形 buffer, 跟沙箱一起死, 不外传. 详见 [architecture.md](./architecture.md).

### 快照生命周期

| 时机 | 动作 | source of truth |
|---|---|---|
| `aprog spawn` | 控制面在 `snapshot_path` 写入骨架 (`meta.yml` + 空 `input.md` + 空 `execution-state/`) | 平台快照 |
| `aprog attach` mode 1/2 | 控制面起沙箱, 把 `snapshot_path` 内容 tar 进沙箱解开到 `/home/aprog` | **沙箱工作副本** (开始演化) |
| 沙箱跑期间 | harness 读写 `/home/aprog` 下文件. 控制面快照不变, 滞后. | 沙箱工作副本 |
| `/detach` | 沙箱继续跑, 不同步. 平台快照保持 attach 前的状态. | 沙箱工作副本 |
| `aprog attach` mode 3 | 重连, 沙箱内的工作副本不变 | 沙箱工作副本 |
| `/exit` | 控制面从沙箱 tar 出 `/home/aprog` 内容, 覆盖 `snapshot_path`. destroy 沙箱. | 平台快照 (回收) |

外部 (CLI / TUI 浏览器) 读文件的 dispatch:
- 沙箱在 (running) → 通过 Daytona exec 读沙箱里的新鲜版本
- 沙箱不在 (spawned / exited) → 直接读 `snapshot_path` 下的快照

写默认拒绝 —— 只有 spawn / harness 自己 / exit 流程可以 mutate. MVP 不开放外部修改.

## 关系

```
User
 ├──── 1:N ──── AuthSession         (login token, 每设备一个)
 │                  ↑ 客户端持有 token, 每条命令携带验证
 │
 └──── 1:N ──── Process
                   │
                   ├──── 1:1 ──── snapshot_path  (控制面磁盘上的目录, 跟 Process 同生命周期)
                   │
                   └──── sandbox_id ─→ Daytona sandbox (ephemeral, 销毁可重建; null 时无)

Program (catalog, 文件系统)
   ▲
   │ name 引用 (软引用)
   │
Process
```

## Process 状态机

```
              spawn
                │
                ▼
           ┌─────────┐
           │ spawned │   ← 已注册 + 快照骨架已建, 没起过沙箱, 不烧 compute
           └────┬────┘
                │ attach (mode 1: 起沙箱, 注入快照)
                ▼
           ┌─────────┐
           │ running │ ◄──────────────┐
           └────┬────┘                 │
                │                      │
       ┌────────┴────────┐             │
       │                 │             │
   /detach           /exit             │
       │                 │             │
   (state 不变)      tar-out 覆盖     │
   仅断 UI          快照后销毁         │
                       │              │
                       ▼              │ attach (mode 3, 沙箱仍在, 即时重连)
                   ┌────────┐          │
                   │ exited │          │
                   └────┬───┘          │
                        │              │
                        │ attach (mode 2, 起沙箱, 注入快照)
                        └──────────────┘
```

状态枚举:

- **`spawned`** — Process row 已建, 快照骨架已建, 没起过沙箱. 离开方式: `attach`.
- **`running`** — 沙箱在跑. 内部子状态 (ps 不显示):
  - 至少一个 viewer 连着 = "attached"
  - 无 viewer = "detached" (沙箱仍跑, 占 compute)
- **`exited`** — 沙箱已销毁, 快照已回收到 `snapshot_path`. 可走 mode 2 attach 重启.

**没有 `killed` / `deleted` 状态** —— 状态永不删除是核心原则.

## Source of truth 总览

| 数据 | 存储 | 谁是 authoritative |
|---|---|---|
| User (账号 + 密码 hash) | control-plane DB | 管理员 out-of-band 创建 |
| AuthSession 服务端记录 | control-plane DB | login 写, logout 改 revoked_at |
| AuthSession 客户端 token | `~/.aprog/credentials` (mode 0600) | login 写, logout 删 |
| Program 列表 | 文件系统扫描 | `~/.aprog/programs/` (不入 control-plane) |
| Process 元数据 (pid / state / phase / 时间戳) | control-plane DB | spawn / attach / detach / exit 都写它 |
| 进程状态文件 (spawned / exited 时) | 控制面 `snapshot_path` 下 | 平台快照 |
| 进程状态文件 (running 时) | 沙箱内 `/home/aprog/` | 沙箱工作副本 (新鲜) |
| Sandbox 实际生命 | Daytona | 以 Daytona 查询为准. 控制面只在 Process 行存 `sandbox_id` 做反查 |
| Engine session (会话日志) | `snapshot_path/session.jsonl` (沙箱不在时); 沙箱内 `/home/aprog/session.jsonl` (沙箱在时) | engine 写, aprog 只搬运 (tar) |
| Driver events buffer (实时事件流) | 沙箱内 `/var/aprog/events.log` (ring) | 沙箱在时给 reattach 兜底, 沙箱死时丢 |

## 命令到数据的映射

每条命令 (除 `login` 本身) 默认携带客户端 `~/.aprog/credentials` 里的 token; control-plane 验证 token (= AuthSession.id), 失败一律 401.

| CLI | 读 | 写 |
|---|---|---|
| `aprog login` | control-plane (User by username + password 校验) | control-plane (新 AuthSession), 客户端 (`~/.aprog/credentials`) |
| `aprog logout` | 客户端 (token) | control-plane (AuthSession.revoked_at), 客户端 (删 credentials) |
| `aprog programs` | 文件系统 | — |
| `aprog ps` | control-plane (Process 表, 按 user_id 过滤) | — |
| `aprog spawn <prog>` | 文件系统 (验程序存在) | control-plane (新 Process), 控制面磁盘 (初始化 `snapshot_path` 骨架) |
| `aprog attach <pid>` mode 1/2 | control-plane, 控制面磁盘 (读快照, 含 session.jsonl) | control-plane (sandbox_id, state→running), Daytona (起沙箱 + 注入快照 + 起 driver, mode 2 时 driver 用 session.jsonl resume) |
| `aprog attach <pid>` mode 3 | control-plane | — (沙箱已在) |
| `/detach` (TUI) | — | control-plane (last_attached_at), 不动沙箱 |
| `/exit` (TUI) | Daytona (从沙箱 tar 出工作副本) | 控制面磁盘 (覆盖 `snapshot_path`), control-plane (state→exited, sandbox_id→null, last_exited_at), Daytona (销毁沙箱) |
