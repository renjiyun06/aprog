import { createSignal } from 'solid-js';
import { api } from '../lib/api';
import { PROGRAMS, findProgram } from '../programs/registry';
import type { GlyphName } from '../icons';

/* 程序商店目录——元数据来自控制平面（GET /programs），渲染资产（图标）按 id 从本地 registry 解析。
   组件无法序列化，故 glyph/tileClass 留在前端；后端只给 id/名称/版本/摘要/分类。
   首屏先用本地 registry 兜底，拉到后端目录后替换。模型见 docs/data-model.html。 */

export interface CatalogItem {
  id: string;
  label: string;
  version: string;
  summary: string;
  category: string;
  glyph: GlyphName;
  tileClass: string;
}

interface ServerProgram {
  id: string;
  name: string;
  version: string;
  summary: string;
  category: string;
}

function fromLocal(): CatalogItem[] {
  return PROGRAMS.map((p) => ({
    id: p.id, label: p.label, version: p.version ?? '', summary: p.description ?? '',
    category: p.category, glyph: p.glyph, tileClass: p.tileClass,
  }));
}

function merge(m: ServerProgram): CatalogItem {
  const r = findProgram(m.id); // 渲染资产从本地按 id 取
  return {
    id: m.id, label: m.name, version: m.version, summary: m.summary, category: m.category,
    glyph: r?.glyph ?? 'store', tileClass: r?.tileClass ?? '',
  };
}

// ⚠️ 初值必须为空：本模块处于导入环（registry → store → catalog → registry），
//    eval 期不得读 PROGRAMS（那时 registry 未初始化完）。本地兜底延迟到 loadCatalog() 内。
const [items, setItems] = createSignal<CatalogItem[]>([]);
let loaded = false;

/** 程序目录（响应式）。 */
export const catalog = items;

/** 拉取后端目录（商店打开时调用，幂等；失败则保留本地兜底）。 */
export async function loadCatalog(): Promise<void> {
  if (loaded) return;
  if (items().length === 0) setItems(fromLocal()); // 先用本地兜底，避免首屏空白
  try {
    const { items: rows } = await api.get<{ items: ServerProgram[] }>('/programs');
    if (rows.length > 0) setItems(rows.map(merge));
    loaded = true;
  } catch {
    /* 保留本地兜底，下次再试 */
  }
}
