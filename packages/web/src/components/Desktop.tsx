import { onMount, type Component } from 'solid-js';
import { WindowLayer } from './Window';
import { DesktopIcons } from './DesktopIcons';
import { Toasts } from './Toasts';
import { loadInstalled } from '../stores/installed';

export const Desktop: Component = () => {
  onMount(() => { void loadInstalled(); }); // 登录后拉取当前用户的安装列表
  return (
    <main class="desktop">
      <DesktopIcons />
      <WindowLayer />
      <Toasts />
    </main>
  );
};
