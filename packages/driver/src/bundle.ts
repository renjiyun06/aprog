// BundleIO · 大块传输处理（引擎无关）。docs/interaction.html#s-wake / #s-ckpt。
// 收 bootstrap/restore（解包进进程目录 + 放 per-process auth）；在 quiescent 点产 checkpoint。

import type { IncomingBundle, BundleManifest } from './channel.ts';

export interface CheckpointBundle {
  manifest: BundleManifest;
  sha256: string;
  chunks: AsyncIterable<Uint8Array>;
}

export interface BundleIO {
  /** 收下并落地一个 incoming bundle（bootstrap 首灌 / restore 唤醒灌回）。 */
  apply(bundle: IncomingBundle, destRoot: string): Promise<void>;

  /** 在一致点收集 state 子集，产出可上行的 checkpoint。
   *  ❓「quiescent 一致点」何时到、收哪些 glob，归 state 技能定义——driver 只在被告知/被触发时取。 */
  produceCheckpoint(root: string, globs?: string[]): Promise<CheckpointBundle>;
}
