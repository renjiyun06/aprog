// 发邮件。两个实现：
//   ConsoleEmailSender —— 开发态，把验证链接/登录码打到控制台（无 SMTP 也能走完闭环）。
//   SmtpEmailSender    —— 走 nodemailer 真发信，按 SmtpConfig 配置。
// 选哪个在 http.ts 按 config.smtp 是否存在决定。验证链接指向前端 <webUrl>/?token=…（AuthGate 读 ?token 直达设密码）。

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { SmtpConfig } from '../config.ts';

export interface EmailSender {
  /** 发邮箱验证邮件（内含设密码链接）。 */
  sendVerification(email: string, token: string): Promise<void>;
  /** 发登录验证码邮件。 */
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** 拼验证链接：<webUrl>/?token=…。 */
function verifyLink(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}`;
}

/** 开发用：不真发，打印链接/码到控制台。 */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly webUrl: string) {}
  async sendVerification(email: string, token: string): Promise<void> {
    console.log(`[email→${email}] 验证链接（设密码）: ${verifyLink(this.webUrl, token)}`);
  }
  async sendLoginCode(email: string, code: string): Promise<void> {
    console.log(`[email→${email}] 登录验证码: ${code}`);
  }
}

/** 生产用：nodemailer SMTP。 */
export class SmtpEmailSender implements EmailSender {
  private readonly tx: Transporter;
  constructor(
    private readonly cfg: SmtpConfig,
    private readonly webUrl: string,
  ) {
    this.tx = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  async sendVerification(email: string, token: string): Promise<void> {
    const link = verifyLink(this.webUrl, token);
    await this.tx.sendMail({
      from: this.cfg.from,
      to: email,
      subject: 'aprog · 验证邮箱并设置密码',
      text: `欢迎注册 aprog。请打开以下链接完成验证并设置密码（24 小时内有效）：\n${link}`,
      html: `<p>欢迎注册 aprog。</p><p>请点击完成验证并设置密码（24 小时内有效）：</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  async sendLoginCode(email: string, code: string): Promise<void> {
    await this.tx.sendMail({
      from: this.cfg.from,
      to: email,
      subject: 'aprog · 登录验证码',
      text: `你的 aprog 登录验证码是 ${code}（10 分钟内有效）。`,
      html: `<p>你的 aprog 登录验证码是 <b style="font-size:18px">${code}</b>（10 分钟内有效）。</p>`,
    });
  }
}
