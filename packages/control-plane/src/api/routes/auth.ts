// 路由 · 鉴权。
//   POST /auth/register      {username,email} → 建 pending 用户 + 发验证邮件（公开）
//   POST /auth/set-password  {token,password} → 验证邮箱 token + 设密码激活（公开）
//   POST /auth/login-code    {email}          → 给已激活邮箱发 6 位登录码（公开）
//   POST /auth/login         用户名+密码 / 邮箱+密码 / 邮箱+验证码（公开）
//   POST /auth/logout        失效当前 token（需登录）

import type { Router } from '../router.ts';
import type { ReqCtx, AuthCtx, User } from '../context.ts';
import { withErrors, unauthorized, validation, conflict } from '../errors.ts';
import { withAuth } from '../middleware/auth.ts';
import { json, noContent, accepted, readJson } from '../respond.ts';
import { validateUsername, validateEmail, validatePassword } from '../../auth/validate.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** POST /auth/register — 注册：只要 username + email，发验证邮件。 */
async function register(ctx: ReqCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const username = str(b.username).trim();
  const email = str(b.email).trim();
  validateUsername(username);
  validateEmail(email);
  const { users, codes, email: mailer } = ctx.deps;
  if (users.nameTaken(username)) throw conflict('用户名已被占用');
  if (users.emailTaken(email)) throw conflict('邮箱已被注册');
  const user = users.createPending(username, email);
  await mailer.sendVerification(email, codes.createVerify(user.id));
  return accepted({ ok: true });
}

/** POST /auth/set-password — 邮箱验证 token 校验通过即设密码并激活。 */
async function setPassword(ctx: ReqCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const token = str(b.token);
  const password = str(b.password);
  if (token === '') throw validation('缺少验证 token');
  validatePassword(password);
  const userId = ctx.deps.codes.consumeVerify(token);
  if (userId === undefined) throw validation('验证链接无效或已过期');
  await ctx.deps.users.setPassword(userId, password);
  return noContent();
}

/** POST /auth/login-code — 给已激活邮箱发登录验证码。防枚举：无论邮箱是否存在都回 202。 */
async function loginCode(ctx: ReqCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const email = str(b.email).trim();
  validateEmail(email);
  const user = ctx.deps.users.activeByEmail(email);
  if (user !== undefined) {
    await ctx.deps.email.sendLoginCode(email, ctx.deps.codes.createLogin(user.id));
  }
  return accepted({ ok: true });
}

/** POST /auth/login — 用户名+密码 / 邮箱+密码 / 邮箱+验证码，成功签发会话 token。 */
async function login(ctx: ReqCtx): Promise<Response> {
  const b = await readJson(ctx.req);
  const username = str(b.username).trim();
  const email = str(b.email).trim();
  const password = str(b.password);
  const code = str(b.code).trim();

  let user: User | undefined;
  if (code !== '') {
    if (email === '') throw validation('验证码登录需提供邮箱');
    const u = ctx.deps.users.activeByEmail(email);
    if (u !== undefined && ctx.deps.codes.consumeLogin(u.id, code)) user = u;
  } else if (password !== '') {
    if (username !== '') user = await ctx.deps.users.verifyByName(username, password);
    else if (email !== '') user = await ctx.deps.users.verifyByEmail(email, password);
    else throw validation('需提供用户名或邮箱');
  } else {
    throw validation('需提供密码或验证码');
  }

  if (user === undefined) throw unauthorized('登录失败：凭据不正确');
  const { token, expiresAt } = ctx.deps.tokens.issue(user.id);
  return json({ token, expiresAt, user });
}

/** POST /auth/logout — 失效当前 token。 */
async function logout(ctx: AuthCtx): Promise<Response> {
  const m = (ctx.req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (m !== null) ctx.deps.tokens.revoke(m[1]!);
  return noContent();
}

export function mount(r: Router): void {
  r.add('POST', '/auth/register', withErrors(register));
  r.add('POST', '/auth/set-password', withErrors(setPassword));
  r.add('POST', '/auth/login-code', withErrors(loginCode));
  r.add('POST', '/auth/login', withErrors(login));
  r.add('POST', '/auth/logout', withErrors(withAuth(logout)));
}
