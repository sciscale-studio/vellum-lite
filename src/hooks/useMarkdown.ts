import { useEffect, useRef } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';
import yaml from 'js-yaml';
import remarkWikilinks from '../utils/remark-wikilinks';
import remarkCallouts from '../utils/remark-callouts';
import { useAppStore, Heading } from '../stores/appStore';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render a parsed YAML value into a compact, readable HTML fragment.
// Strings/numbers/booleans become text; arrays become pill chips; objects
// become nested key/value rows. Mirrors Obsidian's "Properties" panel.
function renderYamlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '<span class="frontmatter-empty">—</span>';
  }
  if (value instanceof Date) {
    // js-yaml parses ISO dates into Date objects — render as YYYY-MM-DD when
    // there's no time component, otherwise full ISO.
    const iso = value.toISOString();
    return escapeHtml(iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="frontmatter-empty">[]</span>';
    return `<div class="frontmatter-tags">${value
      .map((v) => `<span class="frontmatter-tag">${escapeHtml(String(v))}</span>`)
      .join('')}</div>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '<span class="frontmatter-empty">{}</span>';
    return `<dl class="frontmatter-nested">${entries
      .map(
        ([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${renderYamlValue(v)}</dd>`,
      )
      .join('')}</dl>`;
  }
  return escapeHtml(String(value));
}

// Build processor once at module level
let headingsCollector: Heading[] = [];
let headingCounter = 0;
const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(() => (tree: any) => {
    // Transform the YAML frontmatter node (always at index 0 if present)
    // into a raw HTML node so it renders as a properties card instead of
    // being collapsed into a paragraph by CommonMark.
    if (!tree.children || tree.children.length === 0) return;
    const first = tree.children[0];
    if (first.type !== 'yaml') return;

    let rows = '';
    try {
      const data = yaml.load(first.value);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        rows = Object.entries(data as Record<string, unknown>)
          .map(
            ([k, v]) =>
              `<div class="frontmatter-row"><div class="frontmatter-key">${escapeHtml(
                k,
              )}</div><div class="frontmatter-value">${renderYamlValue(v)}</div></div>`,
          )
          .join('');
      } else {
        rows = `<pre class="frontmatter-raw">${escapeHtml(first.value)}</pre>`;
      }
    } catch {
      rows = `<pre class="frontmatter-raw">${escapeHtml(first.value)}</pre>`;
    }

    tree.children[0] = {
      type: 'html',
      value: `<aside class="markdown-frontmatter" aria-label="Document properties">${rows}</aside>`,
    };
  })
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkWikilinks)
  .use(remarkCallouts)
  .use(() => (tree: any) => {
    headingsCollector = [];
    headingCounter = 0;
    const usedIds = new Set<string>();
    visit(tree, 'heading', (node: any) => {
      let text = '';
      visit(node, 'text', (textNode: any) => { text += textNode.value; });
      visit(node, 'inlineCode', (codeNode: any) => { text += codeNode.value; });
      // Support Unicode (Chinese, etc.) — keep word chars and Unicode letters
      let id = text.toLowerCase().replace(/[\s]+/g, '-').replace(/[^\p{L}\p{N}_-]+/gu, '');
      if (!id) id = `heading-${headingCounter}`;
      // Deduplicate
      if (usedIds.has(id)) {
        let n = 1;
        while (usedIds.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      usedIds.add(id);
      headingCounter++;
      if (!node.data) node.data = {};
      if (!node.data.hProperties) node.data.hProperties = {};
      node.data.hProperties.id = id;
      headingsCollector.push({ level: node.depth, text, id });
    });
  })
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeHighlight, { plainText: ['mermaid', 'vega-lite', 'vega'] })
  .use(rehypeKatex)
  .use(rehypeStringify, { allowDangerousHtml: true });

export function useMarkdown() {
  const rawMarkdown = useAppStore((s) => s.rawMarkdown);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const pending = useRef(0);

  useEffect(() => {
    if (rawMarkdown) {
      const id = ++pending.current;
      processor.process(rawMarkdown).then((file) => {
        if (id !== pending.current) return; // stale
        useAppStore.getState().updateActiveTab({
          renderedHTML: String(file),
          headings: [...headingsCollector],
        });
      }).catch((error) => {
        console.error("Failed to process markdown", error);
      });
    } else if (activeTabId) {
      useAppStore.getState().updateActiveTab({
        renderedHTML: '',
        headings: [],
      });
    }
  }, [rawMarkdown, activeTabId]);
}
