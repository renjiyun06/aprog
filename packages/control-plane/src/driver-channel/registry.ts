// driver 握手登记簿（最小实现）。
//
// create 沙箱时按 bindToken 登记「这条待拨入的 driver 连接属于哪个进程/沙箱」；driver 自启后拨
// /v1/driver/hello 带上 bindToken，控制平面据此认领、把连接钉到对应沙箱（create-time 绑定，
// 见 docs/interaction.html#trust）。
//
// 内存态——控制平面重启即清（running 进程会经 driver 重连补登记，属后续完整通道的事）。
// 完整 DriverChannelServer 落地后，这个登记簿并入其中；现在先支撑最小握手。

export interface DriverBinding {
  pid: number;
  sandboxId: string;
}

export class DriverRegistry {
  private readonly byToken = new Map<string, DriverBinding>();

  /** create 沙箱后登记 bindToken → 绑定。 */
  register(bindToken: string, binding: DriverBinding): void {
    this.byToken.set(bindToken, binding);
  }

  /** driver 拨入时认领：未知 token 返回 undefined（握手应拒）。保留登记以容许网络抖动重连。 */
  resolve(bindToken: string): DriverBinding | undefined {
    return this.byToken.get(bindToken);
  }

  /** 沙箱销毁时清除登记。 */
  unregister(bindToken: string): void {
    this.byToken.delete(bindToken);
  }
}
