import type { Component, JSX } from 'solid-js';
/* eslint-disable @typescript-eslint/no-unused-vars */

// ─── SVG glyph library — Fluent line style ──────────────────────────
// All icons take optional `class` / `style`; stroke=currentColor so they
// inherit the parent text color. viewBox normalized to 16x16 for chrome
// icons; larger viewBox for desktop tiles where indicated.

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

// Real Win11 Start logo — 4 leaning parallelograms (Microsoft official path).
export const StartLogo: Component<IconProps> = (p) => (
  <svg viewBox="0 0 88 88" stroke="none" fill="currentColor" {...p}>
    <path d="M0,12.402 L35.687,7.5 L35.703,41.922 L0.033,42.125 Z"/>
    <path d="M0,45.176 L35.67,45.378 L35.687,79.812 L0.034,84.5 Z"/>
    <path d="M40,7 L87.314,0 L87.314,41.557 L40,41.91 Z"/>
    <path d="M40,45.65 L87.314,45.7 L87.302,87.27 L40,80.6 Z"/>
  </svg>
);
export const Search: Component<IconProps> = (p) => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" {...p}>
    <circle cx="8" cy="8" r="4.5"/><path d="M11.5 11.5 L15.5 15.5"/>
  </svg>
);
export const TaskView: Component<IconProps> = (p) => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" {...p}>
    <rect x="2" y="3" width="9" height="9" rx="1"/><rect x="7" y="6" width="9" height="9" rx="1"/>
  </svg>
);

// Tray icons
export const Wifi: Component<IconProps> = (p) => (
  <svg viewBox="0 0 16 14" fill="none" stroke="currentColor" {...p}>
    <path d="M1 4 a10 10 0 0 1 14 0"/><path d="M3.5 7 a6 6 0 0 1 9 0"/><path d="M6 10 a3 3 0 0 1 4 0"/>
    <circle cx="8" cy="12" r="0.8" fill="currentColor" stroke="none"/>
  </svg>
);
export const WifiOff: Component<IconProps> = (p) => (
  <svg viewBox="0 0 16 14" fill="none" stroke="currentColor" {...p}>
    <path d="M1 4 a10 10 0 0 1 14 0" opacity="0.4"/><path d="M3.5 7 a6 6 0 0 1 9 0" opacity="0.4"/>
    <circle cx="8" cy="12" r="0.8" fill="currentColor" stroke="none"/>
    <path d="M2 2 L14 13" stroke-width="1.4"/>
  </svg>
);
export const Volume: Component<IconProps> = (p) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" {...p}>
    <path d="M2.5 6 H5 L8.5 3 V13 L5 10 H2.5 Z"/>
  </svg>
);
export const Battery: Component<IconProps> = (p) => (
  <svg viewBox="0 0 22 12" fill="none" stroke="currentColor" {...p}>
    <rect x="1" y="2" width="17" height="8" rx="1.6"/>
    <rect x="2.5" y="3.5" width="11" height="5" rx="0.4" fill="currentColor" stroke="none"/>
    <rect x="19" y="4.5" width="1.4" height="3" rx="0.4" fill="currentColor" stroke="none"/>
  </svg>
);
export const Notification: Component<IconProps> = (p) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" {...p}>
    <path d="M4 12 V8 a4 4 0 0 1 8 0 V12 L13 13 H3 Z"/><path d="M6.5 13 a1.7 1.7 0 0 0 3 0"/>
  </svg>
);
export const SandboxIcon: Component<IconProps> = (p) => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" {...p}>
    <rect x="3" y="3" width="12" height="12" rx="2.5"/><path d="M3 9 H15 M9 3 V15"/>
  </svg>
);
export const DevicesIcon: Component<IconProps> = (p) => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" {...p}>
    <rect x="2.5" y="4" width="13" height="8" rx="1.2"/><path d="M5.5 15.5 H12.5"/>
  </svg>
);

// Window chrome controls
export const ChromeMin: Component<IconProps> = (p) => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" {...p}><path d="M1 5 H9"/></svg>
);
export const ChromeMax: Component<IconProps> = (p) => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" {...p}><rect x="1" y="1" width="8" height="8" rx="0.5"/></svg>
);
export const ChromeClose: Component<IconProps> = (p) => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" {...p}><path d="M1 1 L9 9 M9 1 L1 9"/></svg>
);

// ─── Program glyphs ────────────────────────────────────────────────
// Used both in taskbar tiles (16px) and desktop icons (30px).
type GlyphProps = IconProps & { size?: number };

export const Glyph = {
  codereviewer: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M5 4 L2 8 L5 12"/><path d="M11 4 L14 8 L11 12"/><path d="M9.5 3.5 L6.5 12.5"/>
    </svg>
  ),
  docswriter: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M3.5 2 H9.5 L13 5.5 V14 H3.5 Z"/><path d="M9.5 2 V5.5 H13"/><path d="M5.5 8.5 H10.5 M5.5 11 H9"/>
    </svg>
  ),
  bughunter: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <ellipse cx="8" cy="9" rx="3.5" ry="4.5"/>
      <path d="M8 4.5 V3 M6 5 L5 3 M10 5 L11 3"/>
      <path d="M4.5 8 L2.5 7 M11.5 8 L13.5 7 M4.5 11 L2.5 12 M11.5 11 L13.5 12"/>
      <path d="M8 9 V13"/>
    </svg>
  ),
  planner: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <rect x="2" y="3" width="3.5" height="3.5" rx="0.5"/>
      <rect x="2" y="9.5" width="3.5" height="3.5" rx="0.5"/>
      <path d="M2.8 4.5 L3.7 5.4 L4.8 3.5"/><path d="M7 4.5 H13.5 M7 11 H13.5"/>
    </svg>
  ),
  researcher: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M3 2.5 H13 V13.5 H3 Z"/><path d="M3 2.5 V13.5 L4.5 12.3 L6 13.5 V2.5"/><path d="M8 6 H12 M8 8.5 H11"/>
    </svg>
  ),
  files: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M2 5 L2 13 a1 1 0 0 0 1 1 H13 a1 1 0 0 0 1 -1 V6.5 a1 1 0 0 0 -1 -1 H8 L6.5 4 H3 a1 1 0 0 0 -1 1 z"/>
    </svg>
  ),
  activity: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="#6ccb5f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M2 12 L5 7 L8 10 L11 4 L14 8"/>
      <path d="M2 14 H14" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
    </svg>
  ),
  terminal: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M3 5 L6 8 L3 11"/><path d="M8 11 H13"/>
    </svg>
  ),
  store: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M3 5 H13 L12 14 H4 Z"/><path d="M5.5 5 V4 a2.5 2.5 0 0 1 5 0 V5"/>
    </svg>
  ),
  design: (p: GlyphProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M8 1.8 C4.2 1.8 1.8 4.2 1.8 7.6 C1.8 10.2 3.7 11.6 5.6 11.2 C6.6 11 7.1 11.8 6.8 12.7 C6.4 13.9 7.7 14.4 8.8 14.2 C12 13.6 14.2 10.8 14.2 7.6 C14.2 4.2 11.8 1.8 8 1.8 Z"/>
      <circle cx="5.4" cy="6" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="8" cy="4.9" r="0.9" fill="currentColor" stroke="none"/>
      <circle cx="10.6" cy="6.4" r="0.9" fill="currentColor" stroke="none"/>
    </svg>
  ),
  settings: (p: GlyphProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  // Desktop-system icons (used at 30x30)
  pc: (p: GlyphProps) => (
    <svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <rect x="3" y="5" width="24" height="16" rx="1.5"/><path d="M11 25 H19 M15 21 V25 M8 25 H22"/>
    </svg>
  ),
  recyclebin: (p: GlyphProps) => (
    <svg viewBox="0 0 28 30" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M3 7 H25"/><path d="M10 4 H18 V7 H10 Z"/>
      <path d="M5 7 L7 26 a1.5 1.5 0 0 0 1.5 1.5 H19.5 a1.5 1.5 0 0 0 1.5 -1.5 L23 7"/>
      <path d="M11 12 V23 M14 12 V23 M17 12 V23"/>
    </svg>
  ),
  folder: (p: GlyphProps) => (
    <svg viewBox="0 0 30 26" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M3 8 V22 a1.5 1.5 0 0 0 1.5 1.5 H25.5 a1.5 1.5 0 0 0 1.5 -1.5 V10.5 a1.5 1.5 0 0 0 -1.5 -1.5 H14 L11 6 H4.5 a1.5 1.5 0 0 0 -1.5 1.5 z"/>
    </svg>
  ),
  textfile: (p: GlyphProps) => (
    <svg viewBox="0 0 26 30" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" {...p}>
      <path d="M4 3 H16 L22 9 V27 H4 Z"/><path d="M16 3 V9 H22"/><path d="M8 14 H18 M8 18 H18 M8 22 H14"/>
    </svg>
  ),
} as const;

export type GlyphName = keyof typeof Glyph;
