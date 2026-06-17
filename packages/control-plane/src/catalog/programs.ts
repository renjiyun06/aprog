// 程序目录（catalog）。智能程序 = skill 的全局静态目录项。
//
// 权威态本应是磁盘 skill 注册表（SKILL.md frontmatter）；当前还没有该注册表，
// 故先用一份静态常量作为目录来源，启动时 upsert 进 programs 表（薄镜像，便于查询/校验）。
// 模型见 docs/program-model.html。系统应用（商店/设置）是前端 chrome，不在目录里。

import type { Database } from 'bun:sqlite';

export interface ProgramRow {
  id: string;        // slug = skill id
  name: string;
  version: string;
  summary: string;
  category: string;
  publisher: string;
}

/** 当前目录（与前端 registry 的智能程序一一对应）。后续由 skill 注册表派生。 */
export const PROGRAM_CATALOG: ProgramRow[] = [
  { id: 'requirement', name: '需求分析',   version: '0.2.0', category: '规划与设计', publisher: 'aprog', summary: '把模糊的想法访谈成结构化需求：澄清目标、边界、验收标准，产出一份可执行的需求说明。' },
  { id: 'design',      name: 'UI 设计',    version: '0.4.0', category: '规划与设计', publisher: 'aprog', summary: '把模糊想法塑形成具体可执行的设计：发现品牌意图 → 选型 → 生成并迭代界面产物，支持浏览器内批注反馈。' },
  { id: 'jinglan',     name: '景兰开发',   version: '0.1.0', category: '开发与质量', publisher: 'aprog', summary: '景兰项目的开发程序：在沙箱里读写代码、跑命令、推进功能与修复。' },
  { id: 'ruxiayuan',   name: '如夏园开发', version: '0.1.0', category: '开发与质量', publisher: 'aprog', summary: '如夏园项目的开发程序：在沙箱里读写代码、跑命令、推进功能与修复。' },
  { id: 'codebase',    name: '代码库分析', version: '0.1.0', category: '开发与质量', publisher: 'aprog', summary: '读懂一份代码库：从总览到核心概念逐层勘察，产出结构化的理解笔记。' },
  { id: 'testgen',     name: '测试生成',   version: '0.1.0', category: '开发与质量', publisher: 'aprog', summary: '为目标代码生成测试：分析行为、覆盖边界、产出可运行的测试用例。' },
  { id: 'docs',        name: '文档撰写',   version: '0.1.0', category: '文档',       publisher: 'aprog', summary: '撰写与维护项目文档：从大纲到成稿，保持结构与措辞一致。' },
];

/** 程序目录存储：启动时把 PROGRAM_CATALOG upsert 进表，对外提供列出/校验。 */
export class ProgramCatalog {
  constructor(private readonly db: Database) {
    this.seed();
  }

  /** 幂等同步目录到表（INSERT OR REPLACE）。 */
  private seed(): void {
    const up = this.db.query(
      'INSERT OR REPLACE INTO programs (id, name, version, summary, category, publisher) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const p of PROGRAM_CATALOG) up.run(p.id, p.name, p.version, p.summary, p.category, p.publisher);
  }

  /** 全部程序（商店目录）。 */
  list(): ProgramRow[] {
    return this.db.query('SELECT id, name, version, summary, category, publisher FROM programs').all() as ProgramRow[];
  }

  /** 目录里是否有该程序（安装前校验）。 */
  has(id: string): boolean {
    return this.db.query('SELECT 1 FROM programs WHERE id = ? LIMIT 1').get(id) !== null;
  }
}
