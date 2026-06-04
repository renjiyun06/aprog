import { For, Show, type Component } from 'solid-js';
import { SYSTEM_APPS } from '../programs/registry';
import { installedPrograms } from '../stores/installed';
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

  return (
    <footer class="taskbar">
      <div class="tb-main">

        <For each={installedPrograms()}>{(p) => {
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

        <Show when={SYSTEM_APPS.some(p => p.pinned)}>
          <div class="tb-divider" />
          <For each={SYSTEM_APPS.filter(p => p.pinned)}>{(p) => {
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
        </Show>
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
