// 引擎子进程的环境清洗（最小特权）。
//
// driver 收到的进程环境是个「超集」：既有该交给引擎的（GLM 路由 ANTHROPIC_*），也有 driver 私有、
// 引擎/用户程序**绝不可见**的东西——bindToken（本沙箱能力令牌）、控制平面地址、driver 拉程序用的
// git/OAuth 凭证。任何拉起引擎子进程的地方（HarnessSupervisor.spawn 的 SpawnSpec.env）都必须先
// 经此函数清洗，否则用户程序能直接读到 token 冒充沙箱、或盗用 git 凭证。
//
// 清洗策略是「denylist」而非「allowlist」——引擎需要 PATH/HOME/NODE… 等一大堆继承变量，逐个放行不现实；
// 而要藏的就那几类，精确删掉即可：
//   · 全部 APROG_ 前缀：清一色内部控制变量（APROG_BIND_TOKEN / APROG_CONTROL_PLANE_URL…），引擎无一需要。
//   · 已知 driver 私有凭证名：git/OAuth 取程序用，引擎不该持有。
// 刻意**保留** ANTHROPIC_*（AUTH_TOKEN / BASE_URL / MODEL）——它是注入「给引擎用」的 GLM 路由凭证，引擎正要它。
// 所以不能用「名字含 TOKEN 就删」这种粗暴启发：那会误删 ANTHROPIC_AUTH_TOKEN，引擎反而连不上模型。

/** 已知的 driver 私有凭证变量名（拉程序/认证用，引擎不可见）。调用方可经 extraDeny 追加自己注入的。 */
const DRIVER_PRIVATE_VARS: ReadonlySet<string> = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'GIT_TOKEN',
  'GIT_ASKPASS',
  'GIT_USERNAME',
  'GIT_PASSWORD',
  'GIT_CREDENTIALS',
  'NPM_TOKEN',
  'SSH_AUTH_SOCK',
]);

/**
 * 产出引擎子进程应得的环境：从 source 删去 driver 私有项，其余原样保留。
 * @param source    driver 自身的环境（通常 process.env）。
 * @param extraDeny 额外要删的变量名——driver 知道自己为「拉程序」注入了哪些 git/OAuth 凭证，按名传入即可一并清掉。
 */
export function scrubEngineEnv(
  source: Record<string, string | undefined>,
  extraDeny: readonly string[] = [],
): Record<string, string> {
  const deny = new Set<string>([...DRIVER_PRIVATE_VARS, ...extraDeny]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue; // 未设置的不带入
    if (k.startsWith('APROG_')) continue; // 内部控制变量（含 bindToken / CP 地址）一律不进引擎
    if (deny.has(k)) continue; // 已知 driver 私有凭证
    out[k] = v;
  }
  return out;
}
