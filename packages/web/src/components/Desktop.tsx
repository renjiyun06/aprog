import type { Component } from 'solid-js';
import { WindowLayer } from './Window';
import { DesktopIcons } from './DesktopIcons';

export const Desktop: Component = () => (
  <main class="desktop">
    <DesktopIcons />
    <WindowLayer />
  </main>
);
