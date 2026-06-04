import { For, Show, onMount, type Component } from 'solid-js';
import { notifications, dismissToast } from '../stores/notifications';

/** Bottom-right toast stack (above the taskbar), Win11-style. Driven by the
 *  notification store's `toasts` list; each auto-dismisses (see pushNotif). */
export const Toasts: Component = () => {
  // auto-dismiss any toasts present at mount (e.g. the demo-seeded one)
  onMount(() => {
    for (const id of [...notifications.toasts]) setTimeout(() => dismissToast(id), 5000);
  });
  const shown = () => notifications.toasts
    .map((id) => notifications.items.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n);

  return (
    <div class="toast-layer">
      <For each={shown()}>{(n) => (
        <div class="toast" onClick={() => dismissToast(n.id)}>
          <div class="toast-title">{n.title}</div>
          <Show when={n.body}><div class="toast-body">{n.body}</div></Show>
          <div class="toast-ts">{n.ts}</div>
          <button class="toast-x" title="关闭" onClick={(e) => { e.stopPropagation(); dismissToast(n.id); }}>✕</button>
        </div>
      )}</For>
    </div>
  );
};
