import { For, type Component } from 'solid-js';
import { findProgram, type ProgramDef } from '../programs/registry';
import { openWindow, openProgramIds, windowsStore } from '../stores/windows';
import { useClock } from '../stores/system';
import { Glyph } from '../icons';
import { UserFlyout } from './UserFlyout';
import { NotifyFlyout } from './NotifyFlyout';

export const Taskbar: Component = () => {
  const { time, date } = useClock();
  const focusedProgramId = () => {
    const f = windowsStore.focusedId;
    if (!f) return null;
    return windowsStore.windows.find(w => w.id === f)?.programId ?? null;
  };

  const isFocused  = (pid: string) => focusedProgramId() === pid;
  const isRunning  = (pid: string) => openProgramIds().has(pid) && !isFocused(pid);

  // 任务栏只显示「已打开」的程序：按窗口顺序去重取程序定义（响应式：读 windows）。
  const openPrograms = (): ProgramDef[] => {
    const seen = new Set<string>();
    const out: ProgramDef[] = [];
    for (const w of windowsStore.windows) {
      if (seen.has(w.programId)) continue;
      seen.add(w.programId);
      const p = findProgram(w.programId);
      if (p) out.push(p);
    }
    return out;
  };

  return (
    <footer class="taskbar">
      <div class="tb-main">
        <For each={openPrograms()}>{(p) => {
          const GlyphCmp = Glyph[p.glyph];
          return (
            <button
              class={`tb-app ${isFocused(p.id) ? 'is-focused' : isRunning(p.id) ? 'is-running' : ''}`}
              title={p.label}
              onClick={() => openWindow(p.id, { title: p.label })}
            >
              <div class={`tile ${p.tileClass}`}><GlyphCmp /></div>
              <span class="indicator" />
              <span class="tip">{p.label}</span>
            </button>
          );
        }}</For>
      </div>

      <div class="tb-tray">
        <UserFlyout />
        <div class="tb-clock" title="">
          <span class="time">{time()}</span>
          <span class="date">{date()}</span>
        </div>
        {/* notification center sits at the FAR right edge (Win10 Action Center) */}
        <NotifyFlyout />
      </div>
    </footer>
  );
};
