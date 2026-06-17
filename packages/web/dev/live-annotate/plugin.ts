/**
 * live-annotate Vite 插件（仅开发期）
 *
 * 作用：dev server 运行时，给 aprog web 注入评论浮层（overlay.js），并提供评论读写 middleware。
 * 用于开发阶段直接在页面元素上贴反馈，方便对着具体元素沟通设计问题。
 *
 * 特性：
 *  - 仅 dev（apply: 'serve'）生效，生产 build 完全不含，零侵入产物。
 *  - 评论落 packages/web/.comments/comments.jsonl（append-only，已 gitignore）。
 *  - 与 overlay.js 约定接口：GET /comments?url=  POST /comment
 *
 * 接入：packages/web/vite.config.ts 的 plugins 中加入 liveAnnotate()。
 * 用法：页面里按 Alt+A 开/关标注模式，点元素写评论即落盘。
 */
import type { Plugin } from 'vite';

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// web 包根：packages/web/dev/live-annotate -> 上溯 2 级
const WEB_ROOT = join(__dirname, '..', '..');
const COMMENTS_FILE = join(WEB_ROOT, '.comments', 'comments.jsonl');
const OVERLAY_FILE = join(__dirname, 'overlay.js');

interface Comment {
  comment: string;
  id: string;
  selector: string;
  ts: string;
  url: string;
}

function readAll(): Comment[] {
  if (!existsSync(COMMENTS_FILE)) return [];
  const raw = readFileSync(COMMENTS_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Comment;
      } catch {
        return null;
      }
    })
    .filter((c): c is Comment => c !== null);
}

function newId(seed: number): string {
  return 'c-' + (seed.toString(36) + Math.floor(seed / 7).toString(36)).slice(0, 8);
}

export function liveAnnotate(): Plugin {
  return {
    name: 'aprog-live-annotate',
    apply: 'serve', // 仅 dev server 生效，build 不含

    configureServer(server) {
      if (!existsSync(dirname(COMMENTS_FILE))) {
        mkdirSync(dirname(COMMENTS_FILE), { recursive: true });
      }

      // GET /comments?url=<path>  列出某页评论（不传 url 返回全部）
      server.middlewares.use('/comments', (req, res) => {
        const u = new URL(req.url || '', 'http://localhost');
        const filterUrl = u.searchParams.get('url');
        const all = readAll();
        const out = filterUrl ? all.filter((c) => c.url === filterUrl) : all;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ comments: out }));
      });

      // POST /comment  写一条评论
      server.middlewares.use('/comment', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('method not allowed');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          let data: { comment?: unknown; selector?: unknown; url?: unknown };
          try {
            data = JSON.parse(body);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'bad json' }));
            return;
          }
          const { comment, selector, url } = data ?? {};
          if (!url || !selector || !comment) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'url, selector, comment required' }));
            return;
          }
          const row: Comment = {
            comment: String(comment).trim(),
            id: newId(Date.parse(new Date().toISOString())),
            selector: String(selector),
            ts: new Date().toISOString(),
            url: String(url),
          };
          // 兜底：目录可能被手动清理，写入前确保存在
          if (!existsSync(dirname(COMMENTS_FILE))) {
            mkdirSync(dirname(COMMENTS_FILE), { recursive: true });
          }
          appendFileSync(COMMENTS_FILE, JSON.stringify(row) + '\n');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ id: row.id, ok: true }));
        });
      });
    },

    // 把 overlay.js 内联注入每个 HTML 页面（dev）
    transformIndexHtml(html) {
      let overlay = '';
      try {
        overlay = readFileSync(OVERLAY_FILE, 'utf8');
      } catch {
        return html;
      }
      return html.replace(
        '</body>',
        `<script type="text/javascript">\n${overlay}\n</script>\n</body>`,
      );
    },
  };
}

export default liveAnnotate;
