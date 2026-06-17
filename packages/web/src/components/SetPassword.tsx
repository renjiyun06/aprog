import { createSignal, Show, type Component } from 'solid-js';
import { auth } from '../stores/auth';

/** 设密码（邮箱验证落地）：用户从注册邮件里的链接进入，token 已随 ?token= 带上，此处只填密码完成激活。 */
export const SetPassword: Component<{ token: string; onDone: () => void }> = (props) => {
  const [pwd, setPwd] = createSignal('');
  const [pwd2, setPwd2] = createSignal('');
  const [err, setErr] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setErr('');
    if (props.token.trim() === '') {
      setErr('链接无效，请从注册邮件中的链接进入');
      return;
    }
    if (pwd() !== pwd2()) {
      setErr('两次密码不一致');
      return;
    }
    setBusy(true);
    try {
      await auth.setPassword(props.token.trim(), pwd());
      props.onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '设置失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <form class="auth-card" onSubmit={submit}>
        <div class="auth-title">设置密码</div>
        <div class="auth-msg">设置登录密码以激活账户。</div>
        <input class="auth-field" type="password" placeholder="设置密码（≥8 位）" value={pwd()} onInput={(e) => { setPwd(e.currentTarget.value); setErr(''); }} />
        <input class="auth-field" type="password" placeholder="确认密码" value={pwd2()} onInput={(e) => { setPwd2(e.currentTarget.value); setErr(''); }} />
        <Show when={err()}><div class="login-err">{err()}</div></Show>
        <button type="submit" class="auth-btn" disabled={busy()}>{busy() ? '提交中…' : '设置并激活'}</button>
        <div class="auth-link"><button type="button" onClick={props.onDone}>返回登录</button></div>
      </form>
      <div class="login-foot">aprog</div>
    </div>
  );
};
