// aprog — live-annotate overlay
// 行为:
//   - 页面右下角 🗒️ 按钮 → 开/关标注模式
//   - 开启后: hover 高亮元素, 点击弹评论框, 输入后保存即立刻 POST /comment
//   - 页面加载 + 路由变更 → GET /comments?url=<path> 拉取该路由所有评论, 给元素挂角标
//   - 鼠标悬停带角标的元素时, 显示已有评论列表 (不阻塞继续添加)
//
// 简化点 (相比 aprog live-annotate):
//   - 不分 draft / inbox 两阶段, 每条评论保存即落盘
//   - 不做客户端删除 API (评论由 agent 处理完直接删 jsonl 行)
//   - 不写 input.md, 不读 state.yaml, 跟 aprog 协议解耦

(function () {
  if (window.__aprogAnnotateLoaded) return;
  window.__aprogAnnotateLoaded = true;
  // 在 iframe 中不加载 (PC 管理端是顶层窗口)
  if (window.self !== window.top) return;

  const MODE_KEY = "__aprog_annotate_mode";
  const getMode = () => window.sessionStorage.getItem(MODE_KEY) || "off";
  const setMode = (m) => { window.sessionStorage.setItem(MODE_KEY, m); refreshUI(); };

  // ----- 选择器生成 (借自 aprog) -----
  function selectorPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const path = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      let s = el.tagName.toLowerCase();
      if (el.id) { path.unshift("#" + CSS.escape(el.id)); break; }
      const sibs = Array.from(el.parentElement ? el.parentElement.children : []).filter((c) => c.tagName === el.tagName);
      if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(el) + 1})`;
      path.unshift(s);
      el = el.parentElement;
    }
    return path.join(" > ");
  }

  const fmtTime = (iso) => {
    const m = /T(\d{2}):(\d{2})/.exec(iso || "");
    return m ? `${m[1]}:${m[2]}` : "?";
  };

  const escHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ----- 样式 -----
  const css = `
    .__aprog-root { position: fixed; z-index: 2147483647; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
    .__aprog-fab { bottom: 16px; right: 16px; }
    .__aprog-btn { background: #111; color: #fff; border: none; border-radius: 999px; padding: 8px 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.18); font: inherit; min-width: 132px; text-align: center; }
    .__aprog-btn[data-active="true"] { background: #ea580c; }
    .__aprog-toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #111; color: #fff; padding: 10px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.2); z-index: 2147483647; }
    .__aprog-hover-box { position: fixed; pointer-events: none; border: 2px dashed #ea580c; background: rgba(234,88,12,.08); z-index: 2147483646; display: none; box-sizing: border-box; }
    .__aprog-badge { position: fixed; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #ea580c; color: #fff; font: 11px/18px ui-monospace, monospace; text-align: center; z-index: 2147483647; pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,.3); display: none; box-sizing: border-box; }
    .__aprog-chip { position: fixed; background: rgba(17,17,17,.92); color: #fff; font: 11px/1.3 ui-monospace, monospace; padding: 3px 6px; border-radius: 4px; z-index: 2147483647; display: none; max-width: calc(100vw - 32px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    body.__aprog-active *, body.__aprog-active { cursor: crosshair !important; }
    body.__aprog-active .__aprog-modal, body.__aprog-active .__aprog-modal * { cursor: auto !important; }
    body.__aprog-active .__aprog-modal textarea { cursor: text !important; }
    body.__aprog-active .__aprog-modal button { cursor: pointer !important; }
    .__aprog-modal { position: fixed; background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 16px; width: 420px; max-width: calc(100vw - 32px); box-sizing: border-box; z-index: 2147483647; max-height: calc(100vh - 32px); overflow: auto; }
    .__aprog-modal h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; }
    .__aprog-modal .__aprog-sel { font-family: ui-monospace, monospace; font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 4px 6px; border-radius: 4px; margin-bottom: 10px; word-break: break-all; }
    .__aprog-modal textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; box-sizing: border-box; resize: vertical; }
    .__aprog-modal .__aprog-actions { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
    .__aprog-modal .__aprog-save { background: #ea580c; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font: inherit; cursor: pointer; }
    .__aprog-modal .__aprog-cancel { background: #6b7280; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font: inherit; cursor: pointer; }
    .__aprog-existing { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; max-height: 240px; overflow-y: auto; }
    .__aprog-existing-item { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 8px 10px; }
    .__aprog-existing-text { font-size: 12px; color: #1f2937; white-space: pre-wrap; word-break: break-word; }
    .__aprog-existing-meta { font-size: 10px; color: #6b7280; margin-top: 4px; font-family: ui-monospace, monospace; }
    .__aprog-add-header { font-size: 11px; color: #6b7280; margin-bottom: 4px; font-weight: 600; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ----- DOM 骨架 -----
  // 不放悬浮按钮, 纯 Alt+A 切换标注模式。
  const SHOW_FAB = false;
  let root = null, btn = null;
  if (SHOW_FAB) {
    root = document.createElement("div");
    root.className = "__aprog-root __aprog-fab";
    document.body.appendChild(root);

    btn = document.createElement("button");
    btn.className = "__aprog-btn";
    btn.onclick = () => setMode(getMode() === "annotate" ? "off" : "annotate");
    root.appendChild(btn);
  }

  const hoverBox = document.createElement("div");
  hoverBox.className = "__aprog-hover-box";
  document.body.appendChild(hoverBox);

  const badge = document.createElement("div");
  badge.className = "__aprog-badge";
  document.body.appendChild(badge);

  const chip = document.createElement("div");
  chip.className = "__aprog-chip";
  document.body.appendChild(chip);

  let toastEl = null;
  function toast(msg, dur = 2000) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.className = "__aprog-toast";
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);
    setTimeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, dur);
  }

  // ----- 客户端评论缓存 (按 url+selector 索引) -----
  let cache = []; // 全部从 /comments?url=<当前 url> 拉取
  let cacheUrl = null;
  const isOurEl = (el) =>
    el && (el === root || el === hoverBox || el === badge || el === chip || el === toastEl
      || (el.closest && (el.closest(".__aprog-modal") || el.closest(".__aprog-root"))));

  async function refreshCommentsForCurrentUrl() {
    const url = location.pathname + location.hash; // hash 重要, admin-web 是 hash 路由
    cacheUrl = url;
    try {
      const r = await fetch("/comments?url=" + encodeURIComponent(url));
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      cache = data.comments || [];
    } catch (e) {
      console.warn("[live-annotate] refresh failed:", e);
      cache = [];
    }
  }

  const commentsFor = (url, sel) => cache.filter((c) => c.url === url && c.selector === sel);

  // ----- hover 高亮 + 角标 -----
  // chipLocked: 用方向键走过 DOM 树后, 锁住后续 mouseover, 避免鼠标晃过去就洗掉刚选好的目标
  // modalOpen: 评论框弹出期间, 关掉 hover 高亮和 chip, 也不响应页面其他元素的 click
  let hovered = null;
  let chipLocked = false;
  let modalOpen = false;
  let touchInteraction = false;
  let lastPointerKind = "mouse";
  let lastTouchPoint = null;
  let suppressClickUntil = 0;
  let pendingTouchSelector = "";
  let pendingTouchAt = 0;
  function clearHover() {
    hovered = null;
    chipLocked = false;
    hoverBox.style.display = "none";
    badge.style.display = "none";
    chip.style.display = "none";
  }

  // ----- UI 同步 -----
  function refreshUI() {
    const mode = getMode();
    if (btn) {
      btn.textContent = mode === "annotate" ? "🗒️ 标注: 开" : "🗒️ 标注";
      btn.dataset.active = mode === "annotate" ? "true" : "false";
    }
    document.body.classList.toggle("__aprog-active", mode === "annotate");
    if (mode === "off") clearHover();
  }
  refreshUI();
  refreshCommentsForCurrentUrl();
  function positionHover(el) {
    if (!el || !el.getBoundingClientRect) return;
    let r = el.getBoundingClientRect();
    // uni-app H5 的部分 <uni-view>/<uni-text> wrapper 可能 0 尺寸 (display:contents 或塌缩),
    // 撞上就向上找第一个有尺寸的祖先, 而不是直接清空 → 否则小程序页面 hover 不出框
    let guard = 0;
    while ((r.width === 0 || r.height === 0) && el.parentElement
           && el.parentElement !== document.body && guard++ < 6) {
      el = el.parentElement;
      r = el.getBoundingClientRect();
    }
    if (r.width === 0 || r.height === 0) { clearHover(); return; }
    hovered = el; // 锚到实际有尺寸的元素, 保证 click 时 selector 与框一致
    hoverBox.style.display = "block";
    hoverBox.style.left = r.left + "px";
    hoverBox.style.top = r.top + "px";
    hoverBox.style.width = r.width + "px";
    hoverBox.style.height = r.height + "px";
    const sel = selectorPath(el);
    chip.textContent = sel;
    const chipTop = r.top > 28 ? r.top - 28 : Math.min(r.top + 6, window.innerHeight - 32);
    chip.style.display = "block";
    chip.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 320)) + "px";
    chip.style.top = chipTop + "px";
    // badge
    const existing = commentsFor(cacheUrl, sel);
    if (existing.length > 0) {
      badge.textContent = String(existing.length);
      badge.style.display = "block";
      badge.style.left = Math.max(4, Math.min(r.right - 22, window.innerWidth - 60)) + "px";
      badge.style.top = Math.max(4, r.top - 6) + "px";
    } else {
      badge.style.display = "none";
    }
  }

  function requiresTapConfirm() {
    return touchInteraction
      && lastPointerKind !== "mouse";
  }

  function elementFromAnnotatePoint(x, y) {
    if (typeof x !== "number" || typeof y !== "number") return null;
    const els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    return els.find((el) => el && el.nodeType === 1 && !isOurEl(el)
      && el !== document.documentElement && el !== document.body) || null;
  }

  function positionHoverAtPoint(x, y) {
    const el = elementFromAnnotatePoint(x, y);
    if (!el) return false;
    positionHover(el);
    return true;
  }

  document.addEventListener("mouseover", (e) => {
    if (getMode() === "off" || modalOpen || isOurEl(e.target) || chipLocked) return;
    lastPointerKind = "mouse";
    hovered = e.target;
    positionHover(hovered);
  }, true);

  // DevTools 手机模式 / 真机触摸没有稳定 hover。用坐标命中元素来持续更新虚线框。
  document.addEventListener("pointerover", (e) => {
    if (getMode() === "off" || modalOpen || chipLocked) return;
    lastPointerKind = e.pointerType || "mouse";
    if (e.pointerType && e.pointerType !== "mouse") touchInteraction = true;
    positionHoverAtPoint(e.clientX, e.clientY);
  }, true);

  document.addEventListener("pointermove", (e) => {
    if (getMode() === "off" || modalOpen || chipLocked) return;
    lastPointerKind = e.pointerType || "mouse";
    if (e.pointerType && e.pointerType !== "mouse") touchInteraction = true;
    positionHoverAtPoint(e.clientX, e.clientY);
  }, true);

  document.addEventListener("mousemove", (e) => {
    if (getMode() === "off" || modalOpen || chipLocked) return;
    lastPointerKind = "mouse";
    positionHoverAtPoint(e.clientX, e.clientY);
  }, true);

  document.addEventListener("touchstart", (e) => {
    if (getMode() === "off" || modalOpen || chipLocked) return;
    touchInteraction = true;
    lastPointerKind = "touch";
    const t = e.touches && e.touches[0];
    if (t) {
      lastTouchPoint = { x: t.clientX, y: t.clientY };
      positionHoverAtPoint(t.clientX, t.clientY);
    }
  }, { capture: true, passive: true });

  document.addEventListener("touchmove", (e) => {
    if (getMode() === "off" || modalOpen || chipLocked) return;
    touchInteraction = true;
    lastPointerKind = "touch";
    const t = e.touches && e.touches[0];
    if (t) {
      lastTouchPoint = { x: t.clientX, y: t.clientY };
      positionHoverAtPoint(t.clientX, t.clientY);
    }
  }, { capture: true, passive: true });

  // ↑/↓ 沿 DOM 上下游走 (锁定 mouseover, 避免鼠标晃过去就洗掉刚选好的目标)
  function walkHover(dir) {
    if (!hovered) return;
    chipLocked = true;
    if (dir === "up") {
      const p = hovered.parentElement;
      if (p && p !== document.body && p !== document.documentElement) hovered = p;
    } else if (dir === "down") {
      const c = hovered.firstElementChild;
      if (c) hovered = c;
    }
    positionHover(hovered);
  }

  function activateAtPoint(x, y) {
    if (getMode() === "off" || modalOpen) return false;
    if (!hovered) positionHoverAtPoint(x, y);
    if (!hovered) return;
    const target = hovered;

    // 触摸/手机模拟没有 hover 预览语义: 第一 tap 只选中并显示虚线框, 第二 tap 再评论。
    if (requiresTapConfirm()) {
      const sel = selectorPath(target);
      const now = Date.now();
      if (pendingTouchSelector !== sel || now - pendingTouchAt > 3000) {
        pendingTouchSelector = sel;
        pendingTouchAt = now;
        positionHover(target);
        toast("已选中元素 · 再点一次添加评论", 1500);
        return true;
      }
      pendingTouchSelector = "";
      pendingTouchAt = 0;
    }

    clearHover();
    openModal(target, x, y);
    return true;
  }

  document.addEventListener("touchend", (e) => {
    if (getMode() === "off" || modalOpen || !lastTouchPoint) return;
    touchInteraction = true;
    suppressClickUntil = Date.now() + 700;
    const handled = activateAtPoint(lastTouchPoint.x, lastTouchPoint.y);
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true, passive: false });

  // ----- click → modal -----
  document.addEventListener("click", (e) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (getMode() === "off" || modalOpen || isOurEl(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    activateAtPoint(e.clientX, e.clientY);
  }, true);

  window.addEventListener("scroll", () => { if (hovered) positionHover(hovered); }, true);
  window.addEventListener("resize", () => { if (hovered) positionHover(hovered); });
  document.addEventListener("keydown", (e) => {
    // 全局: Alt+A 快速 toggle 标注模式 (输入控件聚焦时跳过, 避免劫持输入法/快捷输入)
    if (e.altKey && (e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const t0 = e.target;
      const inField = t0 instanceof HTMLElement && (t0.matches('input, textarea, [contenteditable], [contenteditable="true"]') || t0.isContentEditable);
      if (!inField) {
        e.preventDefault();
        const next = getMode() === "annotate" ? "off" : "annotate";
        setMode(next);
        toast(next === "annotate" ? "标注模式: 开 · 点元素写评论 · Alt+A 关" : "标注模式: 关", 1600);
        return;
      }
    }
    if (e.key === "Escape") { clearHover(); return; }
    if (getMode() === "off" || !hovered) return;
    // 输入控件里不劫持方向键
    const t = e.target;
    if (t instanceof HTMLElement && (t.matches('input, textarea, [contenteditable], [contenteditable="true"]') || t.isContentEditable)) return;
    if (e.key === "ArrowUp")   { e.preventDefault(); walkHover("up"); }
    else if (e.key === "ArrowDown") { e.preventDefault(); walkHover("down"); }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data || {};
    if (msg.type !== "aprog-annotate:toggle") return;
    const next = getMode() === "annotate" ? "off" : "annotate";
    setMode(next);
    toast(next === "annotate" ? "标注模式: 开 · 点元素写评论 · Alt+A 关" : "标注模式: 关", 1600);
  });

  // ----- modal -----
  function openModal(el, clickX, clickY) {
    const sel = selectorPath(el);
    const url = cacheUrl;
    const existing = commentsFor(url, sel);

    const modal = document.createElement("div");
    modal.className = "__aprog-modal";
    modal.innerHTML = `
      <h4>添加评论</h4>
      <div class="__aprog-sel">${escHtml(sel)}</div>
      ${existing.length > 0 ? `
        <div class="__aprog-add-header">该元素已有 ${existing.length} 条评论:</div>
        <div class="__aprog-existing">${existing.map((c) => `
          <div class="__aprog-existing-item">
            <div class="__aprog-existing-text">${escHtml(c.comment)}</div>
            <div class="__aprog-existing-meta">${fmtTime(c.ts)} · ${escHtml(c.id)}</div>
          </div>`).join("")}</div>
      ` : ""}
      <textarea placeholder="写点反馈 (Ctrl+Enter 保存)"></textarea>
      <div class="__aprog-actions">
        <button class="__aprog-cancel">取消</button>
        <button class="__aprog-save">保存</button>
      </div>
    `;
    document.body.appendChild(modal);
    modalOpen = true;

    // 评论框位置: 点击点的右下侧偏 12px; 越界则翻到左/上; 最终再 clamp 保证留 16px 安全边
    const r = modal.getBoundingClientRect();
    const gap = 12, pad = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = (typeof clickX === "number") ? clickX + gap : (vw - r.width) / 2;
    let top  = (typeof clickY === "number") ? clickY + gap : (vh - r.height) / 2;
    // 右越界 → 翻到点击点左侧
    if (left + r.width > vw - pad && typeof clickX === "number") left = clickX - r.width - gap;
    // 下越界 → 翻到点击点上方
    if (top + r.height > vh - pad && typeof clickY === "number") top = clickY - r.height - gap;
    // 最终 clamp (兜底极端情况, 比如点击靠近左/上边)
    left = Math.max(pad, Math.min(left, vw - r.width - pad));
    top  = Math.max(pad, Math.min(top,  vh - r.height - pad));
    modal.style.left = left + "px";
    modal.style.top = top + "px";

    const ta = modal.querySelector("textarea");
    setTimeout(() => ta.focus(), 0);

    const close = () => { modal.remove(); modalOpen = false; };
    modal.querySelector(".__aprog-cancel").onclick = close;

    const save = async () => {
      const comment = ta.value.trim();
      if (!comment) return;
      try {
        const r = await fetch("/comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, selector: sel, comment }),
        });
        if (!r.ok) throw new Error(r.status);
        await refreshCommentsForCurrentUrl();
        close();
        toast("已保存");
      } catch (e) {
        toast("保存失败: " + e.message, 3000);
      }
    };
    modal.querySelector(".__aprog-save").onclick = save;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
  }

  // ----- SPA 路由变更检测 -----
  const wrapHistory = (name) => {
    const orig = history[name];
    history[name] = function () {
      const r = orig.apply(this, arguments);
      window.dispatchEvent(new Event("__aprogRouteChange"));
      return r;
    };
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");
  window.addEventListener("popstate", () => window.dispatchEvent(new Event("__aprogRouteChange")));
  window.addEventListener("hashchange", () => window.dispatchEvent(new Event("__aprogRouteChange")));
  window.addEventListener("__aprogRouteChange", () => {
    clearHover();
    refreshCommentsForCurrentUrl();
  });

  console.log("[live-annotate] loaded; 按 Alt+A 开/关标注模式 (无 fab 按钮)");
})();
