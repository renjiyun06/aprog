import { For, createSignal, onMount, type Component } from 'solid-js';
import { Glyph } from '../icons';
import { catalog, loadCatalog, type CatalogItem } from '../stores/catalog';
import { isInstalled, install, uninstall } from '../stores/installed';

/* 程序商店 — 浏览并安装「智能程序」。左侧分类目录，右侧卡片列表。
   · 目录来自控制平面（GET /programs）；安装状态走 /installations（见 stores/catalog、stores/installed）。
   · 只展示智能程序；系统应用（商店/设置）不是智能程序，不在此列出。
   · 安装即把程序放到桌面；任务栏只在程序打开后显示其运行项。卸载只从桌面移除，进程与数据保留。 */

const CATEGORY_ORDER = ['规划与设计', '开发与质量', '文档'];

/** 有内容的分类，按既定顺序；顺序外的分类追加在后（前向兼容）。 */
function categories(list: CatalogItem[]): string[] {
  const present = CATEGORY_ORDER.filter((c) => list.some((p) => p.category === c));
  const extra = [...new Set(list.map((p) => p.category))].filter((c) => !CATEGORY_ORDER.includes(c));
  return [...present, ...extra];
}
const inCategory = (list: CatalogItem[], cat: string): CatalogItem[] => list.filter((p) => p.category === cat);

const Card: Component<{ p: CatalogItem }> = (props) => {
  const p = props.p;
  const G = Glyph[p.glyph];
  const installed = () => isInstalled(p.id);
  return (
    <div class="store-card">
      <div class="store-card-top">
        <div class={`store-icon ${p.tileClass}`}><G /></div>
        <div class="store-card-body">
          <div class="store-card-title">{p.label}</div>
          {p.version && <div class="store-ver">v{p.version}</div>}
        </div>
      </div>
      <p class="store-card-desc">{p.summary}</p>
      <div class="store-card-foot">
        <button
          type="button"
          class={`store-btn ${installed() ? 'remove' : 'add'}`}
          onClick={() => { void (installed() ? uninstall(p.id) : install(p.id)); }}
        >{installed() ? '卸载' : '安装'}</button>
      </div>
    </div>
  );
};

export const Store: Component = () => {
  onMount(() => { void loadCatalog(); });
  const [sel, setSel] = createSignal<string>('all');
  const cats = () => categories(catalog());
  const shown = () => (sel() === 'all' ? cats() : [sel()]);
  return (
    <div class="store">
      <aside class="store-nav">
        <div class="store-nav-cap">分类</div>
        <button type="button" classList={{ 'store-nav-item': true, on: sel() === 'all' }} onClick={() => setSel('all')}>
          <span>全部</span><span class="store-nav-n">{catalog().length}</span>
        </button>
        <For each={cats()}>{(c) => (
          <button type="button" classList={{ 'store-nav-item': true, on: sel() === c }} onClick={() => setSel(c)}>
            <span>{c}</span><span class="store-nav-n">{inCategory(catalog(), c).length}</span>
          </button>
        )}</For>
      </aside>

      <div class="store-main">
        <div class="store-head">
          <h1>发现智能程序</h1>
        </div>
        <For each={shown()}>{(c) => (
          <section class="store-section">
            <div class="store-section-head">{c}<span class="store-section-n">{inCategory(catalog(), c).length}</span></div>
            <div class="store-grid">
              <For each={inCategory(catalog(), c)}>{(p) => <Card p={p} />}</For>
            </div>
          </section>
        )}</For>
      </div>
    </div>
  );
};
