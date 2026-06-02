import { For, type Component } from 'solid-js';
import { PROGRAMS } from '../programs/registry';
import { openWindow } from '../stores/windows';
import { Glyph } from '../icons';

/** Desktop shortcuts — only programs flagged desktop:true. */
export const DesktopIcons: Component = () => {
  const items = PROGRAMS.filter((p) => p.desktop);
  return (
    <div class="dt-icons">
      <For each={items}>{(p) => {
        const G = Glyph[p.glyph];
        return (
          <button class="dt-icon" title={p.label} onDblClick={() => openWindow(p.id)}>
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
