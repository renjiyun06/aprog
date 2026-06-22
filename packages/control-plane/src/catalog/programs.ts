// 程序目录（catalog）。智能程序 = skill 的全局静态目录项。
//
// 权威态本应是磁盘 skill 注册表（SKILL.md frontmatter）；当前还没有该注册表，
// 故先用一份静态常量作为目录来源，启动时 upsert 进 DB（薄镜像，便于查询/校验）。
// 模型见 docs/data-model.html#program-versions：拆「身份 programs + 版本 program_versions」两表——
//   · programs：跨版本稳定的展示元数据 + current_version 指针。
//   · program_versions：每版本一行，承载「这版程序依赖哪版镜像」（image_name + image_version）。
// 系统应用（商店/设置）是前端 chrome，不在目录里。

import type { Database } from 'bun:sqlite';

/** 程序身份（目录项，跨版本稳定）。spawn 时据 currentVersion 钉当前版本。 */
export interface ProgramIdentity {
  id: string; // slug = skill id
  name: string;
  summary: string;
  category: string;
  publisher: string;
  currentVersion: string;
}

/** 程序某版本依赖的镜像（images/&lt;name&gt;/&lt;version&gt;）。 */
export interface ImageDep {
  imageName: string;
  imageVersion: string;
}

/** GET /programs 的目录项。保留 version 字段（= current_version）→ 前端零改。 */
export interface CatalogListItem {
  id: string;
  name: string;
  version: string; // = current_version
  summary: string;
  category: string;
  publisher: string;
}

/** 目录编写源：一个程序 = 身份 + 若干版本（每版本声明依赖的镜像 name@version）。 */
interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  category: string;
  publisher: string;
  currentVersion: string;
  versions: { version: string; image: string }[]; // image = "<name>@<version>"
}

/** 当前目录（与前端 registry 的智能程序一一对应）。后续由 skill 注册表派生。
 *  能力那块先搁置：所有程序暂统一依赖 base@0.1.0（见 images/base/0.1.0）。 */
const CATALOG: CatalogEntry[] = [
  { id: 'requirement', name: '需求分析',   category: '规划与设计', publisher: 'aprog', currentVersion: '0.2.0', versions: [{ version: '0.2.0', image: 'base@0.1.0' }], summary: '把模糊的想法访谈成结构化需求：澄清目标、边界、验收标准，产出一份可执行的需求说明。' },
  { id: 'design',      name: 'UI 设计',    category: '规划与设计', publisher: 'aprog', currentVersion: '0.4.0', versions: [{ version: '0.4.0', image: 'base@0.1.0' }], summary: '把模糊想法塑形成具体可执行的设计：发现品牌意图 → 选型 → 生成并迭代界面产物，支持浏览器内批注反馈。' },
  { id: 'jinglan',     name: '景兰开发',   category: '开发与质量', publisher: 'aprog', currentVersion: '0.1.0', versions: [{ version: '0.1.0', image: 'base@0.1.0' }], summary: '景兰项目的开发程序：在沙箱里读写代码、跑命令、推进功能与修复。' },
  { id: 'ruxiayuan',   name: '如夏园开发', category: '开发与质量', publisher: 'aprog', currentVersion: '0.1.0', versions: [{ version: '0.1.0', image: 'base@0.1.0' }], summary: '如夏园项目的开发程序：在沙箱里读写代码、跑命令、推进功能与修复。' },
  { id: 'codebase',    name: '代码库分析', category: '开发与质量', publisher: 'aprog', currentVersion: '0.1.0', versions: [{ version: '0.1.0', image: 'base@0.1.0' }], summary: '读懂一份代码库：从总览到核心概念逐层勘察，产出结构化的理解笔记。' },
  { id: 'testgen',     name: '测试生成',   category: '开发与质量', publisher: 'aprog', currentVersion: '0.1.0', versions: [{ version: '0.1.0', image: 'base@0.1.0' }], summary: '为目标代码生成测试：分析行为、覆盖边界、产出可运行的测试用例。' },
  { id: 'docs',        name: '文档撰写',   category: '文档',       publisher: 'aprog', currentVersion: '0.1.0', versions: [{ version: '0.1.0', image: 'base@0.1.0' }], summary: '撰写与维护项目文档：从大纲到成稿，保持结构与措辞一致。' },
];

/** 解析 "<name>@<version>" → ImageDep。 */
function parseImage(ref: string): ImageDep {
  const at = ref.lastIndexOf('@');
  if (at <= 0 || at === ref.length - 1) throw new Error(`非法镜像引用（应为 name@version）：${ref}`);
  return { imageName: ref.slice(0, at), imageVersion: ref.slice(at + 1) };
}

/** 程序目录存储：启动时把 CATALOG upsert 进 programs + program_versions，对外提供列出/校验/解析。 */
export class ProgramCatalog {
  constructor(private readonly db: Database) {
    this.seed();
  }

  /** 幂等同步目录到两张表（INSERT OR REPLACE）。 */
  private seed(): void {
    const upProg = this.db.query(
      'INSERT OR REPLACE INTO programs (id, name, summary, category, publisher, current_version) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const upVer = this.db.query(
      'INSERT OR REPLACE INTO program_versions (program_id, version, image_name, image_version, published_at) VALUES (?, ?, ?, ?, NULL)',
    );
    for (const p of CATALOG) {
      upProg.run(p.id, p.name, p.summary, p.category, p.publisher, p.currentVersion);
      for (const v of p.versions) {
        const img = parseImage(v.image);
        upVer.run(p.id, v.version, img.imageName, img.imageVersion);
      }
    }
  }

  /** 全部程序（商店目录）。version = current_version（前端沿用 version 字段）。 */
  list(): CatalogListItem[] {
    return this.db
      .query('SELECT id, name, current_version AS version, summary, category, publisher FROM programs ORDER BY id')
      .all() as CatalogListItem[];
  }

  /** 目录里是否有该程序（安装前校验）。 */
  has(id: string): boolean {
    return this.db.query('SELECT 1 FROM programs WHERE id = ? LIMIT 1').get(id) !== null;
  }

  /** 取单个程序身份（spawn 时据 currentVersion 钉当前版本）；不存在返回 undefined。 */
  get(id: string): ProgramIdentity | undefined {
    const r = this.db
      .query('SELECT id, name, summary, category, publisher, current_version FROM programs WHERE id = ?')
      .get(id) as
      | { id: string; name: string; summary: string; category: string; publisher: string; current_version: string }
      | null;
    return r === null
      ? undefined
      : {
          id: r.id,
          name: r.name,
          summary: r.summary,
          category: r.category,
          publisher: r.publisher,
          currentVersion: r.current_version,
        };
  }

  /** 解析 (programId, version) → 依赖的镜像；版本不存在返回 undefined（兼作版本存在性校验）。 */
  resolveImage(programId: string, version: string): ImageDep | undefined {
    const r = this.db
      .query('SELECT image_name, image_version FROM program_versions WHERE program_id = ? AND version = ?')
      .get(programId, version) as { image_name: string; image_version: string } | null;
    return r === null ? undefined : { imageName: r.image_name, imageVersion: r.image_version };
  }
}
