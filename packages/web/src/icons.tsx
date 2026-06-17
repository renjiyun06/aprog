// ─── 图标统一走 Lucide（lucide-solid）──────────────────────────────
// 专业、风格一致的 monoline 描边图标集。所有图标 stroke=currentColor，尺寸/描边/颜色
// 由各容器 CSS 控制（.tb-app .tile svg / .dt-icon-art svg / .store-icon svg / .wc svg），
// 桌面图标则通过组件 props 指定大小。程序按用途映射到对应 Lucide 图标。

import {
  Code,
  FileText,
  Bug,
  ListChecks,
  BookOpen,
  FolderOpen,
  Activity,
  Terminal,
  Store,
  Palette,
  Settings,
  Monitor,
  Trash2,
  Folder,
  Minus,
  Square,
  X,
} from 'lucide-solid';

/** 程序/系统图标表：调用方按名取用 Glyph[name]，值为 Lucide 组件。 */
export const Glyph = {
  codereviewer: Code,
  docswriter: FileText,
  bughunter: Bug,
  planner: ListChecks,
  researcher: BookOpen,
  files: FolderOpen,
  activity: Activity,
  terminal: Terminal,
  store: Store,
  design: Palette,
  settings: Settings,
  pc: Monitor,
  recyclebin: Trash2,
  folder: Folder,
  textfile: FileText,
} as const;

export type GlyphName = keyof typeof Glyph;

// 窗口标题栏控件：最小化 / 最大化 / 关闭。
export const ChromeMin = Minus;
export const ChromeMax = Square;
export const ChromeClose = X;
