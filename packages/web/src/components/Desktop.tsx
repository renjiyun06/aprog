import type { Component } from 'solid-js';
import { WindowLayer } from './Window';
import { DesktopIcons } from './DesktopIcons';
import { Toasts } from './Toasts';

export const Desktop: Component = () => (
  <main class="desktop">
    <DesktopIcons />
    <WindowLayer />
    <Toasts />
  </main>
);
