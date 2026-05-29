# aprog Platform Architecture

aprog 的运行时由若干组件协作完成一次 process 的 spawn / attach / detach / exit 生命周期. 本文从概念分层、组件清单、部署拓扑、通信、关键决策、代码分层六个角度描述这套架构.

数据实体见 [data-model.md](./data-model.md). CLI 表面见 [cli.md](./cli.md).

## 概念分层

```
┌────────────────────────────────────────────────────┐
│  Program                                            │
│    一段 aprog 程序 (skill 形态, SKILL.md)            │
│    不关心下面是谁在执行                                 │
├────────────────────────────────────────────────────┤
│  Engine                                             │
│    底层执行引擎. 类比"CPU".                            │
│    当前: Claude Agent SDK (TypeScript)              │
│    未来可替换: Codex SDK / 其他 LLM agent loop        │
├────────────────────────────────────────────────────┤
│  Sandbox                                            │
│    环境. 装工具 + 给 Engine 跑的容器.                  │
│    当前: Daytona                                     │
└────────────────────────────────────────────────────┘
```

三个抽象互相不知道对方的具体实现. Program 用一套统一的 skill 接口表达自己; Engine 提供 agent loop + 工具调用; Sandbox 提供文件系统 + 进程 + 网络. 它们之间通过 **Engine Driver** 这一层薄适配粘合 (见下).

## 组件清单

aprog 一次活着的 process 涉及如下进程/服务:

| 组件 | 跑在哪 | 生命周期 | 职责 |
|---|---|---|---|
| **CLI** | 用户本机 | 命令期 / TUI 会话期 | 用户入口. 跑 `aprog` 各命令, attach 时维护 TUI |
| **Control Plane** | aprog 自家 VM | 长跑 service | 鉴权 / Process 元数据 / 快照磁盘 / 沙箱编排 / 流转代理 |
| **Bridge** | 沙箱内 (Daytona exec 起的) | 一次 attach 期间 | 把 Driver 的本地 socket pipe 到 Daytona exec 的 stdio. 短命, 无状态 |
| **Engine Driver** | 沙箱内 | 沙箱生命周期 | 把 Engine 跟 aprog 协议接上. 当前是 `claude-driver` (TS) |
| **Engine** | 沙箱内 (Driver 进程里) | 同 Driver | Claude Agent SDK 的 `query()` 跑 agent loop |
| **Daytona** | 外部 cloud | 平台外服务 | 提供沙箱 lifecycle + exec API |

aprog 自己出的代码: CLI, Control Plane, Bridge, Engine Driver(s). Engine 和 Sandbox 都是外部依赖.

## 部署拓扑

```
用户本机                    aprog VM                      外部
────────                    ─────────                     ────
CLI ─────────HTTP/WS─────► Control Plane ──Daytona SDK──► Daytona Cloud
                                │                              │
                                │ (snapshot disk IO)            │
                                ▼                              ▼
                          /var/lib/aprog/proc/<pid>/     沙箱 (per Process)
                          (快照目录)                       ├── claude-driver (TS)
                                                          │    ├── @anthropic-ai/claude-agent-sdk
                                                          │    └── socket: /run/aprog/io.sock
                                                          ├── bridge (短命, exec 起)
                                                          └── /home/aprog/
                                                               ├── meta.yml / input.md
                                                               ├── execution-state/
                                                               ├── session.jsonl  ← engine 的 session
                                                               └── .claude/skills/<program>/
```

- CLI 跨 NAT, 只跟 Control Plane 的一个稳定 endpoint 通信
- Control Plane 是所有跨沙箱操作的协调点, 是 source of truth for 元数据 + 快照
- 沙箱本身不对外暴露端口; 任何"进沙箱"的动作都经 Daytona exec 发起

## 通信架构

### 链路 1: CLI ↔ Control Plane

- **协议**: HTTP/JSON 一般命令; WebSocket attach 会话流
- **鉴权**: `~/.aprog/credentials` 里的 token (= AuthSession.id) 每次请求带上
- **流格式** (WS): 行分隔 JSON

下行 (Engine → CLI):
```
{"type":"agent.thinking", "delta":"..."}
{"type":"agent.message", "delta":"..."}
{"type":"agent.tool_use", "tool":"Bash", "input":"..."}
{"type":"agent.tool_result", "ok":true, "output":"..."}
{"type":"agent.requires_action", "id":"...", "prompt":"..."}
```

上行 (CLI → Engine):
```
{"type":"user.input", "text":"..."}
{"type":"user.action", "id":"...", "decision":"allow|deny"}
```

事件类型保持 engine-neutral —— `agent.thinking` / `agent.tool_use` 等是 aprog 协议层的术语, 不是 Claude Agent SDK 的术语. Driver 负责把 SDK 的 `AssistantMessage / SystemMessage / ResultMessage` 翻成这套事件.

### 链路 2: Control Plane ↔ Sandbox

通过 **Daytona exec + Bridge** 实现. 一次 attach 期间:

1. Control Plane 调 Daytona SDK 起一个 exec: `daytona exec <sandbox_id> -- aprog-bridge --from-offset=<N>`
2. `aprog-bridge` 在沙箱内启动, 连接 Driver 的本地 socket (`/run/aprog/io.sock`)
3. Bridge 把 socket 的下行字节 pipe 到自己的 stdout (Daytona 把它流回 Control Plane)
4. Bridge 把自己的 stdin 字节 (来自 Control Plane 的 user.input) pipe 到 socket
5. CLI WS 断开 → Control Plane 关 exec → Bridge 退出. Driver 不变, 继续接 Engine 输出写自己的缓冲

为什么要 Bridge 而不是直接 `daytona exec` driver 启动命令? 因为 Driver 是**沙箱生命周期长跑的**, 不能跟某一次 attach 绑命. Bridge 才是按 attach 起灭的一次性管道.

### 链路 3: Driver ↔ Engine

进程内. Driver 是 TS, `import { query } from '@anthropic-ai/claude-agent-sdk'`, 用 streaming-input mode 跑:

```typescript
for await (const message of query({
  prompt: userInputAsyncIterable,    // 从 socket 来的 user.input
  options: {
    cwd: "/home/aprog",
    settingSources: ["project"],     // 加载 /home/aprog/.claude/skills/
    resume: existingSessionId,       // mode-2 attach 时用
    hooks: { UserPromptSubmit: [...], PostToolUse: [...], SessionEnd: [...] },
  }
})) {
  // 翻成 aprog 协议事件 → 写 socket + 写 events.log
}
```

Engine 自己的 session 持久化是 `/home/aprog/session.jsonl` (SDK 默认行为).

## 关键决策

### ADR-1: Control Plane 代理沙箱流, 不让 CLI 直连沙箱

**决策**: 所有 CLI 到沙箱的数据通过 Control Plane 中转, CLI 永远不直接连沙箱端口.

**理由**:
- 单一鉴权面: 只有一套 `aprog credentials` token 模型, 不需要二级 sandbox 凭据
- Sandbox provider 抽象不漏: 换 Daytona 只动 Control Plane
- 沙箱不暴露公网端口, 攻击面小
- 控制面流量负担可控 (chat 流相对反代是零头), 不是延迟瓶颈

**代价**: Control Plane 在每条流的热路径上. 真规模化后需要做反代水平扩展, 但架构不变.

**何时重审**: 当出现单条数据流真的撑不住代理 (例如沙箱里跑的程序要直接接大文件 IO) 时, 开旁路通道, 但主交互流仍走代理.

### ADR-2: 沙箱里需要一个常驻 Driver, 不是裸跑 Engine

**决策**: 沙箱内常驻 `claude-driver` 进程, 跨 attach/detach 持续活, 兜住 Engine 输出.

**理由**:
- detach 后 CLI 走了, Control Plane → 沙箱的连接也该关 (否则要永远持一根空连接). 但 Engine 还在跑 / 等输入, 产出得有东西兜
- reattach 时要"看到 detach 这段时间发生了啥", 需要本地 buffer
- aprog 协议层的事件翻译 (SDK 消息 → aprog 事件) 必须在某处发生, 在沙箱内做比在 Control Plane 做更对 —— 让 platform 跟 engine 解耦

### ADR-3: Engine 是可替换的, Program 不知道 Engine

**决策**: Program (skill) 只表达"我要做什么", 不调用任何 engine-specific API. Engine 的差异封在 Driver.

**理由**:
- aprog 平台的价值在于"管 program 的生老病死", 不是绑定某个 LLM 厂商
- Claude Agent SDK 跟 Codex SDK 的 API 形态不同, 但都是 agent loop + 工具调用, 抽象上对等
- 同一段 program 应该能换 engine 跑, 性价比 / 能力差异留给运维决定

**实现路径**: 每款 engine 一个 `<name>-driver` 包. driver 暴露给 aprog 协议的 wire format 固定 (上面的 JSON 事件), 暴露给 platform 的 socket 协议固定. 内部怎么调 SDK 是 driver 的事.

**当前 MVP**: 只实现 `claude-driver`. `codex-driver` 等留 stub, 接口先对齐.

### ADR-4: Session.jsonl 也是快照的一部分

**决策**: Engine 自己的 session 文件 (`session.jsonl`) 跟 `meta.yml / input.md / execution-state/` 一样, 包含在快照里, 跟 process 同生命周期.

**理由**:
- Claude Agent SDK 把 session 持久化为 JSONL 在工作目录里, tar-out/in 顺带就带上了, 成本是 0
- attach mode 2 (exit 后重启) 因此可以"接着对话继续", 而不是冷启动. 对用户的 UX 影响巨大 —— program state 跟对话上下文在用户脑子里是一体的
- "harness session 抽象成应用层关心的形态再持久化"是另一条路, 当前不走 (engine 内置 resume 已经够用)

**修订**: 替代之前 data-model.md 里"harness session 不持久化"的设定. 见 data-model.md 的对应修订.

**代价**: Engine 换种 (Claude → Codex) 时, session.jsonl 不可移植, 那个 process 需要冷启动一次. 可接受 —— 换 engine 是稀有事件.

## 代码分层 (仓库)

预期的 monorepo 目录结构 (mvp 初步规划):

```
aprog/
├── cli/              ← CLI 客户端 (Go 或 TS, 待定)
├── controlplane/     ← 后端服务 + DB 迁移 + 沙箱编排
│   ├── api/             HTTP/WS endpoints
│   ├── auth/            login/logout/token
│   ├── process/         spawn/attach/detach/exit 流程
│   ├── snapshot/        快照磁盘 IO
│   ├── sandbox/         Daytona SDK 封装 + bridge 调用
│   └── stream/          反代 driver 流到 CLI WS
├── drivers/
│   ├── claude/          claude-driver (TS), 当前唯一 driver
│   │   └── 依赖 @anthropic-ai/claude-agent-sdk
│   └── codex/           占位, MVP 不实现
├── bridge/           ← 沙箱内 bridge 工具, 跨 driver 共用 (可能就是个 Go binary)
├── protocol/         ← 协议定义 (event types, socket message schema, 共享给 driver + controlplane)
├── docs/             ← 本目录
└── programs/         ← 内置 skills (开发期; 部署形态可能换地方)
```

### Dependency 方向 (单向, 无循环)

```
cli ─────► controlplane.api
controlplane ─────► drivers/* (作为镜像内容, 不是代码依赖)
controlplane ─────► protocol
drivers/* ─────► protocol
drivers/* ─────► engine SDK (各自的)
bridge ─────► protocol (只是 transport, 不解析 payload)
```

`controlplane` 跟 `drivers/*` 没有源码依赖 —— driver 跟着 sandbox 镜像一起烘进去, 通过 socket 协议交互. 这保证了 driver 可独立演化.

### Sandbox 镜像 (template)

沙箱镜像包含:
- 基础 OS (Ubuntu) + 常用工具 (git, curl, ...)
- `claude-driver` binary
- `aprog-bridge` binary
- Node.js runtime (跑 driver)

镜像版本随 driver / bridge 一起 bump. spawn 时 Control Plane 选用当前 active 镜像 (硬编码或配置, MVP 不入库).

## 跨组件流程示例

**一次 attach mode 1 的完整调用链**:

```
1. CLI: aprog attach 260521-x9k4
   └─► HTTP POST /proc/260521-x9k4/attach (token in header)

2. Control Plane:
   - 验 token → User
   - 查 Process(pid=260521-x9k4), 验 user_id 匹配, sandbox_id 为 null → mode 1
   - 调 Daytona SDK 起新 sandbox (镜像 aprog/base:0.1)
   - 拿到 sandbox_id, 写 Process.sandbox_id + sandbox_started_at
   - tar 注入 snapshot_path 内容到沙箱 /home/aprog/
   - Daytona exec: 启动 claude-driver (后台)
   - 返回 CLI: 200 OK, 给一个 WS endpoint URL

3. CLI: 升级 WS 连 /proc/.../stream

4. Control Plane (收到 WS 连接):
   - 调 Daytona exec: aprog-bridge --from-offset=0 (前台, 拿 stdio)
   - bridge 在沙箱内连上 claude-driver 的 socket
   - Control Plane 开始: bridge.stdout → parse → WS.send 到 CLI
   - CLI 输入: WS.recv → bridge.stdin → driver → engine

5. 用户在 TUI 里输入 "do X":
   {"type":"user.input","text":"do X"} 一路 WS → bridge → driver socket
   → driver 喂给 query() 的 prompt iterable
   → Engine 跑 agent loop
   → 各种消息从 query() async iterator 出来
   → driver 翻成 aprog 事件 → 写 socket + append events.log
   → bridge pipe 出去 → Control Plane → CLI WS
   → TUI 渲染

6. 用户 /detach:
   CLI 关 WS → Control Plane 关 Daytona exec (bridge 退出)
   → driver 不动, 继续接 engine 输出写 events.log
   → Control Plane 更新 Process.last_attached_at
```

**reattach (mode 3)**: 跟 step 4-6 一样, 只是 step 2 检查到 sandbox_id 非 null, 跳过沙箱创建 + 注入, bridge 的 `--from-offset` 用上次记录的 cursor 让 driver 重放间隙事件.

**/exit**: 见 [data-model.md](./data-model.md) 的快照生命周期表. Driver 收到 SessionEnd → 通知 Control Plane → 后者 tar-out /home/aprog → 销毁沙箱 → Process.sandbox_id=null, state=exited.

## 后续待定

- **Web UI** 形态: 是另一种 CLI 客户端 (WS 协议同), 还是 Control Plane 内置一个 SPA? 暂留待定
- **多 viewer attach** (一个 process 同时被多人看): 协议留口 (bridge 可以多实例), MVP 不做
- **审计日志**: events.log 是否回传 Control Plane 长留. MVP 不做
- **Driver 热升级**: 新版 driver 出来怎么滚动到已经 spawn 的 process? MVP 不考虑 (新 process 用新镜像即可)
