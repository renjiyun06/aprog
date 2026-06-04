import { createSignal, Show, For, onMount, onCleanup, type Component } from 'solid-js';
import { notifications, unreadCount, markAllRead, markRead, type NotifType } from '../stores/notifications';

/** Win10/11 Action-Center glyph — a speech/message bubble (tail bottom-left). */
const ChatBubble: Component = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3.4 3 H12.6 A1.4 1.4 0 0 1 14 4.4 V9.4 A1.4 1.4 0 0 1 12.6 10.8 H6.4 L3.4 13.4 V10.8 A1.4 1.4 0 0 1 2 9.4 V4.4 A1.4 1.4 0 0 1 3.4 3 Z" />
  </svg>
);

/** Tray bell button (with unread badge) → notification center flyout. Win11-style. */
export const NotifyFlyout: Component = () => {
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLDivElement;

  const onDocDown = (e: PointerEvent) => {
    if (wrap && !wrap.contains(e.target as Node)) setOpen(false);
  };
  onMount(() => document.addEventListener('pointerdown', onDocDown));
  onCleanup(() => document.removeEventListener('pointerdown', onDocDown));

  const typeLabel: Record<NotifType, string> = { share: '分享', reply: '回复', action: '待确认' };

  return (
    <div class="notify-wrap" ref={wrap}>
      <button class="tb-bell" title="消息中心" onClick={() => setOpen((o) => !o)}>
        <ChatBubble />
        <Show when={unreadCount() > 0}>
          <span class="bell-badge">{unreadCount() > 99 ? '99+' : unreadCount()}</span>
        </Show>
      </button>

      <Show when={open()}>
        <div class="notify-panel">
          <div class="np-head">
            <span class="np-title">消息中心</span>
            <button class="np-clear" onClick={() => markAllRead()}>全部已读</button>
          </div>
          <div class="np-list">
            <Show when={notifications.items.length > 0} fallback={<div class="np-empty">暂无通知</div>}>
              <For each={notifications.items}>{(n) => (
                <button class={`np-item ${n.read ? '' : 'unread'}`} onClick={() => markRead(n.id)}>
                  <span class={`np-kind k-${n.type}`}>{typeLabel[n.type]}</span>
                  <span class="np-text">
                    <span class="np-item-title">{n.title}</span>
                    <Show when={n.body}><span class="np-item-body">{n.body}</span></Show>
                    <span class="np-item-ts">{n.ts}</span>
                  </span>
                  <Show when={!n.read}><span class="np-dot" /></Show>
                </button>
              )}</For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
