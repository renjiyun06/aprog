// B 平面 · 数据平面公共出口（南面）。control-plane 跟沙箱内 driver 的常驻 WS 对话。
// 与 A 平面 sandbox/ 平级（见 docs/interaction.html）。帧契约来自 @aprog/protocol/channel。

export { DriverChannelServer, DRIVER_CHANNEL_PATH, type DriverConnection } from './channel.ts';
export { DriverRegistry, type DriverBinding } from './registry.ts';
