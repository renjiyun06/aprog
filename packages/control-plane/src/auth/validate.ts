// 注册/登录入参校验。校验不过抛 validation（→ 400）。

import { validation } from '../api/errors.ts';

// 用户名：字母开头，仅含英文字母与数字，长度 3–32。
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
// 邮箱：朴素格式校验（本地部分 @ 域名 . 顶级）。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(name: string): void {
  if (name.length < 3 || name.length > 32) throw validation('用户名长度需 3–32');
  if (!USERNAME_RE.test(name)) throw validation('用户名须字母开头，且仅含英文字母和数字');
}

export function validateEmail(email: string): void {
  if (email.length > 254 || !EMAIL_RE.test(email)) throw validation('邮箱格式不正确');
}

export function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 128) throw validation('密码长度需 8–128');
}
