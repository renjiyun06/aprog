import { Show, type Component } from 'solid-js';
import { Desktop } from './components/Desktop';
import { Taskbar } from './components/Taskbar';
import { AuthGate } from './components/AuthGate';
import { auth } from './stores/auth';

export const App: Component = () => (
  <Show when={auth.isAuthed()} fallback={<AuthGate />}>
    <Desktop />
    <Taskbar />
  </Show>
);
