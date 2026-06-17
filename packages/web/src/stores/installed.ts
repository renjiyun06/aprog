import { createSignal } from 'solid-js';
import { api } from '../lib/api';
import { findProgram, type ProgramDef } from '../programs/registry';

/* 用户安装了哪些智能程序——状态来自控制平面（GET/POST/DELETE /installations）。
   模型见 docs/program-model.html：安装即在桌面；任务栏只显示已打开的程序（运行时态，不在此）。
   系统应用（程序商店）是前端桌面常驻 chrome，不是智能程序、不走这套安装状态（见 DesktopIcons）。

   仅保存 id 列表；渲染所需的 label/glyph 由本地 registry（findProgram）按 id 解析。
   登录后由 Desktop 触发 loadInstalled()；install/uninstall 乐观更新本地信号 + 调后端，失败回滚。 */

const [ids, setIds] = createSignal<string[]>([]);

/** 已安装程序 id（响应式）。 */
export const installedIds = ids;

export function isInstalled(id: string): boolean { return ids().includes(id); }

/** 已安装程序的本地定义（按 id 解析 registry，丢弃未知 id）。 */
export function installedPrograms(): ProgramDef[] {
  return ids()
    .map((id) => findProgram(id))
    .filter((p): p is ProgramDef => p !== undefined);
}

/** 从后端拉取当前用户的安装列表（登录后调用）。未认证/出错则留空。 */
export async function loadInstalled(): Promise<void> {
  try {
    const { items } = await api.get<{ items: string[] }>('/installations');
    setIds(items);
  } catch {
    setIds([]);
  }
}

/** 安装：乐观加入 + POST；失败回滚。 */
export async function install(id: string): Promise<void> {
  if (ids().includes(id)) return;
  setIds([...ids(), id]);
  try {
    await api.post('/installations', { programId: id });
  } catch (e) {
    setIds(ids().filter((x) => x !== id));
    console.warn('[installed] install failed:', e);
  }
}

/** 卸载：乐观移除 + DELETE；失败回滚。 */
export async function uninstall(id: string): Promise<void> {
  if (!ids().includes(id)) return;
  const prev = ids();
  setIds(ids().filter((x) => x !== id));
  try {
    await api.del(`/installations/${encodeURIComponent(id)}`);
  } catch (e) {
    setIds(prev);
    console.warn('[installed] uninstall failed:', e);
  }
}
