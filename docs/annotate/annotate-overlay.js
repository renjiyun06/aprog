/* annotate-overlay.js — injected by annotate-server into every docs page.
   Closely mirrors live-annotate's preview-overlay mechanism, adapted for a
   standalone docs site:
     · an Annotate-mode toggle (fab, bottom-right)
     · in mode: hover ANY element → dashed hover-box at its rect + a floating
       selector chip with ↑parent / ↓child DOM-walk (also arrow keys)
     · a 💬N badge on elements that already have comments
     · click any element → integrated modal: existing comments (with delete) +
       a box to add another
     · Ctrl+` hides the whole overlay chrome (state persists)
   The "slightly different" part: comments persist immediately to our flat
   server store (docs/.comments/, git-ignored) — there is no draft/commit/inbox
   stage, since the agent reads the store directly while we discuss the docs. */
(function () {
  'use strict';
  if (window.__aprogAnnotate) return;
  window.__aprogAnnotate = true;
  if (window.self !== window.top) return; // not inside iframes

  var MODE_KEY = 'aprog-annot-mode';
  var HIDDEN_KEY = 'aprog-annot-hidden';
  var PAGE = location.pathname.replace(/\/$/, '/index.html');
  if (PAGE === '/') PAGE = '/index.html';
  var author = localStorage.getItem('aprog-annot-author') || '';

  var getMode = function () { return sessionStorage.getItem(MODE_KEY) || 'off'; };
  var setMode = function (m) { sessionStorage.setItem(MODE_KEY, m); refreshUI(); };

  // ── selector path (stable; stops at first #id) ──
  function selectorPath(el) {
    if (!el || el.nodeType !== 1) return '';
    var path = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.id) { path.unshift('#' + CSS.escape(el.id)); break; }
      var s = el.tagName.toLowerCase();
      var par = el.parentElement;
      if (par) {
        var sibs = Array.prototype.filter.call(par.children, function (c) { return c.tagName === el.tagName; });
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
      path.unshift(s);
      el = el.parentElement;
    }
    return path.join(' > ');
  }
  function quoteFor(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }
  function tdate(iso) { var m = /T(\d{2}):(\d{2})/.exec(iso || ''); var d = /(\d{2})-(\d{2})T/.exec(iso || ''); return (d ? d[1] + '/' + d[2] + ' ' : '') + (m ? m[1] + ':' + m[2] : ''); }

  // ── styles ──
  var css = [
    '.az-root{position:fixed;z-index:2147483647;font:13px/1.45 -apple-system,"Segoe UI","PingFang SC",sans-serif;color:#111;}',
    '.az-fab{bottom:16px;right:16px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}',
    '.az-btn{background:#111;color:#fff;border:none;border-radius:999px;padding:9px 16px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);font:inherit;font-weight:600;min-width:120px;text-align:center;}',
    '.az-btn[data-active="true"]{background:#e8830c;}',
    '.az-hint{background:rgba(17,17,17,.9);color:#fff;font-size:11px;padding:5px 9px;border-radius:6px;max-width:230px;text-align:left;line-height:1.4;}',
    '.az-hover{position:fixed;pointer-events:none;border:2px dashed #e8830c;background:rgba(232,131,12,.08);z-index:2147483646;display:none;box-sizing:border-box;border-radius:3px;}',
    '.az-badge{position:fixed;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#e8830c;color:#fff;font:11px/20px ui-monospace,monospace;text-align:center;z-index:2147483647;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.3);display:none;box-sizing:border-box;}',
    '.az-chip{position:fixed;background:rgba(17,17,17,.92);color:#fff;font:11px/1.3 ui-monospace,monospace;padding:4px 7px;border-radius:5px;z-index:2147483647;display:none;gap:7px;align-items:center;}',
    '.az-chip-sel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;}',
    '.az-chip-btn{background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:4px;padding:1px 7px;font:inherit;cursor:pointer;}',
    '.az-chip-btn:hover{background:rgba(255,255,255,.32);}',
    'body.az-on *{cursor:crosshair !important;}',
    'body.az-on .az-modal,body.az-on .az-modal *{cursor:auto !important;}',
    'body.az-on .az-modal textarea,body.az-on .az-modal input{cursor:text !important;}',
    'body.az-on .az-modal button,body.az-on .az-del{cursor:pointer !important;}',
    '.az-modal{position:fixed;background:#fff;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.26);padding:16px;width:430px;max-width:calc(100vw - 32px);box-sizing:border-box;z-index:2147483647;max-height:calc(100vh - 32px);overflow:auto;}',
    '.az-modal h4{margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;display:flex;align-items:center;gap:8px;}',
    '.az-modal h4 .az-tag{font-weight:500;color:#9a6700;background:#fff8c5;border-radius:4px;padding:1px 7px;font-size:11px;}',
    '.az-sel{font-family:ui-monospace,monospace;font-size:11px;color:#6b7280;background:#f3f4f6;padding:5px 7px;border-radius:5px;margin-bottom:10px;word-break:break-all;}',
    '.az-exist{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:280px;overflow-y:auto;}',
    '.az-item{background:#fff8e6;border:1px solid #fde68a;border-radius:7px;padding:8px 10px;display:flex;gap:8px;align-items:flex-start;}',
    '.az-item-b{flex:1;min-width:0;}',
    '.az-item-t{font-size:12.5px;color:#1f2937;white-space:pre-wrap;word-break:break-word;line-height:1.5;}',
    '.az-item-m{font-size:10px;color:#6b7280;margin-top:5px;font-family:ui-monospace,monospace;}',
    '.az-del{background:#ef4444;color:#fff;border:none;border-radius:5px;padding:2px 8px;font-size:12px;cursor:pointer;flex-shrink:0;}',
    '.az-del:hover{background:#dc2626;}',
    '.az-h{font-size:11px;color:#6b7280;margin-bottom:5px;font-weight:600;}',
    '.az-modal textarea{width:100%;min-height:74px;padding:9px;border:1px solid #d1d5db;border-radius:7px;font:inherit;font-size:13px;box-sizing:border-box;resize:vertical;}',
    '.az-modal .az-name{width:100%;height:32px;margin-top:7px;padding:0 9px;border:1px solid #d1d5db;border-radius:7px;font:inherit;font-size:12px;box-sizing:border-box;}',
    '.az-act{margin-top:10px;display:flex;gap:8px;justify-content:flex-end;}',
    '.az-act .az-s{padding:6px 14px;font-size:12.5px;border-radius:7px;border:none;cursor:pointer;font:inherit;}',
    '.az-cancel{background:#6b7280;color:#fff;}',
    '.az-add{background:#e8830c;color:#fff;font-weight:600;}',
    '.az-toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 15px;border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.2);z-index:2147483647;font-size:13px;}',
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── chrome ──
  var root = document.createElement('div');
  root.className = 'az-root az-fab';
  document.body.appendChild(root);

  var btn = document.createElement('button');
  btn.className = 'az-btn';
  btn.onclick = function () { setMode(getMode() === 'annotate' ? 'off' : 'annotate'); };
  root.appendChild(btn);

  var hoverBox = document.createElement('div'); hoverBox.className = 'az-hover'; document.body.appendChild(hoverBox);
  var badge = document.createElement('div'); badge.className = 'az-badge'; document.body.appendChild(badge);

  // ── store (server is source of truth) ──
  var all = [];
  var byKey = {};
  function refresh() {
    return fetch('/api/comments').then(function (r) { return r.json(); }).then(function (d) {
      all = (d.comments || []);
      byKey = {};
      all.forEach(function (c) { var k = c.page + '|' + c.anchor; (byKey[k] = byKey[k] || []).push(c); });
      refreshUI();
    }).catch(function () {});
  }
  function commentsFor(sel) { return byKey[PAGE + '|' + sel] || []; }

  function refreshUI() {
    var mode = getMode();
    btn.dataset.active = String(mode === 'annotate');
    var n = all.filter(function (c) { return c.page === PAGE; }).length;
    btn.textContent = '评论' + (mode === 'annotate' ? ' · 开' : '') + (n ? ' · ' + n : '');
    document.body.classList.toggle('az-on', mode !== 'off');
    if (mode === 'off') clearHover();
  }

  function toast(msg, ms) {
    var t = document.createElement('div'); t.className = 'az-toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, ms || 2200);
  }

  // ── targeting ──
  var hovered = null, locked = false;
  function isOurs(el) { return el && el.closest && el.closest('.az-root,.az-modal,.az-toast,.az-hover,.az-badge'); }

  function position(el) {
    if (!el || el === document.body || el === document.documentElement) { hoverBox.style.display = badge.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    hoverBox.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
    var sel = selectorPath(el);
    var ex = commentsFor(sel);
    if (ex.length) {
      badge.textContent = '💬 ' + ex.length;
      badge.style.left = Math.max(4, Math.min(r.right - 24, window.innerWidth - 64)) + 'px';
      badge.style.top = Math.max(4, r.top - 10) + 'px'; badge.style.display = 'block';
    } else badge.style.display = 'none';
  }
  function clearHover() { hovered = null; locked = false; hoverBox.style.display = badge.style.display = 'none'; }

  function walk(dir) {
    if (!hovered) return;
    locked = true;
    if (dir === 'up') { var p = hovered.parentElement; if (p && p !== document.body && p !== document.documentElement) hovered = p; }
    else if (dir === 'down') { var c = hovered.firstElementChild; if (c) hovered = c; }
    position(hovered);
  }

  document.addEventListener('mouseover', function (e) {
    if (getMode() === 'off' || isOurs(e.target) || locked) return;
    hovered = e.target; position(hovered);
  }, true);
  document.addEventListener('click', function (e) {
    if (getMode() === 'off' || isOurs(e.target) || !hovered) return;
    e.preventDefault(); e.stopPropagation();
    var target = hovered; clearHover(); openModal(target, e.clientX, e.clientY);
  }, true);
  window.addEventListener('scroll', function () { if (hovered) position(hovered); }, true);
  window.addEventListener('resize', function () { if (hovered) position(hovered); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var m = document.querySelector('.az-modal');
      if (m) { m.remove(); clearHover(); return; }   // 1st Esc: close the modal
      if (getMode() !== 'off') setMode('off');         // else: exit annotate mode
      clearHover();
      return;
    }
    if (getMode() === 'off' || !hovered) return;
    var t = e.target;
    if (t instanceof HTMLElement && (t.matches('input,textarea,[contenteditable]') || t.isContentEditable)) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); walk('up'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); walk('down'); }
  });

  // ── modal ──
  function openModal(el, x, y) {
    var sel = selectorPath(el);
    var ex = commentsFor(sel);
    var modal = document.createElement('div');
    modal.className = 'az-modal'; modal.style.left = '-9999px'; modal.style.top = '-9999px';

    function itemHtml(c) {
      return '<div class="az-item" data-id="' + esc(c.id) + '"><div class="az-item-b">' +
        '<div class="az-item-t">' + esc(c.body) + '</div>' +
        '<div class="az-item-m">' + (c.author ? esc(c.author) + ' · ' : '') + tdate(c.ts) + '</div>' +
        '</div><button class="az-del" data-id="' + esc(c.id) + '" title="删除">×</button></div>';
    }
    modal.innerHTML =
      '<h4>评论元素 <span class="az-tag">' + el.tagName.toLowerCase() + '</span></h4>' +
      '<div class="az-sel">' + esc(sel || '(根元素)') + '</div>' +
      (ex.length ? '<div class="az-h">该元素已有 ' + ex.length + ' 条评论：</div><div class="az-exist">' + ex.map(itemHtml).join('') + '</div>' : '') +
      '<div class="az-h">' + (ex.length ? '再加一条：' : '添加评论：') + '</div>' +
      '<textarea placeholder="这里想说点什么？"></textarea>' +
      '<input class="az-name" placeholder="署名（可选）" value="' + esc(author) + '">' +
      '<div class="az-act"><button class="az-s az-cancel">取消</button><button class="az-s az-add">添加</button></div>';
    document.body.appendChild(modal);
    var mw = modal.offsetWidth, mh = modal.offsetHeight;
    modal.style.left = Math.max(16, Math.min(x, window.innerWidth - mw - 16)) + 'px';
    modal.style.top = Math.max(16, Math.min(y, window.innerHeight - mh - 16)) + 'px';
    var ta = modal.querySelector('textarea'); ta.focus();

    modal.querySelector('.az-cancel').onclick = function () { modal.remove(); };
    Array.prototype.forEach.call(modal.querySelectorAll('.az-del'), function (b) {
      b.onclick = function () {
        if (!confirm('删除这条评论？')) return;
        fetch('/api/comments/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' })
          .then(function () { b.closest('.az-item').remove(); return refresh(); })
          .then(function () { toast('已删除'); });
      };
    });
    var doAdd = function () {
      var body = ta.value.trim();
      if (!body) { modal.remove(); return; }
      author = modal.querySelector('.az-name').value.trim();
      localStorage.setItem('aprog-annot-author', author);
      fetch('/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page: PAGE, anchor: sel, quote: quoteFor(el), body: body, author: author }) })
        .then(function () { modal.remove(); return refresh(); })
        .then(function () { toast('评论已保存'); });
    };
    modal.querySelector('.az-add').onclick = doAdd;
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doAdd(); });
  }

  // ── hide chrome (Ctrl+`) ──
  function isHidden() { try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch (e) { return false; } }
  function setHidden(b) {
    try { b ? localStorage.setItem(HIDDEN_KEY, '1') : localStorage.removeItem(HIDDEN_KEY); } catch (e) {}
    root.style.display = b ? 'none' : '';
    if (b) { setMode('off'); clearHover(); }
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== '`' || !e.ctrlKey) return;
    e.preventDefault(); var h = !isHidden(); setHidden(h);
    if (!h) toast('标注层已显示。Ctrl+` 隐藏。', 1600);
  });

  if (isHidden()) root.style.display = 'none';
  refresh();
})();
