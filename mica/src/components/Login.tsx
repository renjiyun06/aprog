import { createSignal, Show, type Component } from 'solid-js';
import { auth } from '../stores/auth';
import { Avatar } from './Avatar';
import { useClock } from '../stores/system';

/** Win11-style lock/login screen: big clock, account avatar, password field. */
export const Login: Component = () => {
  const { time, date } = useClock();
  const saved = auth.savedProfile();
  const [pwd, setPwd] = createSignal('');
  const [err, setErr] = createSignal('');

  const submit = (e: Event) => {
    e.preventDefault();
    const r = auth.login(saved.username, pwd());
    if (!r.ok) { setErr(r.error ?? '登录失败'); setPwd(''); }
  };

  return (
    <div class="login">
      <div class="login-clock">
        <div class="lc-time">{time()}</div>
        <div class="lc-date">{date()}</div>
      </div>

      <form class="login-card" onSubmit={submit}>
        <Avatar size={96} profile={saved} />
        <div class="login-name">{saved.displayName}</div>
        <div class="login-input-row">
          <input
            type="password"
            placeholder="密码"
            value={pwd()}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={(el) => setTimeout(() => el.focus(), 50)}
            onInput={(e) => { setPwd(e.currentTarget.value); setErr(''); }}
          />
          <button type="submit" class="login-submit" aria-label="登录">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8 H12 M8.5 4.5 L12.5 8 L8.5 11.5" />
            </svg>
          </button>
        </div>
        <Show when={err()}>
          <div class="login-err">{err()}</div>
        </Show>
        <div class="login-hint">demo · {saved.username} / yunjiren123</div>
      </form>

      <div class="login-foot">aprog</div>
    </div>
  );
};
