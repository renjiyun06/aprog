import { createSignal, Switch, Match, type Component } from 'solid-js';
import { Login } from './Login';
import { Register } from './Register';
import { SetPassword } from './SetPassword';

/** 未登录时的入口：登录 / 注册 / 设密码 三屏切换。带 ?token= 进来直接到设密码（邮件验证落地）。 */
export const AuthGate: Component = () => {
  const urlToken = new URL(location.href).searchParams.get('token') ?? '';
  const [view, setView] = createSignal<'login' | 'register' | 'set-password'>(urlToken !== '' ? 'set-password' : 'login');

  return (
    <Switch>
      <Match when={view() === 'login'}>
        <Login onRegister={() => setView('register')} />
      </Match>
      <Match when={view() === 'register'}>
        <Register onBack={() => setView('login')} />
      </Match>
      <Match when={view() === 'set-password'}>
        <SetPassword token={urlToken} onDone={() => setView('login')} />
      </Match>
    </Switch>
  );
};
