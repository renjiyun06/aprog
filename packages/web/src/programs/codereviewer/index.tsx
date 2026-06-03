import { For, type Component } from 'solid-js';

interface Proc {
  pid: number;
  label: string;
  sub: string;
  state: 'attached' | 'running' | 'hibernating' | 'warn' | 'exited' | 'spawning';
  active?: boolean;
}

const procs: Proc[] = [
  { pid: 7421, label: 'review · auth middleware',  sub: '12m · /turn 14',     state: 'attached', active: true },
  { pid: 7415, label: 'review · payment flow',     sub: '38m · /turn 27',     state: 'attached' },
  { pid: 7402, label: 'audit · queue worker',      sub: '1h 14m',             state: 'running' },
  { pid: 7389, label: 'sweep · stale TODOs',       sub: '2h 8m · /turn 91',   state: 'running' },
  { pid: 6831, label: 'migrate · v1 → v2 schema',  sub: '休眠 4h ago',        state: 'hibernating' },
  { pid: 5901, label: 'refactor · pkg/cache',      sub: '等待审批',           state: 'warn' },
  { pid: 4231, label: 'probe · feature flag',      sub: '退出 22h · code 1',  state: 'exited' },
  { pid: 7488, label: 'spawn · review · cli flags',sub: '沙箱挂载中…',        state: 'spawning' },
];

export const CodeReviewer: Component<{ pid?: number }> = () => (
  <>
    <aside class="win-sidebar">
      <div class="win-sidebar-header">
        <span class="label">进程 · codereviewer</span>
        <span class="count">{procs.length}</span>
      </div>
      <div class="sb-list">
        <For each={procs}>{(p) => (
          <div class={`sb-row ${p.active ? 'active' : ''}`}>
            <span class={`state-dot ${p.state}`} />
            <div class="meta">
              <span class="meta-label">{p.label}</span>
              <span class="meta-sub">{p.pid} · {p.sub}</span>
            </div>
          </div>
        )}</For>
      </div>
      <div class="sb-section">
        <div class="win-sidebar-header" style={{ 'padding-top': '0' }}>
          <span class="label">~/.aprog/7421</span>
        </div>
        <div class="sb-list">
          {[
            { name: 'meta.yml', sub: '' },
            { name: 'input.md', sub: '14 entries' },
            { name: 'session.jsonl', sub: '312 events' },
            { name: 'execution-state/', sub: '' },
            { name: 'artifacts/', sub: '2 files' },
          ].map((f) => (
            <div class="sb-row" style={{ padding: '4px 10px 4px 14px' }}>
              <div class="meta">
                <span class="meta-label mono" style={{ 'font-size': '12px' }}>{f.name}</span>
                {f.sub && <span class="meta-sub">{f.sub}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>

    <div class="win-main">
      <div class="chat-stream">
        <div class="msg msg-user">
          review the auth middleware in <code>pkg/auth/middleware.go</code> for race conditions. focus on the session-token cache.
        </div>

        <div class="evt evt-thinking"><span class="caret">▸</span>thinking<span class="duration">2.4s</span></div>

        <div class="evt evt-tool kind-search">
          <div class="evt-tool-head">
            <span class="caret">▸</span>
            <span class="tool-name">rg</span>
            <span class="tool-arg">"sync\.(RW)?Mutex|sync\.Map" pkg/auth/</span>
            <span class="tool-dur">0.18s</span>
          </div>
          <div class="evt-tool-body">{`pkg/auth/middleware.go:31:\tmu       sync.Mutex
pkg/auth/middleware.go:84:\tm.mu.Lock()
pkg/auth/middleware.go:97:\tm.mu.Unlock()
pkg/auth/session.go:18:\tstore    sync.Map`}</div>
        </div>

        <div class="evt evt-tool kind-read">
          <div class="evt-tool-head">
            <span class="caret">▸</span>
            <span class="tool-name">read</span>
            <span class="tool-arg">pkg/auth/middleware.go · 1–120</span>
            <span class="tool-dur">0.04s</span>
          </div>
          <div class="evt-tool-body collapsed">120 lines · cache + lock guards. 点击展开.</div>
        </div>

        <div class="evt evt-thinking"><span class="caret">▸</span>thinking<span class="duration">3.7s</span></div>

        <div class="msg msg-agent">
          两处问题, 都跟 cache 的 hot-path 有关:
          <ul>
            <li><strong>L84–97</strong>: <code>mu.Lock()</code> 圈住整段, 但中间一次 <code>ctx.Err()</code> 检查在 lock 之外 — 重入时可能 panic. 应该把 ctx 检查挪进 critical section, 或用 <code>defer m.mu.Unlock()</code> 简化退出路径.</li>
            <li><strong>L31 + session.go L18</strong>: <code>sync.Mutex</code> + <code>sync.Map</code> 两套锁原语混用, 读多写少场景下 <code>RWMutex</code> 更合适. 统一成 <code>RWMutex</code>.</li>
          </ul>
          建议直接改成下面这个签名:
          <div class="codeblock">{`type sessionCache struct {
    mu    sync.RWMutex
    items map[string]*Session
    ttl   time.Duration
}`}</div>
        </div>

        <div class="evt evt-action">
          <div class="ra-head">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 2 L18 17 L2 17 Z"/><path d="M10 8 V12 M10 14.5 V15"/></svg>
            <span>需要审批 · 编辑文件</span>
          </div>
          <div class="ra-msg">
            Edit <code>pkg/auth/middleware.go</code> + <code>pkg/auth/session.go</code> — 把 <code>sync.Mutex</code> &amp; <code>sync.Map</code> 替换为一个 <code>sync.RWMutex</code> 包裹的 cache struct (~28 行改动). 触及 auth hot-path.
          </div>
          <div class="ra-buttons">
            <button class="btn allow">允许</button>
            <button class="btn deny">拒绝</button>
            <span class="ra-shortcut"><kbd>⌘↵</kbd> <kbd>esc</kbd></span>
          </div>
        </div>
      </div>

      <div class="composer">
        <div class="input-wrap">
          <div class="ph">回复或按 <kbd>esc</kbd> detach…</div>
          <div class="toolbar">
            <span>↥ 附件</span>
            <span class="sep">·</span>
            <span>/ 命令</span>
            <span class="right"><kbd>⌘↵</kbd> 发送 · <kbd>⌘\</kbd> detach</span>
          </div>
        </div>
        <button class="send-btn" aria-label="send">
          <svg viewBox="0 0 16 16"><path d="M2 8 L14 2 L9 14 L8 9 Z"/></svg>
        </button>
      </div>

      <footer class="win-status">
        <span class="state-dot attached" style={{ width: '6px', height: '6px' }} />
        <span>attached</span>
        <span class="sep">·</span>
        <span>PID 7421</span>
        <span class="sep">·</span>
        <span>sandbox sb-2a4f7c · 4 cpu / 8 gib</span>
        <span class="sep">·</span>
        <span>14 turns</span>
        <span style={{ 'margin-left': 'auto' }}>312 events · session.jsonl 1.4 mb</span>
      </footer>
    </div>
  </>
);
