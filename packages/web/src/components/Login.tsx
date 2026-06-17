import { createSignal, Show, onCleanup, type Component } from 'solid-js';
import { auth } from '../stores/auth';

/** 登录：密码登录（用户名/邮箱 + 密码）/ 验证码登录（邮箱 + 验证码）。成功后 App 监听 isAuthed 自动进桌面。 */
export const Login: Component<{ onRegister: () => void }> = (props) => {
  const [mode, setMode] = createSignal<'password' | 'code'>('password');
  const [id, setId] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [pwd, setPwd] = createSignal('');
  const [code, setCode] = createSignal('');
  const [err, setErr] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [cooldown, setCooldown] = createSignal(0); // 重发倒计时（秒）
  const [codeSent, setCodeSent] = createSignal(false);
  const [sending, setSending] = createSignal(false);

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : '登录失败');

  let timer: ReturnType<typeof setInterval> | undefined;
  const startCooldown = () => {
    setCooldown(60);
    timer = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(timer); timer = undefined; return 0; }
        return s - 1;
      });
    }, 1000);
  };
  onCleanup(() => { if (timer !== undefined) clearInterval(timer); });

  // 发送按钮文案：倒计时 → 发送中 → 已发过则「重新获取」→ 首次「获取验证码」。
  const codeBtnLabel = () =>
    cooldown() > 0 ? `${cooldown()}s 后重发` : sending() ? '发送中…' : codeSent() ? '重新获取' : '获取验证码';

  const submit = async (e: Event) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode() === 'password') await auth.loginWithPassword(id().trim(), pwd());
      else await auth.loginWithCode(email().trim(), code().trim());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const getCode = async () => {
    setErr('');
    setMsg('');
    if (email().trim() === '') {
      setErr('请先填邮箱');
      return;
    }
    if (cooldown() > 0 || sending()) return;
    setSending(true);
    try {
      await auth.requestLoginCode(email().trim());
      setCodeSent(true);
      setMsg('验证码已发送');
      startCooldown();
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div class="login">
      <form class="auth-card" onSubmit={submit}>
        <div class="auth-title">登录 aprog</div>
        <div class="auth-tabs">
          <button type="button" classList={{ 'auth-tab': true, on: mode() === 'password' }} onClick={() => { setMode('password'); setErr(''); setMsg(''); }}>密码登录</button>
          <button type="button" classList={{ 'auth-tab': true, on: mode() === 'code' }} onClick={() => { setMode('code'); setErr(''); setMsg(''); }}>验证码登录</button>
        </div>

        <div class="auth-fields">
          <Show when={mode() === 'password'}>
            <input class="auth-field" placeholder="用户名 / 邮箱" value={id()} onInput={(e) => { setId(e.currentTarget.value); setErr(''); }} />
            <input class="auth-field" type="password" placeholder="密码" value={pwd()} onInput={(e) => { setPwd(e.currentTarget.value); setErr(''); }} />
          </Show>
          <Show when={mode() === 'code'}>
            <input class="auth-field" type="email" placeholder="邮箱" value={email()} onInput={(e) => { setEmail(e.currentTarget.value); setErr(''); }} />
            <div class="auth-row">
              <input class="auth-field" placeholder="验证码" value={code()} onInput={(e) => { setCode(e.currentTarget.value); setErr(''); }} />
              <button type="button" class="auth-btn ghost" disabled={cooldown() > 0 || sending()} onClick={getCode}>{codeBtnLabel()}</button>
            </div>
          </Show>
        </div>

        <Show when={msg()}><div class="auth-msg">{msg()}</div></Show>
        <Show when={err()}><div class="login-err">{err()}</div></Show>

        <button type="submit" class="auth-btn" disabled={busy()}>{busy() ? '登录中…' : '登录'}</button>
        <div class="auth-link">没有账号？<button type="button" onClick={props.onRegister}>注册</button></div>
      </form>
      <div class="login-foot">aprog</div>
    </div>
  );
};
