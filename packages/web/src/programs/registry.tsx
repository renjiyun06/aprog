import type { Component } from 'solid-js';
import type { GlyphName } from '../icons';
import { Design } from './design';
import { Requirement, Jinglan, Ruxiayuan, Codebase, Docs, TestGen } from './more';
import { Settings } from './settings';
import { Store } from './store';

export interface ProgramDef {
  id: string;
  label: string;
  glyph: GlyphName;
  tileClass: string;
  component: Component<{ pid?: number; treeOpen?: boolean; treeW?: number; onResizeTreeW?: (nw: number) => void }>;
  pinned?: boolean;   // pin to taskbar
  desktop?: boolean;  // show as desktop shortcut
  hasDir?: boolean;   // has a process directory panel (titlebar toggle)
  /** program version + one-paragraph intro — surfaced via the titlebar (?) info popover.
      in production these come from the skills catalog (SKILL.md frontmatter). */
  version?: string;
  description?: string;
}

export const PROGRAMS: ProgramDef[] = [
  { id: 'requirement', label: '需求分析', glyph: 'planner',       tileClass: 'app-planner',      component: Requirement, pinned: true, desktop: true, hasDir: true,
    version: '0.2.0', description: '把模糊的想法访谈成结构化需求：澄清目标、边界、验收标准，产出一份可执行的需求说明。' },
  { id: 'design',      label: 'UI 设计', glyph: 'design',        tileClass: 'app-design',       component: Design,      pinned: true, desktop: true, hasDir: true,
    version: '0.4.0', description: '把模糊想法塑形成具体可执行的设计：发现品牌意图 → 选型 → 生成并迭代界面产物，支持浏览器内批注反馈。' },
  { id: 'jinglan',     label: '景兰开发', glyph: 'terminal',      tileClass: 'app-terminal',     component: Jinglan,     pinned: true, desktop: true, hasDir: true,
    version: '0.1.0', description: '景兰项目的开发程序：在沙箱里读写代码、跑命令、推进功能与修复。' },
  { id: 'ruxiayuan',   label: '如夏园开发', glyph: 'codereviewer', tileClass: 'app-codereviewer', component: Ruxiayuan,   pinned: true, desktop: true, hasDir: true,
    version: '0.1.0', description: '如夏园项目的开发程序：在沙箱里读写代码、跑命令、推进功能与修复。' },
  { id: 'codebase',    label: '代码库分析', glyph: 'researcher',   tileClass: 'app-researcher',   component: Codebase,    pinned: true, desktop: true, hasDir: true,
    version: '0.1.0', description: '读懂一份代码库：从总览到核心概念逐层勘察，产出结构化的理解笔记。' },
  { id: 'docs',        label: '文档撰写', glyph: 'docswriter',    tileClass: 'app-docswriter',   component: Docs,        pinned: true, desktop: true, hasDir: true,
    version: '0.1.0', description: '撰写与维护项目文档：从大纲到成稿，保持结构与措辞一致。' },
  { id: 'testgen',     label: '测试生成', glyph: 'bughunter',     tileClass: 'app-bughunter',    component: TestGen,     pinned: true, desktop: true, hasDir: true,
    version: '0.1.0', description: '为目标代码生成测试：分析行为、覆盖边界、产出可运行的测试用例。' },
];

export const SYSTEM_APPS: ProgramDef[] = [
  // program store — pinned to taskbar; the entry point for installing programs
  { id: 'store', label: '程序商店', glyph: 'store', tileClass: 'sys-store', component: Store, pinned: true,
    version: '1.0.0', description: '浏览并安装平台程序到你的桌面。' },
  // settings — opened from the user flyout, not pinned to taskbar
  { id: 'settings', label: '设置', glyph: 'settings', tileClass: 'sys-settings', component: Settings, pinned: false,
    version: '1.0.0', description: '平台设置：账户、外观与偏好。' },
];

export function findProgram(id: string): ProgramDef | undefined {
  return [...PROGRAMS, ...SYSTEM_APPS].find((p) => p.id === id);
}
