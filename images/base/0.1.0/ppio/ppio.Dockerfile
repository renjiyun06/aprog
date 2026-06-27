# aprog base 镜像 · PPIO 烘法 —— ubuntu:24.04 + 以 root 运行 + 预装工具链（claude-code 引擎 + GLM 路由）。
#
# 与旧法（FROM code-interpreter）的两点根本不同：
#   · 底座换成裸 ubuntu:24.04。envd 控制代理由 PPIO 基础设施在「镜像→microVM」转换时注入，不在本镜像里
#     （已查 CLI 0.1.3：template build 只 `docker build 你的Dockerfile && docker push`，不 COPY/注入 envd、
#     不设 ENTRYPOINT），故换裸底座对 files.write / commands.run 控制链无影响。
#   · 以 root 运行：工具与引擎全装进 /root，默认用户设 root。PPIO 是否认 USER root 作运行时默认用户未文档化——
#     provider 侧已对 files.write/commands.run 显式带 user:'root'，故无论认不认，driver 都以 root 落 /root、以 root 跑。
#
# 只烘「非密、可共享的底座」：OS + 工具链 + 引擎 + GLM 路由（base_url/模型映射，非密）。绝不烘任何 token——
# GLM 密钥（ANTHROPIC_AUTH_TOKEN）/ bindToken / git 凭证全部运行时经 driver env 注入；driver 本体也不烘，
# 随 create 经 files.write 推入、后台 node 启动。
#
# 约束（E2B/PPIO 自定义模板）：必须 Debian 系/glibc（ubuntu 满足）、必须单阶段（不支持 multi-stage）。

FROM ubuntu:24.04

# ubuntu 镜像默认即 root；显式声明意图 + 固定 HOME/cwd，使下方工具链落点与运行用户一致。
USER root
ENV HOME=/root
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /root

# 基础系统包：装版本管理器的最小依赖。
#   curl —— 拉各安装脚本；git —— clone 种子/依赖；unzip+zip —— sdkman/bun 解包；
#   xz-utils —— 解 node tar.xz；ca-certificates —— HTTPS 信任根；build-essential —— 编译原生扩展（开发沙箱常需）。
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip zip xz-utils build-essential \
 && rm -rf /var/lib/apt/lists/*

# 工具链全装进 /root（运行用户=root、HOME=/root，落点与运行用户一致）。
ENV NVM_DIR=/root/.nvm \
    BUN_INSTALL=/root/.bun \
    SDKMAN_DIR=/root/.sdkman
# 实测要点：PPIO 的 envd 非交互执行命令时【忽略镜像 ENV PATH】，只认 /usr/local/bin + 系统默认目录
# （另会自动把 nvm 当前 node 的 bin 前置）。故凡要在沙箱里（含 driver/引擎）可调的二进制，一律软链进
# /usr/local/bin —— 这才是可靠机制，ENV PATH 仅对交互登录 shell 有意义（留作便利，非依赖）。
# sdkman 走 shell 函数、须运行时 source sdkman-init.sh，无单一二进制可软链。
ENV PATH=/root/.local/bin:/root/.bun/bin:/usr/local/bin:$PATH

# 1) uv —— python 包/版本管理（装到 /root/.local/bin，软链进 /usr/local/bin 使非交互可见）。
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && ln -sf /root/.local/bin/uv  /usr/local/bin/uv \
 && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx

# 2) bun —— JS 运行时/包管理（装到 /root/.bun，软链进 /usr/local/bin 使非交互可见）。
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun  /usr/local/bin/bun \
 && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

# 3) sdkman —— JVM 生态管理（装到 /root/.sdkman；不预置任何 JDK，按需 `sdk install java`）。
RUN curl -s https://get.sdkman.io | bash

# 4) nvm + node LTS —— 引擎(claude-code)与 driver 都依赖 node。装 nvm 后取 LTS，并把 node/npm/npx 软链到
#    /usr/local/bin：SDK 经 commands.run 非交互起 driver 时不 source ~/.bashrc，故 node 必须在默认 PATH 上。
#    node 二进制走 npmmirror 镜像下载（dev VM 在国内，nodejs.org 慢）。
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
 && . "$NVM_DIR/nvm.sh" \
 && NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node nvm install --lts \
 && nvm use --lts \
 && NODE_BIN="$(dirname "$(nvm which current)")" \
 && ln -sf "$NODE_BIN/node" /usr/local/bin/node \
 && ln -sf "$NODE_BIN/npm"  /usr/local/bin/npm \
 && ln -sf "$NODE_BIN/npx"  /usr/local/bin/npx

# 5) claude-code 引擎（全局 npm，走 npmmirror）。装进 nvm node 的全局 bin，再把 `claude` 软链到 /usr/local/bin，
#    使非交互起的 driver 子进程（引擎）能在默认 PATH 找到它。
RUN . "$NVM_DIR/nvm.sh" && nvm use --lts \
 && npm config set registry https://registry.npmmirror.com \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force \
 && NODE_BIN="$(dirname "$(nvm which current)")" \
 && ln -sf "$NODE_BIN/claude" /usr/local/bin/claude

# 6) 烘 GLM 路由（非密）到 root 的 ~/.claude/settings.json。密钥不在此处，运行时注入。
RUN mkdir -p /root/.claude
COPY settings.json /root/.claude/settings.json
