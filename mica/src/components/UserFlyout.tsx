import { createSignal, Show, onMount, onCleanup, type Component } from 'solid-js';
import { auth } from '../stores/auth';
import { Avatar } from './Avatar';
import { openWindow } from '../stores/windows';

/** Tray avatar button → flyout menu (account settings / logout). */
export const UserFlyout: Component = () => {
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLDivElement;

  const onDocDown = (e: PointerEvent) => {
    if (wrap && !wrap.contains(e.target as Node)) setOpen(false);
  };
  onMount(() => document.addEventListener('pointerdown', onDocDown));
  onCleanup(() => document.removeEventListener('pointerdown', onDocDown));

  return (
    <div class="user-flyout-wrap" ref={wrap}>
      <button class="tb-user" title={auth.user()?.displayName} onClick={() => setOpen((o) => !o)}>
        <Avatar size={24} />
      </button>

      <Show when={open()}>
        <div class="user-menu">
          <div class="um-head">
            <Avatar size={44} />
            <div class="um-id">
              <div class="um-name">{auth.user()?.displayName}</div>
              <div class="um-user">{auth.user()?.username}</div>
            </div>
          </div>
          <div class="um-sep" />
          <button class="um-item" onClick={() => { openWindow('settings'); setOpen(false); }}>
            设置
          </button>
          <button class="um-item danger" onClick={() => auth.logout()}>
            登出
          </button>
        </div>
      </Show>
    </div>
  );
};
