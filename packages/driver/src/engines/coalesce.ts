// 共享 · 项的累积与合并（引擎无关）。这是「adapter 状态」的核心：从 item.start 到 item.end
// 之间，转换核把每条 delta 攒进同一个 OpenItem 的缓冲；到 item.end 时 coalesce 成全量 ItemValue。
// Claude 与 Codex 的转换核都复用它——两边攒法一样，只是喂进来的原生事件不同。

import type { ItemId, ItemType, ItemValue } from '@aprog/protocol';

/** 一个正在累积的项。转换核按 id（Claude 用 block index、Codex 用 item id）持有它。 */
export interface OpenItem {
  readonly id: ItemId;
  readonly itemType: ItemType;
  /** thinking/reply 累积文本；tool 累积 partial_json 分片；command 累积输出。 */
  readonly buf: string;
  /** tool 项的名字。 */
  readonly toolName?: string;
  /** thinking 项的完整性签名（Claude signature_delta）。 */
  readonly signature?: string;
  /** command 项的命令行。 */
  readonly command?: string;
  /** command 项的退出码。 */
  readonly exitCode?: number;
  /** tool 项的结果。 */
  readonly result?: unknown;
  /** file_change 项的路径。 */
  readonly path?: string;
}

/** 把累积好的项合并成 item.end 的全量 value（按项类型分流）。纯函数。 */
export function coalesce(it: OpenItem): ItemValue {
  switch (it.itemType) {
    case 'thinking':
      return { item: 'thinking', text: it.buf, signature: it.signature };
    case 'reply':
      return { item: 'reply', text: it.buf };
    case 'tool':
      return { item: 'tool', name: it.toolName ?? '', args: parseToolArgs(it.buf), result: it.result };
    case 'command':
      return { item: 'command', command: it.command ?? '', output: it.buf, exit_code: it.exitCode };
    case 'file_change':
      return { item: 'file_change', path: it.path ?? '', diff: it.buf };
  }
}

/** tool 入参：拼好的 partial_json 分片末尾一次解析。解析不了就留原文兜底（不丢）。 */
export function parseToolArgs(partialJson: string): unknown {
  const s = partialJson.trim();
  if (s === '') return {};
  try {
    return JSON.parse(s);
  } catch {
    return { __unparsed: partialJson };
  }
}
