/* Read-only syntax highlighting for the file viewer.

   highlight.js core + only the languages we actually need (keeps the bundle
   small — the full build registers ~190 languages). Returns ready-to-inject
   HTML with .hljs-* token classes; pair it with a github-dark theme. */
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml'; // covers html
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import 'highlight.js/styles/github-dark.css';

hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('bash', bash);

const EXT_LANG: Record<string, string> = {
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'css', less: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** highlight `code` based on `filename`'s extension; falls back to escaped plain text */
export function highlightFile(filename: string, code: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const lang = EXT_LANG[ext];
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      /* fall through to plain */
    }
  }
  return escapeHtml(code);
}
