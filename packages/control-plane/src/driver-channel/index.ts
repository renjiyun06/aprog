// B 平面 · 数据平面公共出口。control-plane 跟沙箱内 driver 的常驻对话。
// 与 A 平面 sandbox/ 平级（见 docs/interaction.html）。

export type {
  DriverChannel,
  DriverChannelServer,
  DriverFs,
  ControlSignal,
  InputItem,
} from './driver-channel.ts';
