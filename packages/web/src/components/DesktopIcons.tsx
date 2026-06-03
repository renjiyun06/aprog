import { For, type Component } from 'solid-js';
import { openWindow } from '../stores/windows';
import { installedPrograms } from '../stores/installed';
import { Glyph } from '../icons';

/** Desktop shortcuts — the programs the user has installed. */
export const DesktopIcons: Component = () => {
  return (
    <div class="dt-icons">
      <For each={installedPrograms()}>{(p) => {
        const G = Glyph[p.glyph];
        return (
          <button class="dt-icon" title={p.label} onDblClick={() => openWindow(p.id, { title: p.label })}>
            <div class={`dt-icon-art ${p.tileClass}`}>
              <G width={30} height={30} stroke-width="1.4" />
            </div>
            <div class="dt-icon-label">{p.label}</div>
          </button>
        );
      }}</For>
    </div>
  );
};
