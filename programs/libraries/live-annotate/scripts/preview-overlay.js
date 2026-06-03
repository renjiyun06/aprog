// preview-overlay.js
//
// Injected by preview-server into every HTML response served from output-dir.
// Provides an Annotate mode — click any element, see existing pending comments
// on it (across all browsers / pages), delete or add. All draft state lives on
// the SERVER (state/feedback-draft), not in the browser, so:
//   - drafts survive tab close
//   - opening any page in any browser sees the same drafts (refresh-based sync)
//   - the agent can read drafts as a normal state KV before commit
//
// Tweak mode is currently HIDDEN (the button is not rendered). The underlying
// tweak modal + /tweak server endpoint are preserved for future revival.
//
// Server endpoints used:
//   GET    /draft                  → { feedback: Comment[] }
//   POST   /draft/feedback         body: { url, selector, comment } → { ok, id, count }
//   DELETE /draft/feedback/:id     → { ok, count }
//   DELETE /draft                  → { ok }
//   POST   /commit                 → { ok, accepted, input_id }
//
// sessionStorage is now used ONLY for the current mode toggle (annotate/off);
// pending comments are NOT cached client-side any more.

(function () {
  if (window.__previewOverlayLoaded) return;
  window.__previewOverlayLoaded = true;

  // Don't run inside an iframe — overlay UX (modal, cursor, hover) breaks
  // across frame boundaries, and the host page already has its own overlay.
  // The top-window overlay is what the user actually interacts with.
  if (window.self !== window.top) return;

  const MODE_KEY = "__preview_mode";

  // ----- utilities -----
  const getMode = () => window.sessionStorage.getItem(MODE_KEY) || "off";
  const setMode = (m) => { window.sessionStorage.setItem(MODE_KEY, m); refreshUI(); };

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

  function fmtTime(iso) {
    // "2026-05-17T07:43:00Z" → "07:43"
    const m = /T(\d{2}):(\d{2})/.exec(iso || "");
    return m ? `${m[1]}:${m[2]}` : "?";
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ----- styles -----
  const css = `
    .__po-root { position: fixed; z-index: 2147483647; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
    .__po-fab { bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
    .__po-btn { background: #111; color: #fff; border: none; border-radius: 999px; padding: 8px 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.18); font: inherit; }
    .__po-fab .__po-btn { min-width: 132px; text-align: center; }
    .__po-btn[data-mode="annotate"][data-active="true"] { background: #f59e0b; }
    .__po-btn.__po-send { background: #16a34a; }
    .__po-btn.__po-cancel { background: #6b7280; }
    .__po-btn.__po-danger { background: #dc2626; }
    .__po-btn.__po-small { padding: 4px 10px; font-size: 12px; }
    .__po-toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 280px); background: #111; color: #fff; padding: 10px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.2); z-index: 2147483647; }
    .__po-hover-box { position: fixed; pointer-events: none; border: 2px dashed #f59e0b; background: rgba(245,158,11,0.08); z-index: 2147483646; display: none; box-sizing: border-box; }
    .__po-badge { position: fixed; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #f59e0b; color: #fff; font: 11px/18px ui-monospace, monospace; text-align: center; z-index: 2147483647; pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,.3); display: none; box-sizing: border-box; }
    .__po-chip { position: fixed; background: rgba(17,17,17,0.92); color: #fff; font: 11px/1.3 ui-monospace, monospace; padding: 3px 6px; border-radius: 4px; z-index: 2147483647; display: none; gap: 6px; align-items: center; max-width: calc(100vw - 32px); }
    .__po-chip-sel { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
    .__po-chip-btn { background: rgba(255,255,255,0.18); color: #fff; border: none; border-radius: 3px; padding: 1px 6px; font: inherit; cursor: pointer; }
    .__po-chip-btn:hover { background: rgba(255,255,255,0.3); }
    body.__po-active *, body.__po-active { cursor: crosshair !important; }
    body.__po-active .__po-modal, body.__po-active .__po-modal * { cursor: auto !important; }
    body.__po-active .__po-modal textarea, body.__po-active .__po-modal input { cursor: text !important; }
    body.__po-active .__po-modal button, body.__po-active .__po-modal .__po-existing-del { cursor: pointer !important; }
    .__po-modal { position: fixed; background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 16px; width: 420px; max-width: calc(100vw - 32px); box-sizing: border-box; z-index: 2147483647; max-height: calc(100vh - 32px); overflow: auto; }
    .__po-modal h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; }
    .__po-modal .__po-sel { font-family: ui-monospace, monospace; font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 4px 6px; border-radius: 4px; margin-bottom: 10px; word-break: break-all; }
    .__po-modal textarea { width: 100%; min-height: 70px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; box-sizing: border-box; resize: vertical; }
    .__po-modal .__po-actions { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
    .__po-existing { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; max-height: 280px; overflow-y: auto; }
    .__po-existing-item { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px; display: flex; gap: 8px; align-items: flex-start; }
    .__po-existing-item.other-page { background: #f3f4f6; border-color: #d1d5db; }
    .__po-existing-body { flex: 1; min-width: 0; }
    .__po-existing-text { font-size: 12px; color: #1f2937; white-space: pre-wrap; word-break: break-word; }
    .__po-existing-meta { font-size: 10px; color: #6b7280; margin-top: 4px; font-family: ui-monospace, monospace; }
    .__po-existing-del { background: #ef4444; color: #fff; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; flex-shrink: 0; }
    .__po-existing-del:hover { background: #dc2626; }
    .__po-add-header { font-size: 11px; color: #6b7280; margin-bottom: 4px; font-weight: 600; }
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

  // Tweak button — HIDDEN per current design decisions.
  // Code preserved (modal + endpoint) for future revival; just not rendered.
  // (Was: btnTweak = createElement('button'); ... appendChild)

  const btnSend = document.createElement("button");
  btnSend.className = "__po-btn __po-send";
  btnSend.style.display = "none";
  btnSend.onclick = () => commitBatch();

  const btnClear = document.createElement("button");
  btnClear.className = "__po-btn __po-cancel";
  btnClear.style.display = "none";
  btnClear.textContent = "Clear pending";
  btnClear.onclick = async () => {
    if (!confirm("Discard ALL pending annotations (across all pages, all browsers)?")) return;
    try {
      const r = await fetch("/draft", { method: "DELETE" });
      if (!r.ok) throw new Error(r.status);
      await refreshDrafts();
      toast("All drafts cleared.");
    } catch (e) {
      toast("Clear failed: " + e.message, 4000);
    }
  };

  root.appendChild(btnSend);
  root.appendChild(btnClear);
  root.appendChild(btnAnnotate);

  // Hover overlay — positioned at the hovered element's bounding rect.
  const hoverBox = document.createElement("div");
  hoverBox.className = "__po-hover-box";
  document.body.appendChild(hoverBox);

  // Comment-count badge that floats at the top-right of the hovered element
  // when it has pending comments.
  const badge = document.createElement("div");
  badge.className = "__po-badge";
  document.body.appendChild(badge);

  // Floating chip — selector + DOM-walk buttons.
  const chip = document.createElement("div");
  chip.className = "__po-chip";
  chip.innerHTML = `<span class="__po-chip-sel"></span>` +
    `<button class="__po-chip-btn" data-action="up" title="walk up to parent (↑ key)">↑ parent</button>` +
    `<button class="__po-chip-btn" data-action="down" title="walk down to first child (↓ key)">↓ child</button>`;
  document.body.appendChild(chip);

  // ----- draft state (server is source of truth) -----
  // `drafts` is the most recent snapshot from GET /draft. `draftsBy` indexes it
  // by `${url}|${selector}` for fast hover-badge lookup.
  let drafts = [];
  let draftsBy = new Map();

  async function refreshDrafts() {
    try {
      const r = await fetch("/draft");
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      drafts = Array.isArray(j.feedback) ? j.feedback : [];
    } catch (e) {
      console.warn("preview-overlay: refreshDrafts failed", e);
      drafts = [];
    }
    draftsBy = new Map();
    for (const d of drafts) {
      const k = `${d.url}|${d.selector}`;
      if (!draftsBy.has(k)) draftsBy.set(k, []);
      draftsBy.get(k).push(d);
    }
    refreshUI();
  }

  function commentsFor(url, selector) {
    return draftsBy.get(`${url}|${selector}`) || [];
  }

  // ----- UI refresh -----
  function refreshUI() {
    const mode = getMode();
    btnAnnotate.dataset.active = String(mode === "annotate");
    const total = drafts.length;
    btnAnnotate.textContent = `Annotate${mode === "annotate" ? " · ON" : ""}${total ? ` · ${total}` : ""}`;
    if (total > 0) {
      btnSend.style.display = "";
      btnSend.textContent = `Send batch (${total})`;
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
  let hovered = null;
  let chipLocked = false;

  function isOurEl(el) {
    return el && el.closest && el.closest(".__po-root, .__po-modal, .__po-toast, .__po-chip, .__po-hover-box, .__po-badge");
  }

  function positionHover(el) {
    if (!el || el === document.body || el === document.documentElement) {
      hoverBox.style.display = "none";
      chip.style.display = "none";
      badge.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    hoverBox.style.left = rect.left + "px";
    hoverBox.style.top = rect.top + "px";
    hoverBox.style.width = rect.width + "px";
    hoverBox.style.height = rect.height + "px";
    hoverBox.style.display = "block";

    const sel = selectorPath(el);
    chip.querySelector(".__po-chip-sel").textContent = sel;
    const chipTop = rect.top > 28 ? rect.top - 28 : Math.min(rect.top + 6, window.innerHeight - 32);
    chip.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 320)) + "px";
    chip.style.top = chipTop + "px";
    chip.style.display = "flex";

    // Badge — only if this element has pending comments on this URL.
    const existing = commentsFor(location.pathname, sel);
    if (existing.length > 0) {
      badge.textContent = `💬 ${existing.length}`;
      // Top-right of the element, slightly outside.
      badge.style.left = Math.max(4, Math.min(rect.right - 22, window.innerWidth - 60)) + "px";
      badge.style.top = Math.max(4, rect.top - 10) + "px";
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  }

  function clearHover() {
    hovered = null;
    chipLocked = false;
    hoverBox.style.display = "none";
    chip.style.display = "none";
    badge.style.display = "none";
  }

  document.addEventListener("mouseover", (e) => {
    const mode = getMode();
    if (mode === "off" || isOurEl(e.target) || chipLocked) return;
    hovered = e.target;
    positionHover(hovered);
  }, true);

  // Walk DOM up or down from the currently-hovered element. Used by both the
  // chip ↑/↓ buttons and the ↑/↓ arrow keys (handy when the chip is too small
  // a target to click). Locks subsequent mouseover so the target sticks.
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

  chip.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.dataset.action || !hovered) return;
    e.preventDefault(); e.stopPropagation();
    walkHover(t.dataset.action);
  });

  // ----- click → modal -----
  document.addEventListener("click", (e) => {
    const mode = getMode();
    if (mode === "off" || isOurEl(e.target) || !hovered) return;
    e.preventDefault(); e.stopPropagation();
    const target = hovered;
    clearHover();
    openAnnotateModal(target, e.clientX, e.clientY);
  }, true);

  window.addEventListener("scroll", () => { if (hovered) positionHover(hovered); }, true);
  window.addEventListener("resize", () => { if (hovered) positionHover(hovered); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { clearHover(); return; }
    if (getMode() === "off" || !hovered) return;
    // Don't hijack arrows when typing.
    const t = e.target;
    if (t instanceof HTMLElement && (t.matches("input, textarea, [contenteditable], [contenteditable=\"true\"]") || t.isContentEditable)) return;
    if (e.key === "ArrowUp")   { e.preventDefault(); walkHover("up"); }
    else if (e.key === "ArrowDown") { e.preventDefault(); walkHover("down"); }
  });

  // ----- annotate modal -----
  function openAnnotateModal(el, x, y) {
    const sel = selectorPath(el);
    const url = location.pathname;
    const existing = commentsFor(url, sel);

    const modal = document.createElement("div");
    modal.className = "__po-modal";
    // Initial off-screen placement — actual position set after append once we know modal size.
    modal.style.left = "-9999px";
    modal.style.top = "-9999px";

    function renderItem(c) {
      const sameUrl = c.url === url;
      return `
        <div class="__po-existing-item${sameUrl ? "" : " other-page"}" data-id="${escHtml(c.id)}">
          <div class="__po-existing-body">
            <div class="__po-existing-text">${escHtml(c.comment)}</div>
            <div class="__po-existing-meta">${fmtTime(c.ts)} · ${escHtml(c.url)}</div>
          </div>
          <button class="__po-existing-del" data-action="delete" data-id="${escHtml(c.id)}" title="Delete this comment">×</button>
        </div>`;
    }

    function existingHtml() {
      if (existing.length === 0) return "";
      return `
        <div class="__po-add-header">Existing pending comments on this element (${existing.length}):</div>
        <div class="__po-existing">${existing.map(renderItem).join("")}</div>`;
    }

    modal.innerHTML = `
      <h4>Annotate element</h4>
      <div class="__po-sel">${escHtml(sel)}</div>
      ${existingHtml()}
      <div class="__po-add-header">${existing.length > 0 ? "Add another comment:" : "Add a comment:"}</div>
      <textarea placeholder="What should change here? (free text)"></textarea>
      <div class="__po-actions">
        <button class="__po-btn __po-cancel __po-small">Cancel</button>
        <button class="__po-btn __po-small" data-action="add">Add comment</button>
      </div>`;
    document.body.appendChild(modal);
    const _mw = modal.offsetWidth, _mh = modal.offsetHeight;
    const _left = Math.max(16, Math.min(x, window.innerWidth - _mw - 16));
    const _top  = Math.max(16, Math.min(y, window.innerHeight - _mh - 16));
    modal.style.left = _left + "px";
    modal.style.top  = _top  + "px";
    const ta = modal.querySelector("textarea");
    ta.focus();

    modal.querySelector(".__po-cancel").onclick = () => modal.remove();

    // Per-item delete buttons.
    modal.querySelectorAll(".__po-existing-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (!confirm("Delete this comment?")) return;
        btn.disabled = true;
        try {
          const r = await fetch(`/draft/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
          if (!r.ok) throw new Error(r.status);
          // Remove from local view + refresh.
          btn.closest(".__po-existing-item").remove();
          await refreshDrafts();
          // If no existing left, drop the header.
          if (modal.querySelectorAll(".__po-existing-item").length === 0) {
            const list = modal.querySelector(".__po-existing");
            if (list) list.remove();
            const header = modal.querySelectorAll(".__po-add-header");
            if (header[0] && header[0].textContent.startsWith("Existing")) header[0].remove();
          }
          toast("Comment deleted.");
        } catch (e) {
          btn.disabled = false;
          toast("Delete failed: " + e.message, 4000);
        }
      });
    });

    // Add new comment.
    modal.querySelector('[data-action="add"]').onclick = async () => {
      const comment = ta.value.trim();
      if (!comment) { modal.remove(); return; }
      try {
        const r = await fetch("/draft/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, selector: sel, comment }),
        });
        if (!r.ok) throw new Error(r.status);
        await refreshDrafts();
        modal.remove();
        toast("Comment saved as draft.");
      } catch (e) {
        toast("Save failed: " + e.message, 4000);
      }
    };
  }

  // ----- commit -----
  async function commitBatch() {
    if (drafts.length === 0) return;
    btnSend.disabled = true;
    try {
      const r = await fetch("/commit", { method: "POST" });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      setMode("off");
      await refreshDrafts();
      toast(`Sent ${j.accepted} item(s) → ${j.input_id || "input.md"}. The agent will pick them up on its next turn.`, 4500);
    } catch (e) {
      toast("Commit failed: " + e.message, 5000);
    } finally {
      btnSend.disabled = false;
    }
  }

  // ----- chrome visibility toggle (Ctrl+` key) -----
  // Ctrl+backtick toggles the whole overlay UI (the floating fab) so it's
  // possible to demo a page without the agent-feedback chrome on top. State
  // lives in localStorage so the hide survives navigation, tab close, even
  // browser restart — undo with another Ctrl+` press, from any page.
  const HIDDEN_KEY = "__preview_overlay_hidden";
  function isHidden() { try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; } }
  function setHidden(b) {
    try { b ? localStorage.setItem(HIDDEN_KEY, "1") : localStorage.removeItem(HIDDEN_KEY); } catch {}
    root.style.display = b ? "none" : "";
    if (b) {
      // While hidden: force-off so the crosshair cursor + hover overlay
      // can't linger from a previously-active annotate session.
      setMode("off");
      clearHover();
    }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "`" || !e.ctrlKey) return;
    e.preventDefault();
    const nowHidden = !isHidden();
    setHidden(nowHidden);
    if (!nowHidden) toast("Overlay visible. Press Ctrl+` to hide.", 1800);
  });

  // ----- init -----
  if (isHidden()) root.style.display = "none";
  refreshDrafts();
  console.log("preview-overlay: press Ctrl+` to hide/show this floating UI (state persists across pages).");
})();
