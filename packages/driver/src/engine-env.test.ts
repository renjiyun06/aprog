// engine-env · 单测。证明清洗器「藏 driver 私有、留引擎该有」的契约（最小特权）。
// 这条线一旦飘红，意味着 bindToken / git 凭证可能正泄漏给用户程序——属安全回归。

import { test, expect } from 'bun:test';
import { scrubEngineEnv } from './engine-env.ts';

test('删去 bindToken 与全部 APROG_ 控制变量', () => {
  const out = scrubEngineEnv({
    APROG_BIND_TOKEN: 'cap-nonce-xyz',
    APROG_CONTROL_PLANE_URL: 'http://cp/aprog',
    APROG_ANYTHING_ELSE: 'x',
  });
  expect(out).toEqual({});
});

test('保留 ANTHROPIC_*（给引擎用的 GLM 路由凭证）', () => {
  const out = scrubEngineEnv({
    ANTHROPIC_AUTH_TOKEN: 'glm-key',
    ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
    ANTHROPIC_MODEL: 'glm-4.6',
    APROG_BIND_TOKEN: 'cap-nonce',
  });
  expect(out).toEqual({
    ANTHROPIC_AUTH_TOKEN: 'glm-key',
    ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
    ANTHROPIC_MODEL: 'glm-4.6',
  });
});

test('删去已知 git/OAuth 私有凭证，但留普通继承变量', () => {
  const out = scrubEngineEnv({
    GITHUB_TOKEN: 'ghp_secret',
    GH_TOKEN: 'gh_secret',
    SSH_AUTH_SOCK: '/run/ssh',
    PATH: '/usr/bin',
    HOME: '/home/user',
    LANG: 'C.UTF-8',
  });
  expect(out).toEqual({ PATH: '/usr/bin', HOME: '/home/user', LANG: 'C.UTF-8' });
});

test('extraDeny 追加删除 driver 自报的注入凭证', () => {
  const out = scrubEngineEnv(
    { MY_DEPLOY_KEY: 'secret', PATH: '/usr/bin' },
    ['MY_DEPLOY_KEY'],
  );
  expect(out).toEqual({ PATH: '/usr/bin' });
});

test('跳过 undefined 值（未设置的变量不带入）', () => {
  const out = scrubEngineEnv({ FOO: undefined, BAR: 'keep' });
  expect(out).toEqual({ BAR: 'keep' });
});
