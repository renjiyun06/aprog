# aprog CLI

aprog 平台的命令行入口.

## 命令

### `aprog login`

登录到 aprog 平台. 凭据保存在本地, 之后所有命令默认带上.

```
$ aprog login
Username: lamarck
Password: ********
Logged in as lamarck.
```

- 参数: `-u <username>` 跳过用户名提示.
- 数据写入: `~/.aprog/credentials` (mode 0600).
- 退出码: 0 成功, 1 凭据错, 2 平台不可达.

### `aprog logout`

退出本地 session, 清除凭据.

```
$ aprog logout
Logged out.
```

- 数据变更: 删除 `~/.aprog/credentials`; control-plane 失效该 token.
- 退出码: 0 总是.

### `aprog programs [<name>]`

无参 → 列出当前可用的 programs (可被 spawn 的 skill):

```
$ aprog programs
NAME           VERSION  KIND         DESCRIPTION
grasp          0.1.0    application  读项目, 产出工作心智模型
shape          0.2.0    application  把模糊愿景塑形为结构化 brief
design         0.4.0    application  出可批注的高保真 mockup
live-annotate  0.4.0    library      浏览器端标注流水
state          0.3.0    library      execution 状态协议
```

带参 → 查看单个程序的详情:

```
$ aprog programs grasp
Name:         grasp
Version:      0.1.0
Kind:         application
Description:  读项目, 产出工作心智模型
```

- 数据源: 文件系统扫描 (`~/.aprog/programs/`).
- 退出码: 0 成功, 1 program 不存在 (带参时).

### `aprog ps`

列出当前用户的 processes.

```
$ aprog ps
PID            PROGRAM  STATE       PHASE         UPTIME    IDLE
260521-7t2m    grasp    running     concepts      0:14:32   00:00:42
260520-lp1n    grasp    running     mechanisms    3:12:04   00:01:08
260520-bcfe    design   exited      designing     2d 3h     —
```

- 参数:
  - `-a / --all`: 显示已 `exited` 的进程 (默认只显示 `spawned / running`).
- 数据源: control-plane DB.
- `STATE` 取值: `spawned / running / exited` (详见 [data-model.md](./data-model.md)).

### `aprog spawn <program>`

创建一个 process. **不起沙箱**, 仅平台内动作: 注册 process meta + 创建 volume.

```
$ aprog spawn grasp
260521-x9k4
```

- 参数: `<program>` 程序名. 初始输入由后续 attach 后在 TUI 内喂入.
- 输出: PID 一行.
- 退出码: 0 成功, 1 program 不存在, 2 配额 / 权限错.
- 不触达 Daytona compute. 起沙箱推迟到首次 attach.

### `aprog attach <pid>`

进入 process 的 TUI 界面, 持续交互. 类比 `screen -r` —— 智能 dispatch, 三种内部 mode 自动决定:

| Mode | 触发条件 | 行为 |
|---|---|---|
| 1. 首次 | spawn 后, 沙箱从未存在 | 起新沙箱 + 启 harness + 空白起步 |
| 2. exit 后再来 | exit 后, 沙箱不存在, volume 有内容 | 起新沙箱 + 启 harness + 从 volume hydrate |
| 3. detach 后重接 | 沙箱仍在, harness 在跑 | 直接重连 UI, sandbox 与 harness 不动 |

mode 1 与 mode 2 是同一段代码 (起沙箱 + 从 volume 读 state, 只是 mode 1 的 volume 是空的). dispatch 唯一 bit: **沙箱当前是否存在**.

- 参数: `<pid>`.
- 输出: 进入交互 TUI; 退出 TUI 后退出码 0.

## TUI 内命令 (slash)

attach 后, 输入框接受两类输入:
- 普通文本 → 发给 AI
- `/` 开头 → TUI 命令

| 命令 | 行为 |
|---|---|
| `/detach` | 退 TUI, 沙箱继续, harness 会话状态保留. 再 attach 走 mode 3 (即时). |
| `/exit` | 关沙箱 (state 完整保留), 本回合结束. 再 attach 走 mode 2 (冷启动). |

**没有 `/kill`**: 状态永不删除, kill 这个动作在 aprog 不存在.

可发现性 (因为不依赖快捷键):
- TUI footer 常驻灰字提示: `/detach 离开 · /exit 关沙箱`
- 输入框 placeholder: "发消息, 或 /detach 离开"
- 输入 `/` 时弹候选
