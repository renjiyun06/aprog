// driver 侧「起引擎」——把 Claude Agent SDK 的 agent 循环作为子进程拉起。
//
// 形态(见 docs harness 拓扑):driver 以库形式 import { query },query() 内部再 spawn 原生引擎二进制;
// agent 循环跑在那个原生子进程里,driver 只做「起 + 喂输入 + 收输出」。本文件只管「起」与 I/O 句柄,
// 上行事件帧 / 下行输入帧的【通道桥接】是后续独立步,这里先空转待命 + 输出打日志。
//
// 两条纪律:
//  · 全自动:harness 跑程序不靠交互式审批做约束(约束来自窄 prompt + 工具 ACL + 平台监听),故
//    permissionMode='bypassPermissions' + allowDangerouslySkipPermissions=true,绕过所有校验。
//  · 最小特权:引擎子进程的 env 经 scrubEngineEnv 洗过——抹掉 driver 私有(APROG_*/git 票),只留 ANTHROPIC_*。
//
// 模型凭证「口子」:engineCredential 给了就覆盖(将来 per-user 经 Seed 下发);没给就用共享 env 注入的那把。

import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'node:os';
import type { Event as HarnessEvent } from '@aprog/protocol/harness';
import { scrubEngineEnv } from './engine-env.ts';
import { Transducer } from './transduce.ts';

/** 起引擎后持有的句柄:喂输入、停引擎。 */
export interface EngineHandle {
  /** 推一条用户输入给引擎;返回该输入的回显事件(由调用方上行,见 transduce.userEcho)。 */
  pushInput(text: string): HarnessEvent;
  /** 停引擎(结束输入流;引擎随之收尾)。 */
  stop(): void;
}

/** 可控输入流:引擎以流式输入模式常驻,等 pushInput 喂入;无输入则 await 空转待命。 */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string): void {
    this.items.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    this.wake?.();
    this.wake = null;
  }
  close(): void {
    this.closed = true;
    this.wake?.();
    this.wake = null;
  }
  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.items.shift();
      if (next === undefined) {
        await new Promise<void>((r) => (this.wake = r));
        continue;
      }
      yield next;
    }
  }
}

/** 起引擎:返回句柄。失败由调用方兜(prepareRuntime 抛 → 不回 Ready)。
 *  @param opts.emit 上行回调:转换层把引擎产出归一成 harness Event 后逐条交给它(由通道层包成 EngineEvent 帧上行)。 */
export function startEngine(opts: {
  engineCredential?: { token: string; baseUrl?: string };
  emit: (event: HarnessEvent) => void;
}): EngineHandle {
  const env = scrubEngineEnv(process.env);
  // 沙箱内以 root 跑,而 claude-code 默认拒绝「root + --dangerously-skip-permissions」(安全护栏)。
  // IS_SANDBOX=1 是其官方旁路:声明「确在沙箱内、root 是有意的」,放行 bypassPermissions。我们本就在沙箱里,语义正确。
  // (守卫:getuid()===0 && IS_SANDBOX!=='1' && !CLAUDE_CODE_BUBBLEWRAP → 报错退出;设 IS_SANDBOX=1 即过。)
  env.IS_SANDBOX = '1';
  // 模型凭证口子:per-user 短票优先;否则用共享 env 注入的 ANTHROPIC_AUTH_TOKEN。
  if (opts.engineCredential) {
    env.ANTHROPIC_AUTH_TOKEN = opts.engineCredential.token;
    if (opts.engineCredential.baseUrl) env.ANTHROPIC_BASE_URL = opts.engineCredential.baseUrl;
  }

  // 引擎二进制路径:bundle 后 SDK 自带的 optional 原生二进制路径解析会失效,故显式指给它。
  // 沙箱经 APROG_ENGINE_BIN 注入烘进镜像的二进制路径;未设则交回 SDK 默认解析(非 bundle 的 dev 态可用)。
  const engineBin = process.env.APROG_ENGINE_BIN;
  const input = new InputQueue();
  const options: Options = {
    cwd: homedir(), // 引擎工作目录 = 家目录(沙箱内 /root)
    env,
    settingSources: ['user'], // 载 ~/.claude:GLM 路由 settings.json + skills/
    includePartialMessages: true,
    permissionMode: 'bypassPermissions', // 全自动,绕过所有审批
    allowDangerouslySkipPermissions: true, // SDK 强制的「确属有意绕过」确认
    ...(engineBin ? { pathToClaudeCodeExecutable: engineBin } : {}),
    stderr: (d) => console.error('[engine:err]', d.trimEnd()),
  };

  const q = query({ prompt: input, options });
  // 后台消费输出流:逐条经转换层归一成 harness Event,emit 上行(转换失败不影响引擎,仅丢该条并记日志)。
  const transducer = new Transducer();
  void (async () => {
    try {
      for await (const msg of q) {
        try {
          for (const event of transducer.feed(msg)) opts.emit(event);
        } catch (e) {
          console.error(`[engine] 转换 ${msg.type} 失败(丢弃该条):`, e);
        }
      }
      console.log('[engine] 输出流结束');
    } catch (e) {
      console.error('[engine] 输出流异常:', e);
    }
  })();

  console.log(`[driver] 引擎已起 cwd=${homedir()} bypassPermissions 凭证=${opts.engineCredential ? 'per-user' : '共享'}`);
  return {
    // 喂输入 + 返回回显事件(调用方上行,与流共用 transducer 的 seq 计数,保证局部单调)。
    pushInput: (text) => {
      input.push(text);
      return transducer.userEcho(text);
    },
    stop: () => input.close(),
  };
}
