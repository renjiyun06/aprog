# design (mock)

占位 mock 程序,**无真实内容**,仅用于走通「OCI 发布 → driver 拉取」流程。

角色:**依赖方**。依赖声明见同目录 `aprog.json`(依赖 state)。SKILL.md 只放 skill 内容,不背依赖、不写版本。

`aprog-publish` 读 `aprog.json` 的 `dependencies`,把 state 解析、按 digest 钉死进 design 的 OCI manifest(layer)+ config(lockfile);harness 只看依赖的"键"(版本无关)。
