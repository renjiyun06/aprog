// 事件流中枢单测：store 盖序/回放、hub 扇出、resync 回放→续 live 的去重交接（最易错的一处）。
import { test, expect } from 'bun:test';
import type { Event } from '@aprog/protocol';
import { MemoryStreamStore } from './store.ts';
import { MemoryStreamHub } from './hub.ts';
import { resyncThenLive } from './resync.ts';

/** 造一个最小事件（只关心 seq；其余字段足够通过类型/运行）。 */
function ev(id: string): Omit<Event, 'seq'> {
  return { kind: 'item.start', id, item_type: 'reply', ts: 't' } as unknown as Omit<Event, 'seq'>;
}
/** 造一个带 seq 的 live 事件（直接喂 hub.publish 用）。 */
function live(seq: number): Event {
  return { kind: 'item.delta', id: 'x', ts: 't', seq } as unknown as Event;
}

test('MemoryStreamStore：append 盖单调 seq（覆盖入参 seq），readFrom 从游标回放，head', async () => {
  const s = new MemoryStreamStore();
  const e1 = await s.append(1, ev('a'));
  const e2 = await s.append(1, ev('b'));
  expect([e1.seq, e2.seq]).toEqual([1, 2]);
  expect(await s.head(1)).toBe(2);

  const got: number[] = [];
  for await (const e of s.readFrom(1, 1)) got.push(e.seq); // 只回放 seq > 1
  expect(got).toEqual([2]);

  // 入参带的 seq 被覆盖成全局序
  const e3 = await s.append(1, { kind: 'item.end', id: 'b', ts: 't', seq: 999 } as unknown as Omit<Event, 'seq'>);
  expect(e3.seq).toBe(3);

  // 进程隔离
  const o = await s.append(2, ev('z'));
  expect(o.seq).toBe(1);
});

test('MemoryStreamHub：publish 扇出多订阅者，unsub 后不再收，进程间隔离', () => {
  const h = new MemoryStreamHub();
  const a: number[] = [];
  const b: number[] = [];
  const unsubA = h.subscribe(1, (e) => a.push(e.seq));
  h.subscribe(1, (e) => b.push(e.seq));

  h.publish(1, live(1));
  unsubA();
  h.publish(1, live(2));
  h.publish(2, live(9)); // 别的进程

  expect(a).toEqual([1]); // unsub 后收不到 2
  expect(b).toEqual([1, 2]); // 2 收到，9（pid=2）不串
});

test('resyncThenLive：回放历史 → 续 live，交接点按 seq 去重', async () => {
  const store = new MemoryStreamStore();
  const hub = new MemoryStreamHub();
  const pid = 1;
  await store.append(pid, ev('a')); // seq1
  await store.append(pid, ev('b')); // seq2
  await store.append(pid, ev('c')); // seq3

  const gen = resyncThenLive(store, hub, pid, { from: 0 })[Symbol.asyncIterator]();

  // 1) 回放 seq 1,2,3
  expect((await gen.next()).value.seq).toBe(1);
  expect((await gen.next()).value.seq).toBe(2);
  expect((await gen.next()).value.seq).toBe(3);

  // 2) 续 live：第 4 次 next 先挂起，publish 后 yield 4
  const n4 = gen.next();
  const s4 = await store.append(pid, ev('d'));
  hub.publish(pid, s4);
  expect((await n4).value.seq).toBe(4);

  // 3) 去重：重复的 seq3（≤ 已回放最大 4）被跳过，紧接的 seq5 才 yield
  const n5 = gen.next();
  hub.publish(pid, live(3)); // 与回放重叠，跳过
  const s5 = await store.append(pid, ev('e'));
  hub.publish(pid, s5);
  expect((await n5).value.seq).toBe(5);

  await gen.return?.(undefined);
});
