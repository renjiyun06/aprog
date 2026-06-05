// FsServer · 目录实时读（引擎无关）。docs/interaction.html#s-fs。
// 应答 CP 下发的 fs.list/read：在沙箱内 ls/cat driver 自己的 cwd。可脏读（看可脏）。
// 绑到 DriverChannel.onFsRequest。

import type { FsRequest, FsResponse } from './channel.ts';

export interface FsServer {
  handle(req: FsRequest): Promise<FsResponse>;
}
