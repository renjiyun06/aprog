import { makeProgram, baseTree, type ProcState } from './shell-program';
import type { SessionEvent, FsNode } from '../components/ProgramShell';

/* ──────────────────────────────────────────────────────────────────────
   More example 智能程序. Each is the same ProgramShell over a small mock
   seed — a 智能程序 is essentially a skill the harness executes, so they all
   look alike; only the domain (and its files/conversation) differs.
   ──────────────────────────────────────────────────────────────────── */

function proc(
  pid: number,
  name: string,
  input: string,
  events: SessionEvent[],
  opts: { dot?: 'running' | 'hibernating'; phase?: string; extraTree?: FsNode[]; extraContents?: Record<string, string> } = {},
): ProcState {
  const dot = opts.dot ?? 'running';
  return {
    pid, name, dot, dir: `~/.aprog/${pid}`,
    tree: baseTree(opts.extraTree),
    events,
    openFiles: [], viewFile: null,
    contents: {
      'meta.yml': `id: "${pid}"\nstatus: ${dot === 'hibernating' ? 'hibernating' : 'running'}\nphase: ${opts.phase ?? 'designing'}`,
      'input.md': input,
      'session.jsonl': `{"t":"user.message","text":${JSON.stringify(input)}}`,
      ...(opts.extraContents ?? {}),
    },
  };
}

/* ── 需求分析 ── */
const Requirement = makeProgram('需求分析', [
  proc(5101, '电商中台 · 需求澄清', '把现有 ERP 拆成电商中台, 先理清业务域和关键过程.', [
    { kind: 'user', body: <>把现有 ERP 拆成电商中台, 先理清业务域和关键过程.</> },
    { kind: 'thinking', duration: '3.1s', body: <>{`先按业务域切：商品 / 订单 / 库存 / 会员 / 营销。
逐域问关键过程，先卡住边界，再细化。`}</> },
    { kind: 'agent', body: <>初步切成 <strong>5 个业务域</strong>，已写进 <code>modules.md</code>。先确认一个边界问题：订单扣减库存要 <strong>强一致</strong> 还是 <strong>最终一致</strong>？</> },
    { kind: 'user', body: <>先做最终一致, 用消息补偿.</> },
    { kind: 'agent', body: <>好，那订单域只发"已下单"事件，库存域订阅后扣减并回写。我把这条决策记到 modules.md 了。</> },
  ], {
    phase: 'discovery',
    extraTree: [{ name: 'execution-state', kind: 'dir', children: [{ name: 'modules.md', kind: 'file' }] }],
    extraContents: {
      'execution-state/modules.md': `# 业务域划分 (v1)

- 商品域: SPU/SKU、类目、属性
- 订单域: 下单、支付、履约状态机
- 库存域: 可用库存、占用、最终一致扣减
- 会员域: 账户、等级、地址
- 营销域: 优惠券、活动、价格计算

## 待确认
- [x] 订单↔库存一致性 → 最终一致 + 消息补偿
- [ ] 价格计算归属营销域还是订单域`,
    },
  }),
  proc(5088, '会员体系 · 需求', '设计会员等级与权益体系.', [
    { kind: 'user', body: <>设计会员等级与权益体系.</> },
    { kind: 'agent', body: <>先聊聊：等级是按累计消费还是成长值算？</> },
  ], { phase: 'discovery' }),
], 5100);

/* ── 景兰开发 ── */
const Jinglan = makeProgram('景兰开发', [
  proc(5201, '景兰 · 后台管理端', '基于 yudao 脚手架开发景兰后台, 先把组织架构模块跑起来.', [
    { kind: 'user', body: <>基于 yudao 脚手架开发景兰后台, 先把组织架构模块跑起来.</> },
    { kind: 'tool', variant: 'run', name: 'bash', arg: 'git clone yudao-cloud && mvn -q compile', dur: '34s', collapsed: true, result: <>BUILD SUCCESS · 92 modules</> },
    { kind: 'tool', variant: 'edit', name: 'write', arg: 'src/main/java/org/jinglan/system/OrgController.java', dur: '1.4s', result: <>{`+ 96 lines  ·  CRUD + 树形组织接口`}</> },
    { kind: 'agent', body: <>组织架构模块跑通了：<code>GET /system/org/tree</code> 已返回示例数据。下一步接角色权限还是先做前端页面？</> },
  ], {
    phase: 'designing',
    extraTree: [{ name: 'artifacts', kind: 'dir', children: [{ name: 'OrgController.java', kind: 'file' }] }],
    extraContents: {
      'artifacts/OrgController.java': `@RestController
@RequestMapping("/system/org")
public class OrgController {

    @Resource
    private OrgService orgService;

    @GetMapping("/tree")
    public CommonResult<List<OrgTreeVO>> tree() {
        return success(orgService.getOrgTree());
    }
}`,
    },
  }),
], 5200);

/* ── 如夏园开发 ── */
const Ruxiayuan = makeProgram('如夏园开发', [
  proc(5301, '如夏园 · #41 长者关联修复', '修复 UAT #41: 长者关联查询无数据.', [
    { kind: 'user', body: <>修复 UAT #41: 长者关联查询无数据.</> },
    { kind: 'tool', variant: 'search', name: 'grep', arg: 'rg "elderRelation" -l', dur: '0.4s', collapsed: true, result: <>ElderRelationMapper.xml · ElderService.java</> },
    { kind: 'tool', variant: 'read', name: 'read', arg: 'ElderRelationMapper.xml', dur: '0.2s', collapsed: true, result: <>定位到 join 条件</> },
    { kind: 'thinking', duration: '1.6s', body: <>{`关联表 join 用了 elder_id = elder_id，但子表外键其实是 senior_id。
typo 导致永远查不到。改 join 条件即可。`}</> },
    { kind: 'tool', variant: 'edit', name: 'edit', arg: 'ElderRelationMapper.xml', dur: '0.5s', collapsed: true, result: <>er.elder_id → er.senior_id</> },
    { kind: 'agent', body: <>找到了：关联 SQL 的 join 写错字段（<code>elder_id</code> 应为 <code>senior_id</code>），所以永远空。已改并跑通本地用例，建议回归 UAT #41。</> },
  ], { phase: 'designing' }),
], 5300);

/* ── 代码库分析 ── */
const Codebase = makeProgram('代码库分析', [
  proc(5401, 'yudao · 架构梳理', '梳理 yudao 的模块依赖和分层, 出一份报告.', [
    { kind: 'user', body: <>梳理 yudao 的模块依赖和分层, 出一份报告.</> },
    { kind: 'tool', variant: 'run', name: 'bash', arg: 'cloc --by-file-by-lang . | tail', dur: '5.2s', collapsed: true, result: <>Java 412k · XML 88k · Vue 134k</> },
    { kind: 'tool', variant: 'search', name: 'grep', arg: 'rg "import org.jinglan" --stats', dur: '1.1s', collapsed: true, result: <>统计跨模块引用 1,284 处</> },
    { kind: 'agent', body: <>分层基本是 <code>controller → service → mapper</code>，但发现 <strong>3 处 controller 直接调 mapper</strong> 绕过了 service。报告写到 <code>report.md</code> 了。</> },
  ], {
    phase: 'done',
    extraTree: [{ name: 'artifacts', kind: 'dir', children: [{ name: 'report.md', kind: 'file' }] }],
    extraContents: {
      'artifacts/report.md': `# yudao 架构梳理报告

## 分层
controller → service → mapper（标准三层）

## 问题
- 3 处 controller 直接调用 mapper，绕过 service：
  - UserController#exportRaw
  - OrderController#quickStat
  - LogController#tail
- 建议补 service 方法，统一事务与权限校验

## 模块耦合
system 与 infra 双向依赖，建议下沉公共部分到 common`,
    },
  }),
], 5400);

/* ── 文档撰写 ── */
const Docs = makeProgram('文档撰写', [
  proc(5501, 'REST API 文档生成', '根据 controller 注解生成 REST API 文档.', [
    { kind: 'user', body: <>根据 controller 注解生成 REST API 文档.</> },
    { kind: 'tool', variant: 'search', name: 'grep', arg: 'rg "@(Get|Post|Put|Delete)Mapping" -c', dur: '0.6s', collapsed: true, result: <>317 个端点</> },
    { kind: 'agent', body: <>扫到 <strong>317 个端点</strong>，按模块分组生成中。先给你看 system 模块这一节对不对口味。</> },
  ], { phase: 'designing' }),
], 5500);

/* ── 测试生成 ── */
const TestGen = makeProgram('测试生成', [
  proc(5601, '登录模块 · 单测生成', '给登录模块生成单元测试, 覆盖边界与异常.', [
    { kind: 'user', body: <>给登录模块生成单元测试, 覆盖边界与异常.</> },
    { kind: 'tool', variant: 'read', name: 'read', arg: 'AuthService.java', dur: '0.3s', collapsed: true, result: <>login / refresh / logout 三个入口</> },
    { kind: 'tool', variant: 'edit', name: 'write', arg: 'AuthServiceTest.java', dur: '1.2s', result: <>{`+ 11 cases
  · 正常登录 / 密码错误 / 账号锁定
  · token 过期 / 刷新 / 并发登出`}</> },
    { kind: 'agent', body: <>生成了 <strong>11 个用例</strong>，含密码错误、账号锁定、token 过期等边界。跑了一遍 10 过 1 挂——并发登出那条暴露了一个真实竞态，要我继续查吗？</> },
  ], { phase: 'designing' }),
], 5600);

export { Requirement, Jinglan, Ruxiayuan, Codebase, Docs, TestGen };
