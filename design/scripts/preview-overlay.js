// preview-overlay.js
//
// Injected by preview-server into every HTML response served from output-dir.
// Provides two modes — Annotate (free-form comments anchored to elements) and
// Tweak (structured property edits with live preview) — both batched in
// sessionStorage and POSTed to the server when the user clicks Send.
//
// Server endpoints used:
//   POST /feedback   body: { items: [ { url, selector, comment } ] }
//   POST /tweak      body: { items: [ { url, selector, note, props } ] }
//
// State (sessionStorage):
//   __preview_feedback_batch : JSON array of pending annotations
//   __preview_tweak_batch    : JSON array of pending tweaks
//   __preview_mode           : "annotate" | "tweak" | "off"

(function () {
  if (window.__previewOverlayLoaded) return;
  window.__previewOverlayLoaded = true;

  const FEEDBACK_KEY = "__preview_feedback_batch";
  const TWEAK_KEY = "__preview_tweak_batch";
  const MODE_KEY = "__preview_mode";

  // ----- utilities -----
  const ss = window.sessionStorage;
  const getBatch = (k) => { try { return JSON.parse(ss.getItem(k) || "[]"); } catch { return []; } };
  const setBatch = (k, v) => ss.setItem(k, JSON.stringify(v));
  const getMode = () => ss.getItem(MODE_KEY) || "off";
  const setMode = (m) => { ss.setItem(MODE_KEY, m); refreshUI(); };

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

  function fmtCount(n) { return n === 1 ? "1 item" : `${n} items`; }

  // ----- styles -----
  const css = `
    .__po-root { position: fixed; z-index: 2147483647; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
    .__po-fab { bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
    .__po-btn { background: #111; color: #fff; border: none; border-radius: 999px; padding: 8px 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.18); font: inherit; }
    .__po-btn[data-mode] { min-width: 132px; text-align: center; }
    .__po-btn[data-mode="annotate"][data-active="true"] { background: #f59e0b; }
    .__po-btn[data-mode="tweak"][data-active="true"] { background: #3b82f6; }
    .__po-btn.__po-send { background: #16a34a; }
    .__po-btn.__po-cancel { background: #6b7280; }
    .__po-btn.__po-danger { background: #dc2626; }
    .__po-toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 280px); background: #111; color: #fff; padding: 10px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.2); z-index: 2147483647; }
    .__po-hover-box { position: fixed; pointer-events: none; border: 2px dashed #f59e0b; background: rgba(245,158,11,0.08); z-index: 2147483646; display: none; box-sizing: border-box; }
    .__po-hover-box.tweak { border-color: #3b82f6; background: rgba(59,130,246,0.08); }
    .__po-chip { position: fixed; background: rgba(17,17,17,0.92); color: #fff; font: 11px/1.3 ui-monospace, monospace; padding: 3px 6px; border-radius: 4px; z-index: 2147483647; display: none; gap: 6px; align-items: center; max-width: calc(100vw - 32px); }
    .__po-chip-sel { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
    .__po-chip-btn { background: rgba(255,255,255,0.18); color: #fff; border: none; border-radius: 3px; padding: 1px 6px; font: inherit; cursor: pointer; }
    .__po-chip-btn:hover { background: rgba(255,255,255,0.3); }
    body.__po-active *, body.__po-active { cursor: crosshair !important; }
    .__po-modal { position: fixed; background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 16px; width: 380px; max-width: calc(100vw - 32px); box-sizing: border-box; z-index: 2147483647; }
    .__po-modal h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; }
    .__po-modal .__po-sel { font-family: ui-monospace, monospace; font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 4px 6px; border-radius: 4px; margin-bottom: 10px; word-break: break-all; }
    .__po-modal textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; box-sizing: border-box; resize: vertical; }
    .__po-modal .__po-actions { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
    .__po-props { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 6px 10px; align-items: center; margin-bottom: 10px; }
    .__po-props label { font-size: 11px; color: #6b7280; }
    .__po-props input, .__po-props .__po-row { width: 100%; min-width: 0; box-sizing: border-box; }
    .__po-props input { padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font: inherit; }
    .__po-props .__po-row { display: flex; gap: 6px; }
    .__po-props .__po-row input[type="color"] { width: 36px; flex: 0 0 36px; height: 28px; padding: 0; }
    .__po-props .__po-row input[type="text"] { flex: 1 1 0; min-width: 0; }
    .__po-props .__po-side { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
    .__po-props .__po-side input { text-align: center; font-size: 11px; padding: 4px 2px; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ----- UI shell -----
  const root = document.createElement("div");
  root.className = "__po-root __po-fab";
  document.body.appendChild(root);

  const btnAnnotate = document.createElement("button");
  btnAnnotate.className = "__po-btn";
  btnAnnotate.dataset.mode = "annotate";
  btnAnnotate.onclick = () => setMode(getMode() === "annotate" ? "off" : "annotate");

  const btnTweak = document.createElement("button");
  btnTweak.className = "__po-btn";
  btnTweak.dataset.mode = "tweak";
  btnTweak.onclick = () => setMode(getMode() === "tweak" ? "off" : "tweak");

  const btnSend = document.createElement("button");
  btnSend.className = "__po-btn __po-send";
  btnSend.style.display = "none";
  btnSend.onclick = () => sendBatch();

  const btnClear = document.createElement("button");
  btnClear.className = "__po-btn __po-cancel";
  btnClear.style.display = "none";
  btnClear.textContent = "Clear pending";
  btnClear.onclick = () => {
    if (!confirm("Discard all pending annotations and tweaks?")) return;
    setBatch(FEEDBACK_KEY, []); setBatch(TWEAK_KEY, []); refreshUI();
  };

  root.appendChild(btnSend);
  root.appendChild(btnClear);
  root.appendChild(btnAnnotate);
  root.appendChild(btnTweak);

  // Hover overlay (positioned at the hovered element's bounding rect via
  // getBoundingClientRect — escapes any parent `overflow: hidden` clipping
  // that breaks an `outline:` painted directly on the target).
  const hoverBox = document.createElement("div");
  hoverBox.className = "__po-hover-box";
  document.body.appendChild(hoverBox);

  // Floating chip — shows the current selector and DOM-walk buttons so the
  // user can pick a parent or child instead of the innermost hovered element.
  const chip = document.createElement("div");
  chip.className = "__po-chip";
  chip.innerHTML = `<span class="__po-chip-sel"></span>` +
    `<button class="__po-chip-btn" data-action="up" title="walk up to parent">↑ parent</button>` +
    `<button class="__po-chip-btn" data-action="down" title="walk down to first child">↓ child</button>`;
  document.body.appendChild(chip);

  function refreshUI() {
    const mode = getMode();
    btnAnnotate.dataset.active = String(mode === "annotate");
    btnTweak.dataset.active = String(mode === "tweak");
    const fb = getBatch(FEEDBACK_KEY).length;
    const tw = getBatch(TWEAK_KEY).length;
    btnAnnotate.textContent = `Annotate${mode === "annotate" ? " · ON" : ""}${fb ? ` · ${fb}` : ""}`;
    btnTweak.textContent = `Tweak${mode === "tweak" ? " · ON" : ""}${tw ? ` · ${tw}` : ""}`;
    if (fb + tw > 0) {
      btnSend.style.display = "";
      btnSend.textContent = `Send batch (${fb + tw})`;
      btnClear.style.display = "";
    } else {
      btnSend.style.display = "none";
      btnClear.style.display = "none";
    }
    document.body.classList.toggle("__po-active", mode !== "off");
    if (mode === "off") clearHover();
  }

  // ----- toasts -----
  function toast(msg, ms = 2400) {
    const t = document.createElement("div");
    t.className = "__po-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ----- element targeting -----
  // `hovered` is the element the next click will commit to. By default the
  // mouseover handler keeps it pinned to the innermost element under the
  // cursor. When the user clicks the chip's ↑/↓ buttons, we lock the target
  // (`chipLocked = true`) so subsequent mouse drifts don't re-pull it back to
  // the innermost; the lock is released when the user actually commits (clicks
  // anywhere on the page), presses Escape, or toggles the mode off.
  let hovered = null;
  let chipLocked = false;

  function isOurEl(el) {
    return el && el.closest && el.closest(".__po-root, .__po-modal, .__po-toast, .__po-chip, .__po-hover-box");
  }

  function positionHover(el) {
    if (!el || el === document.body || el === document.documentElement) {
      hoverBox.style.display = "none";
      chip.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    hoverBox.style.left = rect.left + "px";
    hoverBox.style.top = rect.top + "px";
    hoverBox.style.width = rect.width + "px";
    hoverBox.style.height = rect.height + "px";
    hoverBox.style.display = "block";
    hoverBox.classList.toggle("tweak", getMode() === "tweak");

    chip.querySelector(".__po-chip-sel").textContent = selectorPath(el);
    const chipTop = rect.top > 28 ? rect.top - 28 : Math.min(rect.top + 6, window.innerHeight - 32);
    chip.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 320)) + "px";
    chip.style.top = chipTop + "px";
    chip.style.display = "flex";
  }

  function clearHover() {
    hovered = null;
    chipLocked = false;
    hoverBox.style.display = "none";
    chip.style.display = "none";
  }

  document.addEventListener("mouseover", (e) => {
    const mode = getMode();
    if (mode === "off" || isOurEl(e.target) || chipLocked) return;
    hovered = e.target;
    positionHover(hovered);
  }, true);

  // Chip ↑ / ↓ — walk DOM without committing; locks subsequent mouseover.
  chip.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.dataset.action || !hovered) return;
    e.preventDefault(); e.stopPropagation();
    chipLocked = true;
    if (t.dataset.action === "up") {
      const p = hovered.parentElement;
      if (p && p !== document.body && p !== document.documentElement) hovered = p;
    } else if (t.dataset.action === "down") {
      const c = hovered.firstElementChild;
      if (c) hovered = c;
    }
    positionHover(hovered);
  });

  // ----- click → modal -----
  document.addEventListener("click", (e) => {
    const mode = getMode();
    if (mode === "off" || isOurEl(e.target) || !hovered) return;
    e.preventDefault(); e.stopPropagation();
    const target = hovered;
    clearHover();
    if (mode === "annotate") openAnnotateModal(target, e.clientX, e.clientY);
    else if (mode === "tweak") openTweakModal(target, e.clientX, e.clientY);
  }, true);

  // Reposition on scroll / resize so the hover box tracks the element.
  window.addEventListener("scroll", () => { if (hovered) positionHover(hovered); }, true);
  window.addEventListener("resize", () => { if (hovered) positionHover(hovered); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") clearHover(); });

  // ----- annotate modal -----
  function openAnnotateModal(el, x, y) {
    const sel = selectorPath(el);
    const modal = document.createElement("div");
    modal.className = "__po-modal";
    modal.style.left = Math.min(x, window.innerWidth - 440) + "px";
    modal.style.top = Math.min(y, window.innerHeight - 220) + "px";
    modal.innerHTML = `
      <h4>Annotate element</h4>
      <div class="__po-sel">${sel}</div>
      <textarea placeholder="What should change here? (free text)"></textarea>
      <div class="__po-actions">
        <button class="__po-btn __po-cancel">Cancel</button>
        <button class="__po-btn">Save</button>
      </div>`;
    document.body.appendChild(modal);
    const ta = modal.querySelector("textarea");
    ta.focus();
    modal.querySelector(".__po-cancel").onclick = () => modal.remove();
    modal.querySelector(".__po-btn:not(.__po-cancel)").onclick = () => {
      const comment = ta.value.trim();
      if (!comment) { modal.remove(); return; }
      const batch = getBatch(FEEDBACK_KEY);
      batch.push({ url: location.pathname, selector: sel, comment });
      setBatch(FEEDBACK_KEY, batch);
      modal.remove(); refreshUI();
      toast(`Annotation saved (${batch.length})`);
    };
  }

  // ----- tweak modal -----
  function openTweakModal(el, x, y) {
    const sel = selectorPath(el);
    const cs = getComputedStyle(el);
    const modal = document.createElement("div");
    modal.className = "__po-modal";
    modal.style.left = Math.min(x, window.innerWidth - 440) + "px";
    modal.style.top = Math.min(y, window.innerHeight - 460) + "px";
    modal.innerHTML = `
      <h4>Tweak element</h4>
      <div class="__po-sel">${sel}</div>
      <div class="__po-props">
        <label>color</label>
        <div class="__po-row"><input type="color" data-prop="color"><input type="text" data-prop="color-text" placeholder="${cs.color}"></div>
        <label>background</label>
        <div class="__po-row"><input type="color" data-prop="background-color"><input type="text" data-prop="background-color-text" placeholder="${cs.backgroundColor}"></div>
        <label>font-size</label>
        <input type="text" data-prop="font-size" placeholder="${cs.fontSize}">
        <label>font-weight</label>
        <input type="text" data-prop="font-weight" placeholder="${cs.fontWeight}">
        <label>padding</label>
        <div class="__po-side">
          <input data-prop="padding-top" placeholder="${cs.paddingTop}">
          <input data-prop="padding-right" placeholder="${cs.paddingRight}">
          <input data-prop="padding-bottom" placeholder="${cs.paddingBottom}">
          <input data-prop="padding-left" placeholder="${cs.paddingLeft}">
        </div>
        <label>margin</label>
        <div class="__po-side">
          <input data-prop="margin-top" placeholder="${cs.marginTop}">
          <input data-prop="margin-right" placeholder="${cs.marginRight}">
          <input data-prop="margin-bottom" placeholder="${cs.marginBottom}">
          <input data-prop="margin-left" placeholder="${cs.marginLeft}">
        </div>
        <label>border-radius</label>
        <input type="text" data-prop="border-radius" placeholder="${cs.borderRadius}">
      </div>
      <textarea placeholder="Optional note (why this change?)"></textarea>
      <div class="__po-actions">
        <button class="__po-btn __po-cancel">Cancel</button>
        <button class="__po-btn">Save tweak</button>
      </div>`;
    document.body.appendChild(modal);

    // live preview: each input on change applies inline
    const inputs = modal.querySelectorAll("input[data-prop], textarea");
    function readProps() {
      const out = {};
      modal.querySelectorAll("input[data-prop]").forEach((i) => {
        const p = i.dataset.prop;
        const v = (i.value || "").trim();
        if (!v) return;
        // pair color / color-text — text overrides if non-empty
        if (p.endsWith("-text")) {
          out[p.replace(/-text$/, "")] = v;
        } else {
          // skip color picker if a text override is set
          const text = modal.querySelector(`input[data-prop="${p}-text"]`);
          if (text && text.value.trim()) return;
          out[p] = v;
        }
      });
      return out;
    }
    inputs.forEach((i) => i.addEventListener("input", () => {
      const props = readProps();
      Object.entries(props).forEach(([k, v]) => el.style.setProperty(k, v, "important"));
    }));
    modal.querySelector(".__po-cancel").onclick = () => {
      el.style.cssText = el.dataset.poOrigStyle || "";
      modal.remove();
    };
    el.dataset.poOrigStyle = el.style.cssText;
    modal.querySelector(".__po-btn:not(.__po-cancel)").onclick = () => {
      const props = readProps();
      const note = modal.querySelector("textarea").value.trim();
      if (Object.keys(props).length === 0 && !note) { modal.remove(); return; }
      const batch = getBatch(TWEAK_KEY);
      batch.push({ url: location.pathname, selector: sel, props, note });
      setBatch(TWEAK_KEY, batch);
      // revert preview so user sees server-rendered state
      el.style.cssText = el.dataset.poOrigStyle || "";
      delete el.dataset.poOrigStyle;
      modal.remove(); refreshUI();
      toast(`Tweak saved (${batch.length})`);
    };
  }

  // ----- send batch -----
  async function sendBatch() {
    const fb = getBatch(FEEDBACK_KEY);
    const tw = getBatch(TWEAK_KEY);
    if (fb.length === 0 && tw.length === 0) return;
    btnSend.disabled = true;
    try {
      if (fb.length > 0) {
        const r = await fetch("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: fb }) });
        if (!r.ok) throw new Error("feedback POST failed: " + r.status);
      }
      if (tw.length > 0) {
        const r = await fetch("/tweak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: tw }) });
        if (!r.ok) throw new Error("tweak POST failed: " + r.status);
      }
      setBatch(FEEDBACK_KEY, []); setBatch(TWEAK_KEY, []);
      setMode("off");
      refreshUI();
      toast(`Sent ${fb.length + tw.length} item(s). Ask your assistant to continue (it will pick them up on its next turn).`, 4500);
    } catch (err) {
      toast("Send failed: " + err.message, 5000);
    } finally {
      btnSend.disabled = false;
    }
  }

  refreshUI();
})();
