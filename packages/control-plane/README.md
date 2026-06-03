# control-plane

aprog 的**控制平面**。运行在 aprog VM（非沙箱内），看守每个进程的生命周期
（spawn / hibernate / wake / kill），贴 `/proc/<pid>/` 隐喻与「管理 AI 程序」的定位。

## 职责（对应 docs/components.html 组件清单）

| 模块 | 目录 | 干什么 |
|---|---|---|
| 进程编排 | `src/process/` | PCB、生命周期 FSM（spawn/hibernate/wake/kill）、进程目录 `~/.aprog/<pid>/` |
| 沙箱编排（A 平面）| `src/sandbox/` | provider SDK 起停容器（create/destroy/hibernate/wake）；不碰文件 |
| 数据平面（B 平面）| `src/driver-channel/` | 受理 driver 拨入的常驻 DriverChannel：事件上行、输入/控制/fs 下行、bootstrap/检查点/恢复的大块传输 |
| 事件流中枢 | `src/stream/` | 每进程一条 append-only 流：control-plane 盖全局 seq、压实、多 viewer 扇出、断线 resync |
| 持久化 | `src/persistence/` | 检查点存储（DriverChannel 流回的 state 子集），耐久事实源 |
| API | `src/api/` | 给 web 前端的 REST（spawn/ps/kill…）+ 事件流订阅（SSE/WS） |

## 不变量

- **事件流是唯一数据源**：实时、持久、恢复都由它承载（见 docs/protocol.html）。
- **进程状态不依赖对话**：resume 靠进程目录里的 state，绝不反向重建引擎上下文（见 docs/state.html）。
- **引擎差异全吸收进 driver**：control-plane 只认 `@aprog/protocol` 的事件，不知下面是 Claude 还是 Codex。

## 运行（占位）

```sh
bun run dev    # 热重载
bun run start
```
