import { makeProgram } from './shell-program';

/* 其余智能程序——同一套进程外壳，按 program id 由控制平面驱动（见 stores/processes）。
   一个新程序就是一行 makeProgram(id, 标题)。会话 / 文件暂为本地占位，待接入沙箱。 */
export const Requirement = makeProgram('requirement', '需求分析');
export const Jinglan = makeProgram('jinglan', '景兰开发');
export const Ruxiayuan = makeProgram('ruxiayuan', '如夏园开发');
export const Codebase = makeProgram('codebase', '代码库分析');
export const Docs = makeProgram('docs', '文档撰写');
export const TestGen = makeProgram('testgen', '测试生成');
