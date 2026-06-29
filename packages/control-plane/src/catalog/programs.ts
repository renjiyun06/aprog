// 程序目录（catalog）。智能程序 = skill 的全局目录项。
//
// 权威态 = DB（programs + program_versions 两表），不再有静态常量自动 seed。
// 「发布一个程序/某版本」是一个有意的两步动作：① 推 OCI 包到 registry；② 把该版本登记进 DB
// （programs 一行 + program_versions 一行）。DB 据此如实反映「真实发布了什么」，与已发布的包对齐。
// 本类只做查询/校验/解析（list/has/get/resolveImage），不写入——登记由发布流程显式完成。
// 模型见 docs/data-model.html#program-versions：
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

/** 程序目录存储：DB 为权威源（发布时显式登记），对外提供列出/校验/解析。本类只读，不 seed。 */
export class ProgramCatalog {
  constructor(private readonly db: Database) {}

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
