// 鉴权基座 · 单测。内存库跑完整注册→验证→设密码→多模式登录闭环 + 校验规则。不起 HTTP。

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyMigrations } from '../db/index.ts';
import { UserStore } from './users.ts';
import { TokenStore } from './tokens.ts';
import { CodeStore } from './codes.ts';
import { validateUsername, validateEmail, validatePassword } from './validate.ts';

function stores() {
  const db = new Database(':memory:');
  applyMigrations(db);
  return { users: new UserStore(db), tokens: new TokenStore(db), codes: new CodeStore(db) };
}

test('注册→邮箱验证→设密码→激活，全程', async () => {
  const { users, codes } = stores();

  const u = users.createPending('lamarck', 'a@b.com'); // pending、无密码
  expect(users.nameTaken('LAMARCK')).toBe(false); // 未激活不占用标识符（大小写不敏感判断本身仍生效）
  expect(users.emailTaken('A@B.com')).toBe(false);
  expect(await users.verifyByName('lamarck', 'whatever')).toBeUndefined(); // 未激活不能登

  const token = codes.createVerify(u.id);
  expect(codes.consumeVerify(token)).toBe(u.id);
  expect(codes.consumeVerify(token)).toBeUndefined(); // 一次性

  await users.setPassword(u.id, 'secret12');
  expect(users.nameTaken('LAMARCK')).toBe(true); // 激活后才占用
  expect(users.emailTaken('A@B.com')).toBe(true);
  expect(await users.verifyByName('lamarck', 'secret12')).toMatchObject({ name: 'lamarck', email: 'a@b.com' });
  expect(await users.verifyByEmail('a@b.com', 'secret12')).toMatchObject({ id: u.id });
  expect(await users.verifyByName('lamarck', 'wrong')).toBeUndefined();
});

test('未激活用户不占用标识符：可被重新注册；旧 pending 被回收；激活后才占用', async () => {
  const { users, codes } = stores();
  const first = users.createPending('alice', 'alice@x.com');
  codes.createVerify(first.id); // 旧验证码

  // 同名同邮箱重注册：允许，且旧 pending（含其验证码）被回收。
  const second = users.createPending('alice', 'alice@x.com');
  expect(second.id).not.toBe(first.id);
  expect(users.getById(first.id)).toBeUndefined(); // 旧 pending 已删除

  // 激活第二个后才占用标识符。
  const token = codes.createVerify(second.id);
  expect(codes.consumeVerify(token)).toBe(second.id);
  await users.setPassword(second.id, 'secret12');
  expect(users.nameTaken('ALICE')).toBe(true);
  expect(users.emailTaken('ALICE@X.com')).toBe(true);
});

test('邮箱+验证码登录', async () => {
  const { users, codes } = stores();
  const u = users.createPending('tom', 't@x.com');
  await users.setPassword(u.id, 'secret12'); // 激活

  expect(users.activeByEmail('t@x.com')).toMatchObject({ id: u.id });
  const code = codes.createLogin(u.id);
  expect(code).toMatch(/^\d{6}$/);
  expect(codes.consumeLogin(u.id, '000000')).toBe(false); // 错码
  expect(codes.consumeLogin(u.id, code)).toBe(true);
  expect(codes.consumeLogin(u.id, code)).toBe(false); // 一次性
});

test('会话 token：签发 → 解析 → 吊销', async () => {
  const { users, tokens } = stores();
  const u = users.createPending('z', 'z@z.com');
  await users.setPassword(u.id, 'secret12');
  const { token } = tokens.issue(u.id);
  expect(tokens.resolve(token)).toBe(u.id);
  tokens.revoke(token);
  expect(tokens.resolve(token)).toBeUndefined();
});

test('校验规则', () => {
  // 用户名：字母开头、字母数字、3–32
  expect(() => validateUsername('ab')).toThrow();        // 太短
  expect(() => validateUsername('1abc')).toThrow();       // 数字开头
  expect(() => validateUsername('a_bc')).toThrow();       // 含下划线
  expect(() => validateUsername('lamarck01')).not.toThrow();
  // 邮箱
  expect(() => validateEmail('nope')).toThrow();
  expect(() => validateEmail('a@b.com')).not.toThrow();
  // 密码
  expect(() => validatePassword('short')).toThrow();
  expect(() => validatePassword('longenough')).not.toThrow();
});
