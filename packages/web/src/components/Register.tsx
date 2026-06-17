import { createSignal, Show, type Component } from 'solid-js';
import { auth } from '../stores/auth';

/** 注册：只填用户名 + 邮箱；提交后发验证邮件，提示去邮箱点链接激活（设密码在邮件链接落地页完成）。 */
export const Register: Component<{ onBack: () => void }> = (props) => {
  const [username, setUsername] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [err, setErr] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [sent, setSent] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await auth.register(username().trim(), email().trim());
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '注册失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <Show
        when={!sent()}
        fallback={
          <form class="auth-card" onSubmit={(e) => { e.preventDefault(); props.onBack(); }}>
            <div class="auth-title">验证邮件已发送</div>
            <div class="auth-msg">已向 {email()} 发送验证邮件，请点击邮件中的链接设置密码并激活账户。</div>
            <button type="submit" class="auth-btn">返回登录</button>
          </form>
        }
      >
        <form class="auth-card" onSubmit={submit}>
          <div class="auth-title">注册 aprog</div>
          <input class="auth-field" placeholder="用户名" value={username()} onInput={(e) => { setUsername(e.currentTarget.value); setErr(''); }} />
          <div class="auth-hint">字母开头，仅含英文字母和数字，3–32 位</div>
          <input class="auth-field" type="email" placeholder="邮箱" value={email()} onInput={(e) => { setEmail(e.currentTarget.value); setErr(''); }} />
          <Show when={err()}><div class="login-err">{err()}</div></Show>
          <button type="submit" class="auth-btn" disabled={busy()}>{busy() ? '提交中…' : '注册'}</button>
          <div class="auth-link">已有账号？<button type="button" onClick={props.onBack}>返回登录</button></div>
        </form>
      </Show>
      <div class="login-foot">aprog</div>
    </div>
  );
};
