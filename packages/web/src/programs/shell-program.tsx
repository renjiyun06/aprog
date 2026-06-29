import { createSignal, createMemo, createEffect, onMount, type Component } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ProgramShell, type ProcInfo, type FsNode } from '../components/ProgramShell';
import {
  processesFor,
  loadProcesses,
  spawnProcess,
  wakeProcess,
  hibernateProcess,
  type ProcessRecord,
} from '../stores/processes';
import { sessionEvents, attachSession, sendInput, isAwaitingReply } from '../stores/session';

export type ProgramProps = {
  pid?: number;
  treeOpen?: boolean;
  treeW?: number;
  onResizeTreeW?: (nw: number) => void;
};

/* 会话事件已接后端（stores/session：SSE 事件流 + POST 输入）；打开的文件还没有后端（待接入沙箱），
   先按 pid 存一份本地文件视图态。进程列表与生命周期（spawn/wake/hibernate、dot 状态）走 stores/processes。 */
interface View {
  openFiles: string[];
  viewFile: string | null;
}
const emptyView = (): View => ({ openFiles: [], viewFile: null });

/* 沙箱未接入：进程目录只给一个占位结构，内容读取也只回占位文案。 */
const PLACEHOLDER_TREE: FsNode[] = [
  { name: 'meta.yml', kind: 'file' },
  { name: 'input.md', kind: 'file' },
  { name: 'session.aprog.jsonl', kind: 'file' },
];

const dotOf = (s: ProcessRecord['state']): ProcInfo['dot'] =>
  s === 'running' ? 'running' : s === 'waking' ? 'waking' : 'hibernating';

/* ──────────────────────────────────────────────────────────────────────
   每个 aprog 智能程序都是同一套 ProgramShell；区别只是 programId + 标题。
   进程从控制平面按 programId 拉取并驱动；一个新程序就是一行 makeProgram。
   ──────────────────────────────────────────────────────────────────── */
export function makeProgram(programId: string, procTitle: string): Component<ProgramProps> {
  return (props) => {
    onMount(() => { void loadProcesses(); });

    const mine = createMemo(() => processesFor(programId));
    const [activeId, setActiveId] = createSignal<number | null>(null);
    const active = createMemo<ProcessRecord | undefined>(() => {
      const list = mine();
      return list.find((p) => p.pid === activeId()) ?? list[0];
    });

    const shownProcs = createMemo<ProcInfo[]>(() =>
      mine().map((p) => ({
        pid: p.pid,
        name: p.name ?? procTitle,
        version: p.programVersion ?? undefined,
        dot: dotOf(p.state),
        fresh: p.state === 'spawned',
        active: p.pid === active()?.pid,
      })),
    );

    const [views, setViews] = createStore<Record<number, View>>({});
    const viewOf = (pid: number): View => views[pid] ?? emptyView();
    const patchView = (pid: number, patch: Partial<View>): void =>
      setViews(pid, (v) => ({ ...(v ?? emptyView()), ...patch }));
    const av = (): View => { const a = active(); return a ? viewOf(a.pid) : emptyView(); };

    /* 会话事件来自后端事件流（stores/session）。活动进程一旦 running 就开流（attach 幂等）。 */
    const events = createMemo(() => { const a = active(); return a ? sessionEvents(a.pid) : []; });
    const awaitingReply = createMemo(() => { const a = active(); return a ? isAwaitingReply(a.pid) : false; });
    createEffect(() => { const a = active(); if (a && a.state === 'running') attachSession(a.pid); });

    /* 生命周期 → 后端（stores/processes）。 */
    const onSpawn = async (name: string): Promise<boolean> => {
      const rec = await spawnProcess(programId, name);
      if (rec) {
        setActiveId(rec.pid);
        return true;
      }
      return false;
    };
    const onHibernate = (pid: number): void => { void hibernateProcess(pid); };
    const onWake = (pid: number): void => { void wakeProcess(pid); };
    const onAttach = (pid: number): void => { setActiveId(pid); };

    /* 输入 → 后端（POST /proc/:pid/input）。用户回显经事件流回吐，不本地塞。 */
    const onSend = (text: string): void => {
      const a = active(); if (!a) return;
      void sendInput(a.pid, text);
    };
    const openFile = (path: string): void => {
      const a = active(); if (!a) return;
      const v = viewOf(a.pid);
      patchView(a.pid, { openFiles: v.openFiles.includes(path) ? v.openFiles : [...v.openFiles, path], viewFile: path });
    };
    const showChat = (): void => { const a = active(); if (a) patchView(a.pid, { viewFile: null }); };
    const selectView = (path: string): void => { const a = active(); if (a) patchView(a.pid, { viewFile: path }); };
    const closeView = (path: string): void => {
      const a = active(); if (!a) return;
      const v = viewOf(a.pid);
      const idx = v.openFiles.indexOf(path);
      const openFiles = v.openFiles.filter((f) => f !== path);
      let viewFile = v.viewFile;
      if (viewFile === path) viewFile = openFiles.length ? openFiles[Math.max(0, idx - 1)]! : null;
      patchView(a.pid, { openFiles, viewFile });
    };

    return (
      <ProgramShell
        procTitle={procTitle}
        procs={shownProcs()}
        procDir={active() ? `~/.aprog/${active()!.pid}` : '~/.aprog'}
        events={events()}
        awaitingReply={awaitingReply()}
        onSend={onSend}
        tree={active() ? PLACEHOLDER_TREE : []}
        onOpenFile={openFile}
        onSyncTree={() => {/* 待接入沙箱：从 provider fs 重读目录树 */}}
        onSyncFile={() => {/* 待接入沙箱：重读文件内容 */}}
        openFiles={av().openFiles}
        viewFile={av().viewFile}
        onShowChat={showChat}
        onSelectView={selectView}
        onCloseView={closeView}
        fileContent={(path) => `（沙箱未接入：${path} 暂无内容）`}
        onAttach={onAttach}
        onSpawn={onSpawn}
        onHibernate={onHibernate}
        onWake={onWake}
        treeOpen={props.treeOpen}
        treeW={props.treeW}
        onResizeTreeW={props.onResizeTreeW}
      />
    );
  };
}
