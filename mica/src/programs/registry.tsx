import type { Component } from 'solid-js';
import type { GlyphName } from '../icons';
import { Design } from './design';
import { Requirement, Jinglan, Ruxiayuan, Codebase, Docs, TestGen } from './more';
import { Settings } from './settings';

export interface ProgramDef {
  id: string;
  label: string;
  glyph: GlyphName;
  tileClass: string;
  component: Component<{ pid?: number; treeOpen?: boolean; treeW?: number; onResizeTreeW?: (nw: number) => void }>;
  pinned?: boolean;   // pin to taskbar
  desktop?: boolean;  // show as desktop shortcut
  hasDir?: boolean;   // has a process directory panel (titlebar toggle)
}

export const PROGRAMS: ProgramDef[] = [
  { id: 'requirement', label: '需求分析', glyph: 'planner',       tileClass: 'app-planner',      component: Requirement, pinned: true, desktop: true, hasDir: true },
  { id: 'design',      label: 'UI 设计', glyph: 'design',        tileClass: 'app-design',       component: Design,      pinned: true, desktop: true, hasDir: true },
  { id: 'jinglan',     label: '景兰开发', glyph: 'terminal',      tileClass: 'app-terminal',     component: Jinglan,     pinned: true, desktop: true, hasDir: true },
  { id: 'ruxiayuan',   label: '如夏园开发', glyph: 'codereviewer', tileClass: 'app-codereviewer', component: Ruxiayuan,   pinned: true, desktop: true, hasDir: true },
  { id: 'codebase',    label: '代码库分析', glyph: 'researcher',   tileClass: 'app-researcher',   component: Codebase,    pinned: true, desktop: true, hasDir: true },
  { id: 'docs',        label: '文档撰写', glyph: 'docswriter',    tileClass: 'app-docswriter',   component: Docs,        pinned: true, desktop: true, hasDir: true },
  { id: 'testgen',     label: '测试生成', glyph: 'bughunter',     tileClass: 'app-bughunter',    component: TestGen,     pinned: true, desktop: true, hasDir: true },
];

export const SYSTEM_APPS: ProgramDef[] = [
  // settings — opened from the user flyout, not pinned to taskbar
  { id: 'settings', label: '设置', glyph: 'settings', tileClass: 'sys-settings', component: Settings, pinned: false },
];

export function findProgram(id: string): ProgramDef | undefined {
  return [...PROGRAMS, ...SYSTEM_APPS].find((p) => p.id === id);
}
