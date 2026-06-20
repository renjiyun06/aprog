import { makeProgram } from '../shell-program';

/* UI 设计 (design) —— 进程列表与生命周期由控制平面驱动（见 stores/processes）。
   会话 / 文件等暂为本地占位，待接入沙箱。 */
export const Design = makeProgram('design', 'UI 设计');
