// @aprog/protocol — aprog 协议契约：所有跨线的类型化消息，分两组。
//   组① harness 事件（./harness）—— 引擎/harness 抽象出的语义流，纯值，web/CP/driver 三方共用。
//   组② 通信事件（./channel）—— driver↔CP 的通道帧（握手/seed/续签/引擎流…），两方共用，单向依赖组①
//      （仅 EngineEvent 帧驮一条 harness Event）。
// 顶层 barrel 便利地汇出两组；只想要单组可走子路径 @aprog/protocol/harness 或 /channel（web 只取 harness）。

export * from './harness/index.ts';
export * from './channel/index.ts';
