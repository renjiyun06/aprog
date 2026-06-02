import { Show, type Component } from 'solid-js';
import { Desktop } from './components/Desktop';
import { Taskbar } from './components/Taskbar';
import { Login } from './components/Login';
import { auth } from './stores/auth';

export const App: Component = () => (
  <Show when={auth.isAuthed()} fallback={<Login />}>
    <Desktop />
    <Taskbar />
  </Show>
);
