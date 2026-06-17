// 极小路由器：注册 method + 路径模式（支持 :param 段）→ 处理器；按请求匹配出 handler + 路径参数。
// 故意保持朴素——路由不是逻辑所在地，只是把请求分发到对应 route 模块。

import type { Handler } from './context.ts';

interface Route {
  method: string;
  segs: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  /** 注册一条路由。pattern 形如 `/proc/:pid/stream`。 */
  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, segs: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  /** 匹配 method + path；命中返回 handler 与路径参数，否则 undefined。 */
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = path.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.segs.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.segs.length; i++) {
        const seg = r.segs[i]!;
        const part = parts[i]!;
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(part);
        else if (seg !== part) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return undefined;
  }
}
