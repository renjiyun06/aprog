// @aprog/driver — 引擎驱动包。常驻沙箱，进程入口在 ./main.ts（拨向控制平面握手 + 后续拉起引擎）。
//
// 包已清空旧骨架（channel/driver/sequencer/fs/supervisor/engine/bundle + engines/* 转换层），
// 等重设计；那批金标转换层代码在 git 历史 commit be00554。当前对外仅导出一个独立工具。

export { scrubEngineEnv } from './engine-env.ts';
