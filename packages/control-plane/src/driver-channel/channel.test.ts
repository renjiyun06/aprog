// driver 通道 · 单测。喂假 ws 验证唤醒闭环的帧交换，不起 WS/网络：
//   Hello（合法 bindToken）→ Welcome + Seed；driver Ready → onReady(pid)；RenewRepo → RepoToken；坏握手 → 关连接。

import { test, expect } from 'bun:test';
import { CHANNEL_PROTOCOL_VERSION, type RepoCredential, type Seed } from '@aprog/protocol/channel';
import { DriverRegistry } from './registry.ts';
import { DriverChannelServer } from './channel.ts';

interface FakeWs {
  data: { pid?: number; sandboxId?: string };
  sent: string[];
  closed?: { code: number; reason?: string };
  send(s: string): void;
  close(code: number, reason?: string): void;
}

function fakeWs(): FakeWs {
  return {
    data: {},
    sent: [],
    send(s) {
      this.sent.push(s);
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

function setup() {
  const registry = new DriverRegistry();
  const readied: number[] = [];
  const seedP: Seed['p'] = {
    pid: '7',
    program: { id: 'design', version: '0.4.0' },
    registry: 'ghcr.io/renjiyun06',
    repoUrl: 'https://mock-git.local/aprog/aprog-proc-7.git',
    mode: 'restore',
  };
  // 续签桩：只为 pid=7 重签一张「新票」（区别于首发，便于断言）。
  const renewedCred: RepoCredential = {
    url: 'https://x-access-token:renewed@github.com/aprog/aprog-proc-7.git',
    token: 'renewed',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const events: { pid: number; event: unknown }[] = [];
  const server = new DriverChannelServer(
    registry,
    async (pid) => (pid === 7 ? seedP : undefined),
    (pid) => {
      readied.push(pid);
    },
    async (pid) => (pid === 7 ? renewedCred : undefined),
    (pid, event) => {
      events.push({ pid, event });
    },
  );
  return { registry, server, readied, seedP, renewedCred, events };
}

/** Seed 是握手后异步下发（签票要 await）；冲洗微任务/计时器队列让它落地。 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const feed = (server: DriverChannelServer, ws: FakeWs, frame: unknown): void =>
  // @ts-expect-error fakeWs 鸭子类型替身（仅实现测试用到的 data/send/close）
  server.websocket.message(ws, JSON.stringify(frame));

test('Hello（合法 bindToken）→ Welcome（同步）+ Seed（异步），连接钉到 pid', async () => {
  const { registry, server, seedP } = setup();
  registry.register('tok-7', { pid: 7, sandboxId: 'sbx-7' });
  const ws = fakeWs();

  feed(server, ws, { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, bindToken: 'tok-7' } });

  expect(ws.data.pid).toBe(7);
  expect(ws.data.sandboxId).toBe('sbx-7');
  // Welcome 同步先发；Seed 在签票后异步补发。
  const welcome = JSON.parse(ws.sent[0]!);
  expect(welcome.t).toBe('welcome');
  expect(welcome.p.pid).toBe('7');
  await tick();
  expect(ws.sent).toHaveLength(2);
  const seed = JSON.parse(ws.sent[1]!);
  expect(seed.t).toBe('seed');
  expect(seed.p).toEqual(seedP);
  expect(ws.closed).toBeUndefined();
});

test('握手后 driver Ready → onReady(pid)（waking→running 的回流信号）', () => {
  const { registry, server, readied } = setup();
  registry.register('tok-7', { pid: 7, sandboxId: 'sbx-7' });
  const ws = fakeWs();
  feed(server, ws, { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, bindToken: 'tok-7' } });

  feed(server, ws, { t: 'ready', p: { pid: '7' } });

  expect(readied).toEqual([7]);
});

test('Ready 早于握手（无 pid）→ 忽略，不触发 onReady', () => {
  const { server, readied } = setup();
  const ws = fakeWs();
  feed(server, ws, { t: 'ready', p: { pid: '7' } });
  expect(readied).toHaveLength(0);
});

test('握手后 RenewRepo → 回 RepoToken（重签的仓库短票）', async () => {
  const { registry, server, renewedCred } = setup();
  registry.register('tok-7', { pid: 7, sandboxId: 'sbx-7' });
  const ws = fakeWs();
  feed(server, ws, { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, bindToken: 'tok-7' } });
  await tick(); // 先让 Seed 落地（sent[1]）

  feed(server, ws, { t: 'renew-repo', p: { pid: '7' } });
  await tick(); // 续签签票异步

  const rt = JSON.parse(ws.sent.at(-1)!);
  expect(rt.t).toBe('repo-token');
  expect(rt.p.pid).toBe('7');
  expect(rt.p.repoCredential).toEqual(renewedCred);
});

test('RenewRepo 早于握手（无 pid）→ 忽略，不回任何帧', async () => {
  const { server } = setup();
  const ws = fakeWs();
  feed(server, ws, { t: 'renew-repo', p: { pid: '7' } });
  await tick();
  expect(ws.sent).toHaveLength(0);
});

test('握手后 EngineEvent → onEvent(绑定 pid, harness 事件)', () => {
  const { registry, server, events } = setup();
  registry.register('tok-7', { pid: 7, sandboxId: 'sbx-7' });
  const ws = fakeWs();
  feed(server, ws, { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, bindToken: 'tok-7' } });

  const event = { kind: 'item.delta', id: 'm:0', ts: 't', seq: 3, patch: { kind: 'text', text: 'hi' } };
  feed(server, ws, { t: 'event', p: { event } });

  expect(events).toEqual([{ pid: 7, event }]); // pid 取连接绑定者，事件原样透出
});

test('EngineEvent 早于握手（无 pid）→ 忽略，不触发 onEvent', () => {
  const { server, events } = setup();
  const ws = fakeWs();
  feed(server, ws, { t: 'event', p: { event: { kind: 'turn.start', turn: 't', ts: 't', seq: 1 } } });
  expect(events).toHaveLength(0);
});

test('协议版本不符 → 关连接 1002，不回任何帧', () => {
  const { registry, server } = setup();
  registry.register('tok-7', { pid: 7, sandboxId: 'sbx-7' });
  const ws = fakeWs();
  feed(server, ws, { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION + 99, bindToken: 'tok-7' } });
  expect(ws.closed?.code).toBe(1002);
  expect(ws.sent).toHaveLength(0);
});

test('未知 bindToken → 关连接 1008', () => {
  const { server } = setup();
  const ws = fakeWs();
  feed(server, ws, { t: 'hello', p: { protocolVersion: CHANNEL_PROTOCOL_VERSION, bindToken: 'nope' } });
  expect(ws.closed?.code).toBe(1008);
  expect(ws.sent).toHaveLength(0);
});
