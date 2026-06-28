# state (mock)

占位 mock 程序,**无真实内容**,仅用于走通「OCI 发布 → driver 拉取」流程。

角色:被多个程序依赖的**共享库**(高扇入)。OCI 闭包里靠 layer 内容寻址去重,registry 只存一份、driver 全机只拉一次。

依赖声明不在这里——见同目录 `aprog.json`(叶子,无依赖)。SKILL.md 只放 skill 内容;程序自己的名/版本来自路径 `programs/state/0.1.0/`。
