// control-plane 运行配置。从环境变量读（占位默认值便于本地起）。
// provider 各自的配置形状（如 DaytonaConfig）住在 @aprog/sandbox——它是 provider 入参契约，
// 这里只 import 再组合进总 Config。

import type { DaytonaConfig } from '@aprog/sandbox';
import type { GitHubRepoConfig } from './process/repo-gateway.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  /** API 监听端口。 */
  port: number;
  /** 进程目录、快照、控制平面库的统一根。默认 ~/.aprog（对齐进程目录 ~/.aprog/&lt;pid&gt;/ 约定，
   *  本机开发免 root；生产用 APROG_DATA_DIR 覆盖到 /var/lib/aprog 等）。 */
  dataDir: string;
  /** driver 拨回的控制平面地址（注入沙箱环境，driver 据此回连）。 */
  controlPlaneUrl: string;
  /** 前端基址：邮件里的验证链接指向它（<url>/?token=…）。 */
  webUrl: string;
  /** SMTP 发信配置；未设则回退到 console 打印（开发态）。 */
  smtp?: SmtpConfig;
  /** 沙箱提供方配置。 */
  sandbox: {
    provider: 'daytona';
    daytona: DaytonaConfig;
  };
  /** 进程仓库提供方（GitHub）。未配 GITHUB_TOKEN 则为 undefined（→ MockRepoGateway，造假 URL）。 */
  github?: GitHubRepoConfig;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true=隐式 TLS（一般 465）；false=STARTTLS（一般 587）。 */
  secure: boolean;
  user: string;
  pass: string;
  /** 发件人（可含显示名，如 `aprog <no-reply@x.com>`）；缺省用 user。 */
  from: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APROG_PORT ?? 8099),
    dataDir: process.env.APROG_DATA_DIR ?? join(homedir(), '.aprog'),
    controlPlaneUrl: process.env.APROG_CONTROL_PLANE_URL ?? 'https://localhost:8099',
    webUrl: process.env.APROG_WEB_URL ?? 'https://localhost:5174',
    smtp: loadSmtp(),
    github: loadGithub(),
    sandbox: {
      provider: 'daytona',
      daytona: {
        apiKey: process.env.DAYTONA_API_KEY,
        apiUrl: process.env.DAYTONA_API_URL,
        target: process.env.DAYTONA_TARGET,
        createTimeoutSec: Number(process.env.APROG_DAYTONA_CREATE_TIMEOUT_SEC ?? 120),
        destroyTimeoutSec: Number(process.env.APROG_DAYTONA_DESTROY_TIMEOUT_SEC ?? 60),
        maxRetries: Number(process.env.APROG_DAYTONA_MAX_RETRIES ?? 2),
        autoStopIntervalMin: Number(process.env.APROG_DAYTONA_AUTOSTOP_MIN ?? 30),
      },
    },
  };
}

/** 从环境变量读 GitHub 仓库配置；未设 GITHUB_TOKEN 则返回 undefined（回退 MockRepoGateway）。
 *  GITHUB_OWNER：org 名或用户名；GITHUB_OWNER_IS_ORG：是否组织（默认 true）。 */
function loadGithub(): GitHubRepoConfig | undefined {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token === '') return undefined;
  return {
    token,
    owner: process.env.GITHUB_OWNER ?? '',
    ownerIsOrg: (process.env.GITHUB_OWNER_IS_ORG ?? 'true') === 'true',
  };
}

/** 从环境变量读 SMTP；未设 APROG_SMTP_HOST 则返回 undefined（回退 console）。 */
function loadSmtp(): SmtpConfig | undefined {
  const host = process.env.APROG_SMTP_HOST;
  if (host === undefined || host === '') return undefined;
  const user = process.env.APROG_SMTP_USER ?? '';
  return {
    host,
    port: Number(process.env.APROG_SMTP_PORT ?? 465),
    secure: (process.env.APROG_SMTP_SECURE ?? 'true') === 'true',
    user,
    pass: process.env.APROG_SMTP_PASS ?? '',
    from: process.env.APROG_SMTP_FROM ?? user,
  };
}
