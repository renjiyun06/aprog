# aprog base 镜像 · PPIO 烘法（claude-code 引擎 + GLM 路由）。
#
# 只烘「非密、可共享的底座」：引擎二进制（claude-code）+ GLM 路由配置（base_url + 模型映射，非密）。
# 绝不烘任何 token：
#   · GLM 密钥（ANTHROPIC_AUTH_TOKEN）—— 运行时经 driver env 注入（见 control-plane engineAuthToken）。
#   · bindToken / git 凭证 —— 同样运行时注入，永不入镜像。
# driver 也不烘：随 create 经 files.write 推入 + 后台 node 启动（base 自带 node v20）。
#
# 基础镜像选 PPIO 的 code-interpreter：自带 node v20.9 / python 3.11 / envd 控制代理（SDK 的
# files.write / commands.run 依赖它）。template build 会再注入 .e2b envd 层。默认运行用户 = user（非 root）。
FROM image.ppinfra.com/sandbox/code-interpreter:latest

# 装 claude-code（引擎 CLI）。走 npmmirror 提速/稳连（dev VM 在国内，npmjs 慢且易抖）。
USER root
RUN npm config set registry https://registry.npmmirror.com \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force

# 烘 GLM 路由（非密）到 user 的 ~/.claude/settings.json。密钥不在此处，运行时注入。
RUN mkdir -p /home/user/.claude
COPY settings.json /home/user/.claude/settings.json
RUN chown -R user:user /home/user/.claude || true

# 还原默认运行用户（base 约定 user，非 root；driver 落点 /home/user/aprog 据此可写）。
USER user
