import { createSignal, onCleanup, onMount, For, Show, type Component, type JSX } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { highlightFile } from '../lib/highlight';
import { auth } from '../stores/auth';

/* ── share (demo / mock) ──────────────────────────────────────────────
   Per-process sharing: owner can add members as editor (read+write) or
   viewer (read-only). Stand-in for /proc/:pid/shares*. Mock data so the
   share button + 分享管理 panel are visible. */
type ShareRole = 'editor' | 'viewer';
interface Member { userId: string; name: string; role: ShareRole; }

/* ──────────────────────────────────────────────────────────────────────
   ProgramShell — the universal window body for ANY aprog program.

   Three columns, each with one job:
     · LEFT  — the program's PROCESS list. Each process has a PID and is one
               ~/.aprog/<id>/ directory. "+" spawns a new process (form:
               name only for now). Clicking a process attaches to it.
     · CENTER— the EXECUTION. A tab strip (appears once a file is open) over
               the active tab: tab 1 is the live conversation (user ↔
               harness, auto-approved: thinking / tool / reply); opened files
               are sibling tabs shown READ-ONLY with syntax highlighting.
     · RIGHT — the attached process's DIRECTORY TREE (~/.aprog/<pid>/), a
               real tree with subdirs (meta.yml, input.md, session.jsonl,
               execution-state/, artifacts/, …). Clicking a file opens it as
               a read-only tab in the center.

   "Open files" is per-process view state owned by the program, so attaching
   to another process swaps the whole tab set + tree (never mixed).
   ──────────────────────────────────────────────────────────────────── */

export interface ProcInfo {
  pid: number;
  name: string;
  /** pinned program version this process runs (from meta.yml.program_version) */
  version?: string;
  /** only two states matter to the user: running (sandbox attached) vs hibernating (no sandbox) */
  dot: 'running' | 'hibernating';
  active?: boolean;
}

/** a node in the proc directory tree */
export interface FsNode {
  name: string;
  kind: 'file' | 'dir';
  children?: FsNode[];
}

/** The canonical aprog session events — user message + the 3 harness outputs. */
export type SessionEvent =
  | { kind: 'user'; body: JSX.Element }
  | { kind: 'agent'; body: JSX.Element }
  | { kind: 'thinking'; duration?: string; body?: JSX.Element }
  | {
      kind: 'tool';
      variant?: 'read' | 'edit' | 'search' | 'run';
      name: string;
      arg: string;
      dur?: string;
      result?: JSX.Element;
      collapsed?: boolean;
    };

export interface ProgramShellProps {
  procTitle: string;
  procs: ProcInfo[];
  procDir: string;
  events: SessionEvent[];
  /** send a message to the attached process */
  onSend?: (text: string) => void;

  /* the attached proc's directory tree */
  tree: FsNode[];
  /** open a file (by full path) as a read-only tab */
  onOpenFile?: (path: string) => void;
  /** re-read the directory tree from the (running) sandbox — manual + polled */
  onSyncTree?: () => void;
  /** re-read one open file's content from the sandbox — manual + polled */
  onSyncFile?: (path: string) => void;

  /* main-pane tab state (per-process, owned by the program).
     viewFile == null|undefined → the conversation tab is active. */
  openFiles: string[];
  viewFile?: string | null;
  onShowChat?: () => void;
  onSelectView?: (path: string) => void;
  onCloseView?: (path: string) => void;
  fileContent?: (path: string) => string;

  /* process lifecycle */
  onAttach?: (pid: number) => void;
  onSpawn?: (name: string) => void;
  /** hibernate a running process (drop its sandbox) */
  onHibernate?: (pid: number) => void;
  /** wake a hibernating process (re-associate a sandbox) */
  onWake?: (pid: number) => void;

  /* directory panel (open/close lives in the titlebar; state is per-window) */
  treeOpen?: boolean;
  treeW?: number;
  onResizeTreeW?: (nw: number) => void;
}

const base = (p: string) => p.split('/').pop() ?? p;

/* ── icons ── */
const Chevron: Component<{ open: boolean }> = (p) => (
  <svg class={`tree-chev ${p.open ? 'open' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 4 L10 8 L6 12" />
  </svg>
);

/* folder icon differs open vs closed */
const FolderIcon: Component<{ open: boolean }> = (p) => (
  <Show
    when={p.open}
    fallback={
      <svg class="tree-ico folder" viewBox="0 0 16 16" fill="none" stroke="#7d8aa0" stroke-width="1.3" stroke-linejoin="round">
        <path d="M2 4.5 H6.3 L7.6 6 H14 V12.5 H2 Z" />
      </svg>
    }
  >
    <svg class="tree-ico folder" viewBox="0 0 16 16" fill="none" stroke="#8aa0c0" stroke-width="1.3" stroke-linejoin="round">
      <path d="M2 4.5 H6.3 L7.6 6 H13.4 V7.6 H2 Z" />
      <path d="M2 7.6 H15 L13.4 12.5 H2 Z" />
    </svg>
  </Show>
);

/* VS-Code-flavored per-extension file icons (color-coded glyphs, no letters) */
const FileTypeIcon: Component<{ name: string }> = (props) => {
  const ext = () => props.name.split('.').pop()?.toLowerCase() ?? '';
  return (
    <Show when={true}>
      {(() => {
        switch (ext()) {
          case 'html': case 'htm': case 'xml': case 'svg': case 'vue':
            return <svg class="tree-ico" viewBox="0 0 16 16" fill="none" stroke="#e37933" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5 L3 8 L6 11" /><path d="M10 5 L13 8 L10 11" /></svg>;
          case 'css': case 'scss': case 'less':
            return <svg class="tree-ico" viewBox="0 0 16 16" fill="none" stroke="#519aba" stroke-width="1.4" stroke-linecap="round"><path d="M6.5 3.5 L5.5 12.5 M10.5 3.5 L9.5 12.5 M4 6.5 H12.5 M3.5 9.5 H12" /></svg>;
          case 'js': case 'mjs': case 'cjs': case 'jsx':
            return <svg class="tree-ico" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="#cbcb41" /></svg>;
          case 'ts': case 'tsx':
            return <svg class="tree-ico" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="#3178c6" /></svg>;
          case 'json': case 'jsonl':
            return <svg class="tree-ico" viewBox="0 0 16 16" fill="none" stroke="#cbcb41" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3 C5 3 5.5 7 4 8 C5.5 9 5 13 6.5 13" /><path d="M9.5 3 C11 3 10.5 7 12 8 C10.5 9 11 13 9.5 13" /></svg>;
          case 'yml': case 'yaml':
            return <svg class="tree-ico" viewBox="0 0 16 16" fill="none" stroke="#a074c4" stroke-width="1.4" stroke-linecap="round"><path d="M4 5 H12 M4 8 H12 M4 11 H9" /></svg>;
          case 'md': case 'markdown':
            return <svg class="tree-ico" viewBox="0 0 16 16" fill="none" stroke="#519aba" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="4" width="12" height="8" rx="1.2" /><path d="M4.3 10 V6 L6.3 8 L8.3 6 V10" /><path d="M10.6 6 V9.3 M9.4 8.2 L10.6 9.5 L11.8 8.2" /></svg>;
          default:
            return <svg class="tree-ico" viewBox="0 0 16 16" fill="none" stroke="#8a8f98" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 H9.5 L13 5.5 V14 H3.5 Z" /><path d="M9.5 2 V5.5 H13" /></svg>;
        }
      })()}
    </Show>
  );
};

/* lifecycle glyphs: moon = hibernate a running proc, power = wake a sleeping one */
const MoonIcon: Component = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 9.5 A5.5 5.5 0 0 1 6.5 3 A5.5 5.5 0 1 0 13 9.5 Z" />
  </svg>
);
const PowerIcon: Component = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2.5 V8" /><path d="M5 4.5 A4.5 4.5 0 1 0 11 4.5" />
  </svg>
);
const SyncIcon: Component = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 7 A5 5 0 1 0 12.5 10" /><path d="M13 3.5 V7 H9.5" />
  </svg>
);

/* ── recursive directory tree node (default collapsed; indent guides) ── */
const TreeNode: Component<{
  node: FsNode;
  path: string;
  activePath?: string | null;
  onOpen: (path: string) => void;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  return (
    <Show
      when={props.node.kind === 'dir'}
      fallback={
        <div
          class={`tree-row file ${props.activePath === props.path ? 'active' : ''}`}
          title={props.path}
          onClick={() => props.onOpen(props.path)}
        >
          <span class="tree-spacer" />
          <FileTypeIcon name={props.node.name} />
          <span class="tree-name">{props.node.name}</span>
        </div>
      }
    >
      <div class="tree-row dir" onClick={() => setOpen((o) => !o)}>
        <Chevron open={open()} />
        <FolderIcon open={open()} />
        <span class="tree-name">{props.node.name}</span>
      </div>
      <Show when={open()}>
        <div class="tree-children">
          <For each={props.node.children ?? []}>{(c) => (
            <TreeNode node={c} path={`${props.path}/${c.name}`} activePath={props.activePath} onOpen={props.onOpen} />
          )}</For>
        </div>
      </Show>
    </Show>
  );
};

const EventView: Component<{ e: SessionEvent }> = (props) => (
  <Show when={true}>
    {(() => {
      const e = props.e;
      switch (e.kind) {
        case 'user':
          return <div class="msg msg-user">{e.body}</div>;
        case 'agent':
          return <div class="msg msg-agent">{e.body}</div>;
        case 'thinking':
          return (
            <div class="evt evt-thinking-block">
              <div class="tk-head">
                <span class="caret">▸</span>thinking
                <Show when={e.duration}><span class="duration">{e.duration}</span></Show>
              </div>
              <Show when={e.body}><div class="tk-body">{e.body}</div></Show>
            </div>
          );
        case 'tool':
          return (
            <div class={`evt evt-tool kind-${e.variant ?? 'run'}`}>
              <div class="evt-tool-head">
                <span class="caret">▸</span>
                <span class="tool-name">{e.name}</span>
                <span class="tool-arg">{e.arg}</span>
                <Show when={e.dur}><span class="tool-dur">{e.dur}</span></Show>
              </div>
              <Show when={e.result}>
                <div class={`evt-tool-body ${e.collapsed ? 'collapsed' : ''}`}>{e.result}</div>
              </Show>
            </div>
          );
      }
    })()}
  </Show>
);

const dotClass = (d: ProcInfo['dot']) => (d === 'hibernating' ? 'hibernating' : 'running');

export const ProgramShell: Component<ProgramShellProps> = (p) => {
  const [spawning, setSpawning] = createSignal(false);
  const [name, setName] = createSignal('');
  const treeW = () => p.treeW ?? 256;
  const [sidebarW, setSidebarW] = createSignal(232);

  /* the currently-attached process + its state. A hibernating process has no
     sandbox, hence no live conversation — the center shows a dormant panel
     instead of the chat stream + composer (the directory stays). */
  const activeProc = () => p.procs.find((x) => x.active) ?? p.procs[0];
  const dormant = () => activeProc()?.dot === 'hibernating';

  /* ── share (demo) ── current user is owner of the attached process, so the
     分享 button shows and the panel is editable. Mock member list. */
  const myRole = () => 'owner' as const;
  const [shareOpen, setShareOpen] = createSignal(false);
  const [members, setMembers] = createStore<Member[]>([
    { userId: 'ada',  name: 'Ada',  role: 'editor' },
    { userId: 'lin',  name: 'Lin',  role: 'viewer' },
  ]);
  const [shareName, setShareName] = createSignal('');
  const [shareRole, setShareRole] = createSignal<ShareRole>('editor');
  const addMember = () => {
    const n = shareName().trim();
    if (!n) return;
    setMembers(produce((m) => m.push({ userId: n.toLowerCase(), name: n, role: shareRole() })));
    setShareName('');
  };
  const removeMember = (userId: string) => setMembers(members.filter((x) => x.userId !== userId));
  const setMemberRole = (userId: string, role: ShareRole) => setMembers((x) => x.userId === userId, 'role', role);

  /* composer: Enter sends, Ctrl/Cmd+Enter (and Shift+Enter) inserts a newline */
  const [draft, setDraft] = createSignal('');
  const send = () => {
    const t = draft().trim();
    if (!t) return;
    p.onSend?.(draft());
    setDraft('');
  };
  const onComposerKey = (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart ?? draft().length;
      const en = ta.selectionEnd ?? s;
      const v = draft();
      setDraft(v.slice(0, s) + '\n' + v.slice(en));
      queueMicrotask(() => { ta.selectionStart = ta.selectionEnd = s + 1; });
    } else if (!e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /* drag the panel's left edge (the line between conversation and dir):
     window stays fixed; the conversation gives/takes space, so the divider
     follows the cursor */
  const onTreeResize = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeW();
    const move = (ev: PointerEvent) => {
      p.onResizeTreeW?.(Math.max(200, Math.min(560, startW - (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* drag the left sidebar's right edge to widen it */
  const onSidebarResize = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarW();
    const move = (ev: PointerEvent) => {
      setSidebarW(Math.max(200, Math.min(440, startW + (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* live directory sync: while attached (not hibernating), periodically re-read
     the dir tree + every open file from the sandbox. Manual sync buttons hit the
     same handlers. On-demand only (lazy) — we never pull regenerable bulk. */
  const syncAll = () => {
    if (dormant()) return;
    p.onSyncTree?.();
    for (const f of p.openFiles) p.onSyncFile?.(f);
  };
  onMount(() => {
    const t = setInterval(syncAll, 5000);
    onCleanup(() => clearInterval(t));
  });

  const submit = () => {
    const n = name().trim();
    if (!n) return;
    p.onSpawn?.(n);
    setName('');
    setSpawning(false);
  };
  const cancel = () => {
    setName('');
    setSpawning(false);
  };

  return (
    <>
      {/* ── LEFT: process list ── */}
      <aside class="win-sidebar" style={{ width: `${sidebarW()}px` }}>
        <div class="win-sidebar-header proc-head">
          <span class="label">进程</span>
          <span class="sb-head-right">
            <span class="count">{p.procs.length}</span>
            <button class="sb-add" title="新建进程" onClick={() => setSpawning(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <path d="M8 3.5 V12.5 M3.5 8 H12.5" />
              </svg>
            </button>
          </span>
        </div>
        <div class="sb-list">
          <For each={p.procs}>{(proc) => (
            <div
              class={`sb-row clickable ${proc.active ? 'active' : ''}`}
              onClick={() => p.onAttach?.(proc.pid)}
              title={proc.dot === 'hibernating' ? '休眠 · 未关联沙箱' : '运行中 · 已关联沙箱'}
            >
              <span class={`state-dot ${dotClass(proc.dot)}`} />
              <span class="meta-label">{proc.name}</span>
            </div>
          )}</For>
        </div>
        <div class="sb-resize" onPointerDown={onSidebarResize} />
      </aside>

      {/* ── CENTER: execution (tabs + active content) ── */}
      <div class="dz-main">
        {/* conversation header: attached proc + version + lifecycle + members + 分享 */}
        <div class="dz-toolbar">
          <span class="dzt-name">
            <span class={`state-dot ${dormant() ? 'hibernating' : 'attached'}`} />
            <span class="dzt-title">{activeProc()?.name ?? p.procTitle}</span>
            <Show when={activeProc()?.version}>
              <span class="dzt-ver">v{activeProc()!.version}</span>
            </Show>
          </span>
          <span class="dzt-right">
            <Show when={activeProc()}>
              <button
                class="dzt-life"
                title={dormant() ? '唤醒 · 关联沙箱' : '休眠 · 释放沙箱'}
                onClick={() => { const a = activeProc(); if (!a) return; dormant() ? p.onWake?.(a.pid) : p.onHibernate?.(a.pid); }}
              >
                <Show when={dormant()} fallback={<MoonIcon />}><PowerIcon /></Show>
                {dormant() ? '唤醒' : '休眠'}
              </button>
            </Show>
            <Show when={members.length > 0}>
              <span class="dzt-members" title={`${members.length} 位协作者`}>
                <For each={members.slice(0, 3)}>{(m) => (
                  <span class={`dzt-ava role-${m.role}`} title={`${m.name} · ${m.role === 'editor' ? '可写' : '只读'}`}>{m.name.slice(0, 1)}</span>
                )}</For>
                <Show when={members.length > 3}><span class="dzt-ava more">+{members.length - 3}</span></Show>
              </span>
            </Show>
            <Show when={myRole() === 'owner'}>
              <button class="dzt-share" title="分享" onClick={() => setShareOpen(true)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="3.5" r="2" /><circle cx="4" cy="8" r="2" /><circle cx="12" cy="12.5" r="2" />
                  <path d="M5.8 7 L10.2 4.5 M5.8 9 L10.2 11.5" />
                </svg>
                分享
              </button>
            </Show>
          </span>
        </div>
        <Show when={p.openFiles.length > 0}>
          <div class="dv-tabs">
            <div class={`dv-tab chat ${!p.viewFile ? 'active' : ''}`} onClick={() => p.onShowChat?.()}>
              <span class={`state-dot ${dormant() ? 'hibernating' : 'attached'}`} />
              <span class="dv-tab-name">对话</span>
            </div>
            <For each={p.openFiles}>{(f) => (
              <div class={`dv-tab ${p.viewFile === f ? 'active' : ''}`} title={f} onClick={() => p.onSelectView?.(f)}>
                <span class="dv-tab-name">{base(f)}</span>
                <button class="dv-tab-x" title="关闭" onClick={(e) => { e.stopPropagation(); p.onCloseView?.(f); }}>×</button>
              </div>
            )}</For>
          </div>
        </Show>

        <Show
          when={p.viewFile}
          fallback={
            <Show
              when={dormant()}
              fallback={
                <div class="dz-chat">
                  <div class="chat-stream dz-stream">
                    <Show
                      when={p.events.length > 0}
                      fallback={<div class="stream-empty">进程已创建. 在下方输入指令, {p.procTitle} 就会开始执行.</div>}
                    >
                      <For each={p.events}>{(e) => <EventView e={e} />}</For>
                    </Show>
                  </div>

                  <div class="composer">
                    <textarea
                      class="composer-input"
                      rows="1"
                      value={draft()}
                      onInput={(e) => setDraft(e.currentTarget.value)}
                      onKeyDown={onComposerKey}
                    />
                  </div>
                </div>
              }
            >
              {/* hibernating: no sandbox, no live conversation — only a wake action */}
              <div class="dz-dormant">
                <div class="dormant-card">
                  <div class="dormant-glyph"><MoonIcon /></div>
                  <div class="dormant-title">进程休眠中</div>
                  <div class="dormant-sub">未关联沙箱，当前没有运行中的对话。<br />唤醒后将分配沙箱，{p.procTitle} 可继续执行。</div>
                  <button
                    class="btn primary dormant-wake"
                    onClick={() => { const a = activeProc(); if (a) p.onWake?.(a.pid); }}
                  >
                    <PowerIcon /> 唤醒进程
                  </button>
                </div>
              </div>
            </Show>
          }
        >
          {(() => {
            const code = p.fileContent?.(p.viewFile!) ?? '';
            const lines = code.split('\n');
            return (
              <div class="dv-body">
                <div class="dv-bar">
                  <span class="dv-bar-path">{p.viewFile}</span>
                  <button class="dv-sync" title="同步文件" disabled={dormant()} onClick={() => p.onSyncFile?.(p.viewFile!)}>
                    <SyncIcon />
                  </button>
                </div>
                <div class="dv-codewrap">
                  <div class="dv-gutter">
                    <For each={lines}>{(_, i) => <span>{i() + 1}</span>}</For>
                  </div>
                  <pre class="dv-pre"><code class="hljs" innerHTML={highlightFile(p.viewFile!, code)} /></pre>
                </div>
              </div>
            );
          })()}
        </Show>
      </div>

      {/* ── RIGHT: directory column — added to the right of the conversation
           (the window widens to fit it); collapsed by default. Its left edge
           is a draggable resize line. ── */}
      <Show when={p.treeOpen}>
        <aside class="win-tree" style={{ width: `${treeW()}px` }}>
          <div class="tree-resize" onPointerDown={onTreeResize} />
          <div class="tree-head">
            <span class="tree-head-label">目录</span>
            <button class="tree-sync" title="同步目录" disabled={dormant()} onClick={() => p.onSyncTree?.()}>
              <SyncIcon />
            </button>
          </div>
          <div class="tree-list">
            <For each={p.tree}>{(n) => (
              <TreeNode node={n} path={n.name} activePath={p.viewFile} onOpen={(path) => p.onOpenFile?.(path)} />
            )}</For>
          </div>
        </aside>
      </Show>

      {/* ── spawn-process form (name only for now; cpu/mem later) ── */}
      <Show when={spawning()}>
        <div class="spawn-overlay" onClick={cancel}>
          <div class="spawn-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>新建进程</h3>
            <p class="spawn-hint">为这次 {p.procTitle} 执行起个名字. 每个进程是 ~/.aprog/ 下的一个独立目录.</p>
            <div class="spawn-field">
              <label>名称</label>
              <input
                class="spawn-input"
                ref={(el) => queueMicrotask(() => el.focus())}
                value={name()}
                placeholder="例如: acme · 官网重设计"
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') cancel();
                }}
              />
            </div>
            <div class="spawn-actions">
              <button class="btn" onClick={cancel}>取消</button>
              <button class="btn primary" onClick={submit} disabled={!name().trim()}>创建</button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── share / manage members (owner only) ── */}
      <Show when={shareOpen()}>
        <div class="spawn-overlay" onClick={() => setShareOpen(false)}>
          <div class="spawn-dialog share-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>分享「{activeProc()?.name ?? p.procTitle}」</h3>
            <p class="spawn-hint">被分享的人直接进入这个进程（无需接收），并在消息中心收到通知. 只有你（owner）能分享、改权限或移除.</p>

            <div class="share-add">
              <input
                class="spawn-input"
                value={shareName()}
                placeholder="用户名 / 邮箱"
                onInput={(e) => setShareName(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
              />
              <select class="share-rolesel" value={shareRole()} onChange={(e) => setShareRole(e.currentTarget.value as ShareRole)}>
                <option value="editor">可写</option>
                <option value="viewer">只读</option>
              </select>
              <button class="btn primary" onClick={addMember} disabled={!shareName().trim()}>分享</button>
            </div>

            <div class="share-list">
              <div class="share-row owner">
                <span class="share-ava role-owner">我</span>
                <span class="share-who"><span class="share-name">{auth.user()?.displayName ?? '我'}</span><span class="share-sub">owner · 创建者</span></span>
                <span class="share-roletag">owner</span>
              </div>
              <For each={members}>{(m) => (
                <div class="share-row">
                  <span class={`share-ava role-${m.role}`}>{m.name.slice(0, 1)}</span>
                  <span class="share-who"><span class="share-name">{m.name}</span><span class="share-sub">{m.userId}</span></span>
                  <select class="share-rolesel sm" value={m.role} onChange={(e) => setMemberRole(m.userId, e.currentTarget.value as ShareRole)}>
                    <option value="editor">可写</option>
                    <option value="viewer">只读</option>
                  </select>
                  <button class="share-remove" title="移除" onClick={() => removeMember(m.userId)}>✕</button>
                </div>
              )}</For>
            </div>

            <div class="spawn-actions">
              <button class="btn primary" onClick={() => setShareOpen(false)}>完成</button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};
