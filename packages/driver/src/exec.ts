// driver 侧外部命令小助手（git / tar）。沙箱 base 镜像自带 git、tar、gzip；driver 以 node 跑（非 bun），
// 故用 node:child_process 而非 Bun.spawn。失败把 stderr 一并裹进 Error，便于在 driver.log 里定位。

import { execFile } from 'node:child_process';

/** 跑一条命令，成功 resolve(stdout)，失败 reject（带 stderr）。args 走数组（不经 shell，免注入/转义坑）。 */
export function sh(cmd: string, args: string[], opts?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts?.cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`命令失败 [${cmd} ${args.join(' ')}]: ${String(stderr).trim() || err.message}`));
      } else {
        resolve(String(stdout));
      }
    });
  });
}
