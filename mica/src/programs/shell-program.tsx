import { createSignal, createMemo, type Component } from 'solid-js';
import { ProgramShell, type ProcInfo, type SessionEvent, type FsNode } from '../components/ProgramShell';

/* A process within a program: directory tree + conversation + viewer state. */
export interface ProcState extends ProcInfo {
  dir: string;
  tree: FsNode[];
  events: SessionEvent[];
  openFiles: string[];
  viewFile: string | null;
  contents: Record<string, string>;
}

export type ProgramProps = {
  pid?: number;
  treeOpen?: boolean;
  treeW?: number;
  onResizeTreeW?: (nw: number) => void;
};

/* ──────────────────────────────────────────────────────────────────────
   Every aprog 智能程序 is the same shell over different mock data. This
   factory wires the per-process state machine (attach / spawn / open files
   / send) around ProgramShell, so a new program is just a title + seed.
   ──────────────────────────────────────────────────────────────────── */
export function makeProgram(procTitle: string, seed: ProcState[], pidStart = 5000): Component<ProgramProps> {
  return (props) => {
    const [procs, setProcs] = createSignal<ProcState[]>(seed);
    const [activeId, setActiveId] = createSignal(seed[0]?.pid ?? 0);
    let pidSeq = pidStart;

    const active = createMemo(() => procs().find((p) => p.pid === activeId()) ?? procs()[0]);

    const shownProcs = createMemo<ProcInfo[]>(() =>
      procs().map((p) => ({ pid: p.pid, name: p.name, dot: p.dot, active: p.pid === activeId() })),
    );

    const patchActive = (patch: Partial<ProcState>) =>
      setProcs((list) => list.map((p) => (p.pid === activeId() ? { ...p, ...patch } : p)));

    const attach = (pid: number) => setActiveId(pid);

    const send = (text: string) => {
      const cur = active();
      if (cur) patchActive({ events: [...cur.events, { kind: 'user', body: text }] });
    };

    const spawn = (name: string) => {
      const pid = ++pidSeq;
      const fresh: ProcState = {
        pid, name, dot: 'running', dir: `~/.aprog/${pid}`,
        tree: [{ name: 'meta.yml', kind: 'file' }, { name: 'input.md', kind: 'file' }],
        events: [], openFiles: [], viewFile: null,
        contents: { 'meta.yml': `id: "${pid}"\nstatus: running\nphase: discovery`, 'input.md': '' },
      };
      setProcs((list) => [fresh, ...list]);
      setActiveId(pid);
    };

    const openFile = (path: string) => {
      const cur = active();
      if (!cur) return;
      const openFiles = cur.openFiles.includes(path) ? cur.openFiles : [...cur.openFiles, path];
      patchActive({ openFiles, viewFile: path });
    };
    const showChat = () => patchActive({ viewFile: null });
    const selectView = (path: string) => patchActive({ viewFile: path });
    const closeView = (path: string) => {
      const cur = active();
      if (!cur) return;
      const idx = cur.openFiles.indexOf(path);
      const openFiles = cur.openFiles.filter((f) => f !== path);
      let viewFile = cur.viewFile;
      if (viewFile === path) viewFile = openFiles.length ? openFiles[Math.max(0, idx - 1)] : null;
      patchActive({ openFiles, viewFile });
    };

    return (
      <ProgramShell
        procTitle={procTitle}
        procs={shownProcs()}
        procDir={active()?.dir ?? '~/.aprog'}
        events={active()?.events ?? []}
        onSend={send}
        tree={active()?.tree ?? []}
        onOpenFile={openFile}
        openFiles={active()?.openFiles ?? []}
        viewFile={active()?.viewFile}
        onShowChat={showChat}
        onSelectView={selectView}
        onCloseView={closeView}
        fileContent={(path) => active()?.contents[path] ?? ''}
        onAttach={attach}
        onSpawn={spawn}
        treeOpen={props.treeOpen}
        treeW={props.treeW}
        onResizeTreeW={props.onResizeTreeW}
      />
    );
  };
}

/* small seed helpers to keep mock data terse */
export const baseTree = (extra: FsNode[] = []): FsNode[] => [
  { name: 'meta.yml', kind: 'file' },
  { name: 'input.md', kind: 'file' },
  { name: 'session.jsonl', kind: 'file' },
  ...extra,
];
