import { createSignal, Show, For, type Component, type JSX } from 'solid-js';
import { auth } from '../../stores/auth';
import { Avatar } from '../../components/Avatar';

type Section = 'account' | 'signin' | 'personalization' | 'about';

/** Win11-style Settings app: left nav + scrolling content pane.
 *  Returns a fragment so window-body (flex row) lays sidebar + content
 *  side by side — the content pane reaches the window's right edge, so its
 *  scrollbar sits flush against the window border. */
export const Settings: Component = () => {
  const [section, setSection] = createSignal<Section>('account');

  // account
  const [name, setName] = createSignal(auth.user()?.displayName ?? '');
  const [nameMsg, setNameMsg] = createSignal('');

  // password
  const [oldP, setOldP] = createSignal('');
  const [newP, setNewP] = createSignal('');
  const [cfP, setCfP] = createSignal('');
  const [pErr, setPErr] = createSignal('');
  const [pOk, setPOk] = createSignal('');

  const onUpload = (e: Event & { currentTarget: HTMLInputElement }) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => auth.updateProfile({ avatar: String(reader.result) });
    reader.readAsDataURL(f);
    e.currentTarget.value = '';
  };
  const saveName = () => {
    const v = name().trim();
    if (!v) return;
    auth.updateProfile({ displayName: v });
    setNameMsg('已保存');
    setTimeout(() => setNameMsg(''), 1500);
  };
  const changePwd = () => {
    setPErr(''); setPOk('');
    if (newP() !== cfP()) { setPErr('两次输入的新密码不一致'); return; }
    const r = auth.changePassword(oldP(), newP());
    if (!r.ok) { setPErr(r.error ?? '修改失败'); return; }
    setPOk('密码已更新');
    setOldP(''); setNewP(''); setCfP('');
    setTimeout(() => setPOk(''), 2000);
  };

  const nav: { id: Section; label: string; icon: JSX.Element }[] = [
    { id: 'account', label: '账户', icon: (
      <svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.6"/><path d="M3 13.5 a5 5 0 0 1 10 0"/></svg>
    ) },
    { id: 'signin', label: '登录选项', icon: (
      <svg viewBox="0 0 16 16"><circle cx="5.5" cy="8" r="2.6"/><path d="M8 8 H14 M12 8 V10.5 M14 8 V11"/></svg>
    ) },
    { id: 'personalization', label: '个性化', icon: (
      <svg viewBox="0 0 16 16"><path d="M8 2 C4.5 2 2 4.5 2 8 c0 2.4 1.8 3.6 3.5 3.2 0.9-0.2 1.3 0.6 1 1.4 -0.3 1.1 0.9 1.6 1.9 1.4 C11.6 13.4 14 10.8 14 8 14 4.4 11.5 2 8 2 Z"/><circle cx="5.5" cy="6.5" r="0.7" fill="currentColor" stroke="none"/><circle cx="9" cy="5" r="0.7" fill="currentColor" stroke="none"/></svg>
    ) },
    { id: 'about', label: '关于', icon: (
      <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 7.2 V11 M8 5 V5.4"/></svg>
    ) },
  ];

  return (
    <>
      <aside class="set-sidebar">
        <div class="set-acct">
          <Avatar size={44} />
          <div class="set-acct-id">
            <div class="set-acct-name">{auth.user()?.displayName}</div>
            <div class="set-acct-user">{auth.user()?.username}</div>
          </div>
        </div>
        <nav class="set-nav">
          <For each={nav}>{(n) => (
            <button class={`set-nav-item ${section() === n.id ? 'active' : ''}`} onClick={() => setSection(n.id)}>
              {n.icon}<span>{n.label}</span>
            </button>
          )}</For>
        </nav>
      </aside>

      <main class="set-content">
        <div class="set-inner">

          {/* ── 账户 ── */}
          <Show when={section() === 'account'}>
            <h1 class="set-h1">账户</h1>
            <section class="set-card">
              <div class="set-avatar-row">
                <Avatar size={72} />
                <div class="set-avatar-actions">
                  <label class="btn allow file-btn">
                    更换头像
                    <input type="file" accept="image/*" onChange={onUpload} hidden />
                  </label>
                  <Show when={auth.user()?.avatar}>
                    <button class="btn deny" onClick={() => auth.updateProfile({ avatar: null })}>移除头像</button>
                  </Show>
                </div>
              </div>
              <div class="set-field">
                <label>显示名称</label>
                <div class="set-inline">
                  <input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                  <button class="btn allow" onClick={saveName}>保存</button>
                  <Show when={nameMsg()}><span class="set-ok">{nameMsg()}</span></Show>
                </div>
              </div>
              <div class="set-field">
                <label>用户名</label>
                <input value={auth.user()?.username ?? ''} disabled />
              </div>
            </section>
          </Show>

          {/* ── 登录选项 ── */}
          <Show when={section() === 'signin'}>
            <h1 class="set-h1">登录选项</h1>
            <section class="set-card">
              <div class="set-card-title">更改密码</div>
              <div class="set-field">
                <label>当前密码</label>
                <input type="password" value={oldP()} onInput={(e) => setOldP(e.currentTarget.value)} />
              </div>
              <div class="set-field">
                <label>新密码</label>
                <input type="password" value={newP()} onInput={(e) => setNewP(e.currentTarget.value)} />
              </div>
              <div class="set-field">
                <label>确认新密码</label>
                <input type="password" value={cfP()} onInput={(e) => setCfP(e.currentTarget.value)} />
              </div>
              <div class="set-inline">
                <button class="btn allow" onClick={changePwd}>更改密码</button>
                <Show when={pErr()}><span class="set-err">{pErr()}</span></Show>
                <Show when={pOk()}><span class="set-ok">{pOk()}</span></Show>
              </div>
            </section>
          </Show>

          {/* ── 个性化 (stub) ── */}
          <Show when={section() === 'personalization'}>
            <h1 class="set-h1">个性化</h1>
            <section class="set-card">
              <div class="set-empty">壁纸、主题色、深浅模式等设置项将放在这里.</div>
            </section>
          </Show>

          {/* ── 关于 ── */}
          <Show when={section() === 'about'}>
            <h1 class="set-h1">关于</h1>
            <section class="set-card">
              <div class="set-about-row"><span class="k">系统</span><span class="v">aprog · mica shell</span></div>
              <div class="set-about-row"><span class="k">版本</span><span class="v mono">0.1.0-dev</span></div>
              <div class="set-about-row"><span class="k">前端</span><span class="v mono">SolidJS · Vite</span></div>
              <div class="set-about-row"><span class="k">账户</span><span class="v mono">{auth.user()?.username}</span></div>
            </section>
          </Show>

        </div>
      </main>
    </>
  );
};
