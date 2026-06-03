import { type SessionEvent, type FsNode } from '../../components/ProgramShell';
import { makeProgram, type ProcState } from '../shell-program';

/* ──────────────────────────────────────────────────────────────────────
   UI 设计 (design) — the richest example program; one full mock execution
   (acme) plus a few sibling processes. All data is mock (no backend yet).
   ──────────────────────────────────────────────────────────────────── */

const acmeEvents: SessionEvent[] = [
  { kind: 'user', body: <>官网重设计, 偏冷淡科技风, 暗色, 要有 hero + 定价. 参考 Linear.</> },
  {
    kind: 'thinking', duration: '2.4s',
    body: <>{`冷淡科技风 + 暗色 + Linear 参考 → saas-landing 模板 / linear-app 设计系统比较合。
首屏排 hero + 3 特性 + 定价 + CTA, 单一 accent 收着用。
先扫一遍可用的设计系统, 确认 linear-app 在库里, 再落地.`}</>,
  },
  {
    kind: 'tool', variant: 'search', name: 'list-resources', arg: 'design-systems',
    dur: '0.3s', collapsed: true, result: <>命中 linear-app · vercel-geist · kami (3/19)</>,
  },
  {
    kind: 'tool', variant: 'read', name: 'read', arg: 'design-systems/linear-app/DESIGN.md',
    dur: '0.2s', collapsed: true, result: <>tokens · 组件 · voice 已载入</>,
  },
  {
    kind: 'agent',
    body: <>方向定了: 模板 <code>saas-landing</code> · 设计系统 <code>linear-app</code>. 首屏排 <strong>hero + 3 特性 + 定价 + CTA</strong>, 单一 accent(靛蓝). 开始写.</>,
  },
  {
    kind: 'tool', variant: 'edit', name: 'write', arg: '~/.aprog/4102/artifacts/index.html', dur: '1.1s',
    result: <>{`+ 84 lines
  · hero       把想法变成发布
  · features   实时协作 / 智能规划 / 一键发布
  · pricing    ¥0 / ¥99 / 定制
  · cta`}</>,
  },
  {
    kind: 'tool', variant: 'run', name: 'bash', arg: 'preview-server ~/.aprog/4102/artifacts --bind 0.0.0.0',
    dur: '0.4s', collapsed: true, result: <>serving on http://0.0.0.0:4310</>,
  },
  {
    kind: 'agent',
    body: <>首屏好了, 预览在 <code>:4310</code>. 单一 accent + 大字 hero, 定价默认 3 档. 下一步加 logos 墙, 还是直接细化定价对比表?</>,
  },
  { kind: 'user', body: <>hero 字号再大点, 配色偏暖一些. 先不加 logos.</> },
  {
    kind: 'thinking', duration: '1.1s',
    body: <>{`两个改动: hero h1 升一档(44→56); accent 从靛蓝 #6c5cff 往暖移, 换偏品红的紫。
只动 styles.css 的 token 和 hero 规则, 别碰结构。`}</>,
  },
  {
    kind: 'tool', variant: 'edit', name: 'edit', arg: '~/.aprog/4102/artifacts/styles.css', dur: '0.6s',
    collapsed: true, result: <>--accent 6c5cff→8a5cff · --h1 44→56px</>,
  },
  {
    kind: 'agent',
    body: <>调好了: hero 升到 <code>56px</code>, accent 暖了一档. 刷新预览即可看到. 还要继续吗?</>,
  },
];

const acmeTree: FsNode[] = [
  { name: 'meta.yml', kind: 'file' },
  { name: 'input.md', kind: 'file' },
  { name: 'session.jsonl', kind: 'file' },
  { name: 'execution-state', kind: 'dir', children: [
    { name: 'state.yaml', kind: 'file' },
    { name: 'brand-brief.md', kind: 'file' },
    { name: 'design-decisions.md', kind: 'file' },
  ] },
  { name: 'artifacts', kind: 'dir', children: [
    { name: 'index.html', kind: 'file' },
    { name: 'pricing.html', kind: 'file' },
    { name: 'about.html', kind: 'file' },
    { name: 'styles.css', kind: 'file' },
    { name: 'assets', kind: 'dir', children: [
      { name: 'tokens.css', kind: 'file' },
      { name: 'icons', kind: 'dir', children: [
        { name: 'logo.svg', kind: 'file' },
        { name: 'check.svg', kind: 'file' },
      ] },
    ] },
  ] },
];

const acmeContents: Record<string, string> = {
  'meta.yml': `id: "4102"
program: design
program_version: 0.4.0
status: running
phase: designing
created_at: 2026-06-02T09:14:00+08:00
last_active_at: 2026-06-02T12:18:00+08:00
state_schema:
  - { key: brand-brief,            storage: by-ref }
  - { key: selected-template,      storage: inline }
  - { key: selected-design-system, storage: inline }
  - { key: selected-craft,         storage: inline }
  - { key: produced-files,         storage: by-ref }`,

  'input.md': `官网重设计, 偏冷淡科技风, 暗色, 要有 hero + 定价. 参考 Linear.

---

hero 字号再大点, 配色偏暖一些. 先不加 logos.`,

  'session.jsonl': `{"t":"user.message","text":"官网重设计, 偏冷淡科技风, 暗色, 要有 hero + 定价. 参考 Linear."}
{"t":"agent.thinking","ms":2400}
{"t":"agent.tool_use","tool":"list-resources","arg":"design-systems"}
{"t":"agent.tool_use","tool":"write","arg":"artifacts/index.html","added":84}
{"t":"agent.tool_use","tool":"bash","arg":"preview-server …"}
{"t":"agent.message","text":"首屏好了, 预览在 :4310"}
{"t":"user.message","text":"hero 字号再大点, 配色偏暖一些."}
{"t":"agent.tool_use","tool":"edit","arg":"artifacts/styles.css"}
{"t":"agent.message","text":"调好了: hero 升到 56px."}`,

  'execution-state/state.yaml': `selected-template: saas-landing
selected-design-system: linear-app
selected-craft: [anti-slop, state-coverage, typography]
current-revision: r3
output-dir: ~/.aprog/4102/artifacts
target-screens: [index, pricing, about]`,

  'execution-state/brand-brief.md': `# acme — brand brief

- 行业: 产品协作 SaaS
- 受众: 产品 / 研发团队
- 调性: 冷淡、克制、科技感; 暗色为主
- 参考: Linear (单一 accent, 大字 hero, 充裕留白)
- 不要: 花哨渐变、emoji、营销腔`,

  'execution-state/design-decisions.md': `# 决策日志

- r1: 选定 saas-landing + linear-app, 单一 accent(靛蓝 #6c5cff)
- r2: hero 文案定为「把想法变成发布」, 定价 3 档
- r3: 用户要求 hero 放大 + 配色偏暖
  → h1 44px→56px; --accent 6c5cff→8a5cff
  (用户偏好覆盖 brand 默认 accent, 已记录)`,

  'artifacts/index.html': `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>acme — 把想法变成发布</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <nav class="nav">
    <span class="logo">acme</span>
    <div class="links"><a>产品</a><a>定价</a><a>文档</a></div>
    <a class="cta">开始使用</a>
  </nav>

  <header class="hero">
    <p class="eyebrow">为高效团队打造</p>
    <h1>把想法<br />变成发布</h1>
    <p class="sub">一个为产品团队设计的现代化协作平台。更快规划，更快交付。</p>
    <div class="actions">
      <a class="btn primary">免费开始</a>
      <a class="btn ghost">看演示 →</a>
    </div>
  </header>

  <section class="features">
    <article><h3>实时协作</h3><p>团队同屏，无缝同步</p></article>
    <article><h3>智能规划</h3><p>自动排期与优先级</p></article>
    <article><h3>一键发布</h3><p>从计划到上线</p></article>
  </section>
</body>
</html>`,

  'artifacts/pricing.html': `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <title>acme — 定价</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <section class="pricing">
    <h1>简单透明的定价</h1>
    <div class="tiers">
      <div class="tier"><h3>入门</h3><p class="price">¥0</p><a class="btn ghost">开始</a></div>
      <div class="tier hot"><h3>团队</h3><p class="price">¥99</p><a class="btn primary">选择</a></div>
      <div class="tier"><h3>企业</h3><p class="price">定制</p><a class="btn ghost">联系</a></div>
    </div>
  </section>
</body>
</html>`,

  'artifacts/about.html': `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <title>acme — 关于</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <section class="about">
    <h1>关于 acme</h1>
    <p>我们相信好的工具应该消失在工作流里。</p>
  </section>
</body>
</html>`,

  'artifacts/styles.css': `:root {
  --bg: #0b0c10;
  --fg: #e8eaf0;
  --muted: rgba(255,255,255,0.55);
  --accent: #8a5cff;     /* 调暖后的靛紫 */
  --line: rgba(255,255,255,0.08);
  --h1: 56px;            /* hero 升档 */
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font-family: Inter, system-ui, sans-serif; }

.nav { display: flex; align-items: center; gap: 16px;
  padding: 14px 22px; border-bottom: 1px solid var(--line); }
.logo { font-weight: 700; letter-spacing: -0.3px; }
.cta { margin-left: auto; background: #fff; color: var(--bg);
  padding: 6px 13px; border-radius: 7px; }

.hero { text-align: center; padding: 56px 24px 40px; }
.hero h1 { font-size: var(--h1); line-height: 1.05; letter-spacing: -1.5px; }
.sub { color: var(--muted); max-width: 380px; margin: 16px auto 0; }`,

  'artifacts/assets/tokens.css': `/* extracted design tokens (linear-app) */
:root {
  --color-accent: #8a5cff;
  --color-bg: #0b0c10;
  --radius-sm: 7px;
  --radius-md: 12px;
  --font-display: "Inter", system-ui, sans-serif;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
}`,

  'artifacts/assets/icons/logo.svg': `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="7" fill="#8a5cff"/>
  <path d="M9 22 L16 9 L23 22 Z" fill="#fff"/>
</svg>`,

  'artifacts/assets/icons/check.svg': `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 8.5 L6.5 12 L13 4.5" stroke="#8a5cff" stroke-width="2"
        fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
};

const SEED: ProcState[] = [
  {
    pid: 4102, name: 'acme · 官网重设计', version: '0.4.0', dot: 'running', dir: '~/.aprog/4102',
    tree: acmeTree, events: acmeEvents, openFiles: [], viewFile: null, contents: acmeContents,
  },
  {
    pid: 4088, name: 'lumen · 移动端 onboarding', version: '0.4.0', dot: 'running', dir: '~/.aprog/4088',
    tree: [
      { name: 'meta.yml', kind: 'file' },
      { name: 'input.md', kind: 'file' },
      { name: 'execution-state', kind: 'dir', children: [{ name: 'state.yaml', kind: 'file' }] },
    ],
    events: [
      { kind: 'user', body: <>做个 onboarding 引导, 4 屏, 移动端优先.</> },
      { kind: 'thinking', duration: '1.8s', body: <>先确认 4 屏的叙事节奏再落地…</> },
    ],
    openFiles: [], viewFile: null,
    contents: {
      'meta.yml': `id: "4088"\nprogram: design\nstatus: running\nphase: selecting`,
      'input.md': `做个 onboarding 引导, 4 屏, 移动端优先.`,
      'execution-state/state.yaml': `selected-template: mobile-onboarding\nselected-design-system: ~`,
    },
  },
  {
    pid: 3971, name: 'fin dashboard', version: '0.3.0', dot: 'hibernating', dir: '~/.aprog/3971',
    tree: [
      { name: 'meta.yml', kind: 'file' },
      { name: 'artifacts', kind: 'dir', children: [
        { name: 'dashboard.html', kind: 'file' },
        { name: 'tokens.css', kind: 'file' },
      ] },
    ],
    events: [{ kind: 'agent', body: <>dashboard 已交付 8 个文件, 进程休眠中. 唤醒后可继续迭代.</> }],
    openFiles: [], viewFile: null,
    contents: {
      'meta.yml': `id: "3971"\nprogram: design\nstatus: hibernating\nphase: done`,
      'artifacts/dashboard.html': `<!doctype html>\n<html>\n<body>\n  <main class="dashboard">\n    <h1>Fin Dashboard</h1>\n  </main>\n</body>\n</html>`,
      'artifacts/tokens.css': `:root {\n  --bg: #0d1117;\n  --accent: #3fb950;\n}`,
    },
  },
  {
    pid: 3840, name: 'brandbook 提案', version: '0.4.0', dot: 'running', dir: '~/.aprog/3840',
    tree: [
      { name: 'meta.yml', kind: 'file' },
      { name: 'input.md', kind: 'file' },
    ],
    events: [
      { kind: 'user', body: <>想要一份品牌手册的提案.</> },
      { kind: 'agent', body: <>先聊聊品牌调性: 你希望它给人的第一感觉是?</> },
    ],
    openFiles: [], viewFile: null,
    contents: {
      'meta.yml': `id: "3840"\nprogram: design\nstatus: running\nphase: discovery`,
      'input.md': `想要一份品牌手册的提案.`,
    },
  },
];

export const Design = makeProgram('UI 设计', SEED, 4200);
