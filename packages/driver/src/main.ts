// aprog-driver 可执行入口（骨架）。
//
// 这是沙箱 entrypoint：`bun build --compile src/main.ts` 把它连同 Bun 运行时、
// 全部 driver JS 与 Claude Agent SDK 的胶水一起编成「一个原生二进制」。
// 注意：agent 循环本体不在这个二进制里——它是 SDK spawn 的另一个原生引擎二进制
// （node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude），见
// docs/harness.html#topology。
//
// 现在只演示打包产物的形态；真正的 Driver.run() 全生命周期编排待实现。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAdapter } from './engines/claude.ts';

function main(): void {
  // 引用一下，确保 SDK 与 adapter 被真正打进二进制（不被 tree-shake 掉）。
  const embedded = [typeof query, ClaudeAdapter.name];
  console.log(`aprog-driver (skeleton) — embedded: query=${embedded[0]}, adapter=${embedded[1]}`);
  console.log('engine 是 SDK spawn 的独立原生二进制，不在本二进制内（见 harness.html#topology）。');
}

main();
