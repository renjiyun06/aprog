import type { Component, JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { windowsStore, focusWindow, closeWindow, minimizeWindow, toggleMaximize, moveWindow, resizeWindow, toggleWindowTree, setWindowTreeW, type WindowState } from '../stores/windows';
import { findProgram } from '../programs/registry';
import { Glyph, ChromeMin, ChromeMax, ChromeClose } from '../icons';

interface Props {
  w: WindowState;
  children: JSX.Element;
}

/** Generic Win11 window chrome wrapper.
 *  - Drag from title bar to move (transforms; no reflow).
 *  - Click chrome → focus.
 *  - Min / Max / Close buttons.
 *  - Tab strip + custom toolbar can be slotted in via `children` if needed —
 *    for now `children` is the body content.
 */
export const Window: Component<Props> = (p) => {
  const prog = findProgram(p.w.programId);
  let titleBarEl!: HTMLDivElement;

  // drag-to-move via pointer events (GPU transform, no layout reflow)
  const onPointerDown = (e: PointerEvent) => {
    if (p.w.maximized) return;
    if ((e.target as HTMLElement).closest('.wc, .win-tabs .wt, .win-tabs .x, .win-tabs .wt-new')) return;
    e.preventDefault();
    focusWindow(p.w.id);
    const startX = e.clientX, startY = e.clientY;
    const origX = p.w.x, origY = p.w.y;
    titleBarEl.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      moveWindow(p.w.id, origX + (ev.clientX - startX), origY + (ev.clientY - startY));
    };
    const onUp = (ev: PointerEvent) => {
      titleBarEl.releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Window style — maximized covers viewport minus taskbar
  const winStyle = (): JSX.CSSProperties => p.w.maximized
    ? { left: '0', top: '0', right: '0', bottom: '0', 'border-radius': '0', 'z-index': p.w.z }
    : { left: `${p.w.x}px`, top: `${p.w.y}px`, width: `${p.w.w}px`, height: `${p.w.h}px`, 'z-index': p.w.z };

  // resize-from-edge/corner — direction is any combination of n/s/e/w
  const MIN_W = 480, MIN_H = 320;
  const startResize = (dir: string) => (e: PointerEvent) => {
    if (p.w.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    focusWindow(p.w.id);
    const sx = e.clientX, sy = e.clientY;
    const ox = p.w.x, oy = p.w.y, ow = p.w.w, oh = p.w.h;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nx = ox, ny = oy, nw = ow, nh = oh;
      if (dir.includes('e')) nw = Math.max(MIN_W, ow + dx);
      if (dir.includes('s')) nh = Math.max(MIN_H, oh + dy);
      if (dir.includes('w')) { nw = Math.max(MIN_W, ow - dx); nx = ox + (ow - nw); }
      if (dir.includes('n')) { nh = Math.max(MIN_H, oh - dy); ny = oy + (oh - nh); }
      resizeWindow(p.w.id, nx, ny, nw, nh);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const GlyphCmp = prog ? Glyph[prog.glyph] : null;
  const [info, setInfo] = createSignal(false);

  return (
    <section
      class="window"
      style={winStyle()}
      onPointerDown={() => focusWindow(p.w.id)}
    >
      <header
        class="win-titlebar draggable"
        ref={titleBarEl}
        onPointerDown={onPointerDown}
        onDblClick={() => toggleMaximize(p.w.id)}
      >
        {prog && (
          <div class={`icon-tile ${prog.tileClass}`}>
            {GlyphCmp && <GlyphCmp />}
          </div>
        )}
        <div class="title-text">
          {p.w.title}
          {p.w.pid && <span class="sub">— PID {p.w.pid}</span>}
        </div>
        <div class="win-controls">
          {prog?.description && (
            <button
              class={`wc info ${info() ? 'on' : ''}`}
              title="程序说明"
              onClick={(e) => { e.stopPropagation(); setInfo((v) => !v); }}
            >?</button>
          )}
          {prog?.hasDir && (
            <button
              class={`wc tree-tb ${p.w.treeOpen ? 'on' : ''}`}
              title={p.w.treeOpen ? '收起目录' : '展开目录'}
              onClick={(e) => { e.stopPropagation(); toggleWindowTree(p.w.id); }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                <rect x="2" y="3" width="12" height="10" rx="1.6" />
                <line x1="10" y1="3" x2="10" y2="13" />
              </svg>
            </button>
          )}
          <button class="wc minimize" title="最小化" onClick={() => minimizeWindow(p.w.id)}><ChromeMin /></button>
          <button class="wc maximize" title={p.w.maximized ? '还原' : '最大化'} onClick={() => toggleMaximize(p.w.id)}><ChromeMax /></button>
          <button class="wc close" title="关闭" onClick={() => closeWindow(p.w.id)}><ChromeClose /></button>
        </div>
      </header>
      <Show when={info() && prog}>
        <div class="prog-info" onPointerDown={(e) => e.stopPropagation()}>
          <div class="pi-bar">
            <span class="pi-bar-title">程序信息</span>
            <button class="pi-close" title="关闭" onClick={() => setInfo(false)}>✕</button>
          </div>
          <div class="pi-body">
            <nav class="pi-nav">
              <button class="pi-nav-item active">基本信息</button>
              {/* more categories (能力 / 版本历史 / 依赖 …) will go here later */}
            </nav>
            <div class="pi-main">
              <div class="pi-hero">
                {GlyphCmp && <div class={`pi-icon ${prog!.tileClass}`}><GlyphCmp /></div>}
                <div class="pi-hero-text">
                  <h2 class="pi-name">{prog!.label}</h2>
                  {prog!.version && <span class="pi-ver">v{prog!.version}</span>}
                </div>
              </div>
              <div class="pi-fields">
                <div class="pi-field"><div class="pi-k">名称</div><div class="pi-v">{prog!.label}</div></div>
                <div class="pi-field"><div class="pi-k">版本号</div><div class="pi-v mono">v{prog!.version}</div></div>
                <div class="pi-field"><div class="pi-k">描述</div><div class="pi-v">{prog!.description}</div></div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <div class="window-body">
        {p.children}
      </div>

      {!p.w.maximized && (
        <>
          <div class="rz rz-n"  onPointerDown={startResize('n')} />
          <div class="rz rz-s"  onPointerDown={startResize('s')} />
          <div class="rz rz-e"  onPointerDown={startResize('e')} />
          <div class="rz rz-w"  onPointerDown={startResize('w')} />
          <div class="rz rz-ne" onPointerDown={startResize('ne')} />
          <div class="rz rz-nw" onPointerDown={startResize('nw')} />
          <div class="rz rz-se" onPointerDown={startResize('se')} />
          <div class="rz rz-sw" onPointerDown={startResize('sw')} />
        </>
      )}
    </section>
  );
};

/** Renders every non-minimized window from the store. */
export const WindowLayer: Component = () => (
  <For each={windowsStore.windows.filter(w => !w.minimized)}>{(w) => {
    const prog = findProgram(w.programId);
    if (!prog) return null;
    const Body = prog.component;
    return (
      <Window w={w}>
        <Body pid={w.pid} treeOpen={w.treeOpen} treeW={w.treeW} onResizeTreeW={(nw: number) => setWindowTreeW(w.id, nw)} />
      </Window>
    );
  }}</For>
);
