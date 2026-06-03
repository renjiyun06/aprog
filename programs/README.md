# programs

aprog 平台**内置**的智能程序目录——系统自带、随平台一起暴露给用户的那批。
将来「任何人都能编写智能程序」的那些是**动态数据**（另存于运行时存储，不在此仓库），
但形态一致：都是一个 `SKILL.md` 包，靠 frontmatter 的 `kind` 区分种类。

## 两类（按 `kind`）

| 子目录 | `kind` | 是什么 | 现有 |
|---|---|---|---|
| `applications/` | `application` | **程序**：有执行模型（FSM / 阶段 / 产物），被运行，`depends_on` 引用库 | design · shape · skin · grasp |
| `libraries/` | `library` | **库**：封装协议/方法/机制，**被引用而非被执行** | state · live-annotate |

依赖方向单向：`application → library`。例如 `design` 依赖 `state`（状态协议）和 `live-annotate`（预览/批注）。

## 与三公民模型的关系

`programs/` 是 [Library / Program / Capability] 三公民里的 **Program + Library** 两层；
另两个公民各有其家：

- `capabilities/` —— Capability 层（给底层 harness 调的 CLI / MCP 工具）
- `packages/` —— 平台代码（control-plane / driver / protocol / web，TS）

## 内置 vs 动态

此目录是**内置 seed**。平台把它当作出厂自带的程序目录读取并暴露。
用户自创的程序走运行时的动态目录（DB / 对象存储），`kind` 作为字段而非目录边界——
所以「内置 → 动态」的提升是同形的，不需要换一套表示。
