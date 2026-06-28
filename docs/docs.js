/* aprog docs — shared sidebar + in-page TOC + pager.
   The nav tree is the single source of truth for site structure; every page
   is just a content skeleton that loads this script. */
(function () {
  'use strict';

  // ── site structure ───────────────────────────────────────────────
  // page = the html file (also the body[data-page] key). anchors are the
  // <h2> ids on that page; they render as sub-links only for the active page.
  const NAV = [
    {
      group: '设计文档',
      items: [
        { page: 'overview',        label: '01 · 总览' },
        { page: 'program-package', label: '02 · 程序与发版' },
        { page: 'images',          label: '03 · 镜像与沙箱' },
        { page: 'protocol',        label: '04 · 通道与协议' },
        { page: 'proc-wake',       label: '05 · 运行生命周期' },
        { page: 'state',           label: '06 · 状态契约' },
      ],
    },
  ];

  // flat order for prev/next
  const FLAT = NAV.flatMap((g) => g.items);

  const current = document.body.getAttribute('data-page') ||
    (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';

  // ── sidebar ───────────────────────────────────────────────────────
  function buildSidebar() {
    const aside = document.getElementById('sidebar');
    if (!aside) return;
    let html = '';
    for (const g of NAV) {
      html += '<div class="sb-group"><div class="sb-group-title">' + g.group + '</div>';
      for (const it of g.items) {
        const active = it.page === current;
        html += '<a class="sb-link' + (active ? ' active' : '') + '" href="' + it.page + '.html">' + it.label + '</a>';
        // 本页小节优先由右栏「本页目录」(.toc) 承担；当右栏目录不存在或被响应式隐藏(窄屏)时，回退到左栏注入小节。
        var tocEl = document.querySelector('.toc');
        var tocShown = tocEl && getComputedStyle(tocEl).display !== 'none';
        if (active && !tocShown) {
          const subs = [].slice.call(document.querySelectorAll('article h2[id]'));
          if (subs.length) {
            html += '<div class="sb-sub">';
            for (const h of subs) {
              html += '<a class="sb-sublink" href="#' + h.id + '" data-spy="' + h.id + '">' + (h.getAttribute('data-nav') || h.textContent.replace(/#$/, '').trim()) + '</a>';
            }
            html += '</div>';
          }
        }
      }
      html += '</div>';
    }
    aside.innerHTML = html;
  }

  // ── on-this-page TOC (right rail) ─────────────────────────────────
  function buildToc() {
    const toc = document.querySelector('.toc');
    if (!toc) return;
    const heads = [].slice.call(document.querySelectorAll('article h2[id], article h3[id]'));
    if (!heads.length) { toc.remove(); return; }
    let html = '<div class="toc-title">本页</div>';
    for (const h of heads) {
      const lvl = h.tagName === 'H3' ? ' lvl-3' : '';
      const label = (h.getAttribute('data-nav') || h.textContent.replace(/#$/, '').trim());
      html += '<a class="' + lvl.trim() + '" href="#' + h.id + '" data-spy="' + h.id + '">' + label + '</a>';
    }
    toc.innerHTML = html;
  }

  // ── heading anchor links ──────────────────────────────────────────
  function addAnchors() {
    [].slice.call(document.querySelectorAll('article h2[id], article h3[id]')).forEach(function (h) {
      const a = document.createElement('a');
      a.className = 'anchor'; a.href = '#' + h.id; a.textContent = '#';
      h.appendChild(a);
    });
  }

  // ── scroll spy ────────────────────────────────────────────────────
  function spy() {
    const heads = [].slice.call(document.querySelectorAll('article h2[id], article h3[id]'));
    if (!heads.length) return;
    const links = [].slice.call(document.querySelectorAll('[data-spy]'));
    const byId = {};
    links.forEach((l) => { (byId[l.getAttribute('data-spy')] = byId[l.getAttribute('data-spy')] || []).push(l); });
    let ticking = false;
    function update() {
      ticking = false;
      const top = 90;
      let activeId = heads[0].id;
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= top) activeId = h.id; else break;
      }
      // 边界:最后一节太短时,它的 top 永远到不了阈值——滚到页面底部就强制选中末项。
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        activeId = heads[heads.length - 1].id;
      }
      links.forEach((l) => l.classList.remove('active'));
      (byId[activeId] || []).forEach((l) => l.classList.add('active'));
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  // ── prev / next pager ─────────────────────────────────────────────
  function buildPager() {
    const host = document.querySelector('[data-pager]');
    if (!host) return;
    const idx = FLAT.findIndex((i) => i.page === current);
    const prev = idx > 0 ? FLAT[idx - 1] : null;
    const next = idx >= 0 && idx < FLAT.length - 1 ? FLAT[idx + 1] : null;
    let html = '';
    html += prev ? '<a href="' + prev.page + '.html"><div class="dir">← 上一页</div><div class="ttl">' + prev.label + '</div></a>' : '<span style="flex:1"></span>';
    html += next ? '<a class="next" href="' + next.page + '.html"><div class="dir">下一页 →</div><div class="ttl">' + next.label + '</div></a>' : '<span style="flex:1"></span>';
    host.innerHTML = html;
  }

  // ── mobile nav toggle ─────────────────────────────────────────────
  function wireToggle() {
    const btn = document.querySelector('.nav-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar') && !e.target.closest('.nav-toggle')) {
        document.body.classList.remove('nav-open');
      }
    });
  }

  // ── ⌘K focuses search (filter is a later iteration) ───────────────
  function wireSearch() {
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const s = document.querySelector('.search');
        if (s) { e.preventDefault(); s.focus(); }
      }
    });
  }

  addAnchors();
  buildSidebar();
  buildToc();
  buildPager();
  spy();
  wireToggle();
  wireSearch();
})();
