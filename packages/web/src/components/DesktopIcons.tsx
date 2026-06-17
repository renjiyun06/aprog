import { For, type Component } from 'solid-js';
import { openWindow } from '../stores/windows';
import { installedPrograms } from '../stores/installed';
import { findProgram, type ProgramDef } from '../programs/registry';
import { Glyph } from '../icons';

/** 桌面图标 — 已安装的智能程序 + 常驻系统入口「程序商店」。
 *  安装即放桌面（状态来自后端）；商店是前端 chrome、始终在桌面、不可卸载。 */
export const DesktopIcons: Component = () => {
  const items = (): ProgramDef[] => {
    const store = findProgram('store');
    return store ? [...installedPrograms(), store] : installedPrograms();
  };
  return (
    <div class="dt-icons">
      <For each={items()}>{(p) => {
        const G = Glyph[p.glyph];
        return (
          <button class="dt-icon" title={p.label} onDblClick={() => openWindow(p.id, { title: p.label })}>
            <div class={`dt-icon-art ${p.tileClass}`}>
              <G size={30} stroke-width={1.6} />
            </div>
            <div class="dt-icon-label">{p.label}</div>
          </button>
        );
      }}</For>
    </div>
  );
};
