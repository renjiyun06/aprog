import { For, type Component } from 'solid-js';
import { PROGRAMS } from './registry';
import { Glyph } from '../icons';
import { isInstalled, installProgram, uninstallProgram } from '../stores/installed';

/* 程序商店 — browse the catalog and install/uninstall programs.
   Installing adds a program to the desktop + taskbar; uninstalling removes it
   from view but keeps its processes & data (reinstall restores them). */
export const Store: Component = () => (
  <div class="store">
    <div class="store-head">
      <h1>程序商店</h1>
      <p>安装程序即添加到桌面与任务栏。卸载只是从桌面移除——进程与数据都会保留，重新安装即可恢复。</p>
    </div>
    <div class="store-grid">
      <For each={PROGRAMS}>{(p) => {
        const G = Glyph[p.glyph];
        const installed = () => isInstalled(p.id);
        return (
          <div class="store-card">
            <div class={`store-icon ${p.tileClass}`}><G /></div>
            <div class="store-card-body">
              <div class="store-card-title">
                {p.label}
                {p.version && <span class="store-ver">v{p.version}</span>}
              </div>
              <p class="store-card-desc">{p.description}</p>
            </div>
            <button
              class={`store-btn ${installed() ? 'remove' : 'add'}`}
              onClick={() => (installed() ? uninstallProgram(p.id) : installProgram(p.id))}
            >{installed() ? '卸载' : '安装'}</button>
          </div>
        );
      }}</For>
    </div>
  </div>
);
