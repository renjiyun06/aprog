// 沙箱层（A 平面）的公共类型。把沙箱当一个被托管的资源来管，各厂商高度一致，
// 所以这些类型是 provider-neutral 的；运行时只认一个不透明的 ImageRef——镜像怎么烘出来的
// （仓库顶层 images/<名>/<版本>/bake.ts，见 docs/sandbox.html#bake）对运行时不可见。

/** 厂商标识。多供应商是设计形态——这个联合类型就是扩展点。新增供应商时在此追加并补对应 SandboxProvider 实现。
 *  当前唯一落地实现是 PPIO（派欧云，E2B 同构托管，国内可回拨、自定义镜像可用）。
 *  AgentBay（阿里云无影）暂时下线（自定义镜像云构建/激活在平台侧不可用），需要时把 'agentbay' 加回此处并补实现。 */
export type ProviderId = 'ppio';

/** 一个已烘好的镜像/快照的不透明引用。怎么烘出来的（声明式/Dockerfile/跑后存）对运行时不可见。 */
export interface ImageRef {
  provider: ProviderId;
  /** 厂商侧的句柄：PPIO 的 template（缺省 base 镜像 code-interpreter，或 template build 出的自定义模板 id）。 */
  id: string;
}

/** 资源规格。注意各厂商口径不同：PPIO 由 template/SandboxOpts 决定，create 经 opts 传——这里仍作日志/契约。 */
export interface Resources {
  cpu: number;     // vCPU
  memory: number;  // GiB
  disk: number;    // GiB
  gpu?: number;
}

/** 运行中沙箱的句柄。 */
export interface SandboxHandle {
  id: string;
  provider: ProviderId;
  /**
   * 把 driver 的拨入连接绑定到本沙箱的标识（create-time 绑定）。
   * driver 自启后持「烘入镜像的凭证」拨向控制平面，控制平面据此把那条
   * DriverChannel 连接钉死到刚 create 的这个沙箱上。详见 docs/interaction.html#trust。
   */
  bindToken: string;
}
