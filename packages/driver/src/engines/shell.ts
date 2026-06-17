// 共享 · I/O 壳（引擎无关）。把「读字节流 / 分行 / JSON.parse / 折转换核 / 盖 ts」这套
// 副作用管线包在纯转换核外面。纯核(transduce)只管映射，时钟与流在这里——拆开才能金标测试。
//
// 注：这里按 NDJSON（一行一个原生事件）消费 supervisor.stdout，适配 `codex exec --json`。
// 对 Claude-via-SDK，壳可改成直接消费 SDK 返回的对象异步迭代器（无需分行/parse），
// 但喂给转换核与盖 ts 的部分不变。这条缝见 supervisor.ts 讨论②。

import type { Event } from '@aprog/protocol';
import type { Transducer } from '../engine.ts';

/** 把字节块流按行切成字符串（UTF-8，跨块拼接残行）。 */
export async function* splitLines(bytes: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of bytes) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.length > 0) yield buf;
}

/** 驱动一款引擎：NDJSON 字节流 → 原生事件 → 纯核 → 盖 ts 的 aprog 事件（仍未盖 seq，交 Sequencer/CP）。 */
export async function* driveNdjson<Native, S>(
  bytes: AsyncIterable<Uint8Array>,
  transduce: Transducer<Native, S>,
  init: S,
): AsyncIterable<Omit<Event, 'seq'>> {
  let state = init;
  for await (const line of splitLines(bytes)) {
    if (line.trim() === '') continue;
    const native = JSON.parse(line) as Native;
    const step = transduce(native, state);
    state = step.state;
    const ts = new Date().toISOString();
    for (const ev of step.events) {
      yield { ...ev, ts } as Omit<Event, 'seq'>;
    }
  }
}
