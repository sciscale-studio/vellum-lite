import { visit } from 'unist-util-visit';

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

/**
 * Remark plugin: turn Obsidian-style wikilinks into normal link nodes.
 *
 *   [[note]]              -> <a href="vellum://wiki/note">note</a>
 *   [[note|display]]      -> <a href="vellum://wiki/note">display</a>
 *   [[../sub/note]]       -> <a href="vellum://wiki/../sub/note">../sub/note</a>
 *
 * The href uses a vellum://wiki/ scheme so the click handler in
 * MarkdownView can recognize it, resolve the target relative to the
 * currently-open file's directory, and load it via Tauri.
 *
 * Target normalization (adding .md if missing, resolving relative paths)
 * happens at click time, not parse time, so the AST stays a faithful
 * representation of the source.
 */
export default function remarkWikilinks() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) return;
      const value: string = node.value;
      if (!value.includes('[[')) return;

      const newChildren: any[] = [];
      let lastEnd = 0;
      let match: RegExpExecArray | null;
      WIKILINK_RE.lastIndex = 0;
      while ((match = WIKILINK_RE.exec(value)) !== null) {
        const [full, target, alias] = match;
        if (match.index > lastEnd) {
          newChildren.push({ type: 'text', value: value.slice(lastEnd, match.index) });
        }
        newChildren.push({
          type: 'link',
          url: `vellum://wiki/${encodeURI(target.trim())}`,
          data: { hProperties: { className: 'wikilink' } },
          children: [{ type: 'text', value: (alias ?? target).trim() }],
        });
        lastEnd = match.index + full.length;
      }
      if (lastEnd === 0) return;
      if (lastEnd < value.length) {
        newChildren.push({ type: 'text', value: value.slice(lastEnd) });
      }
      parent.children.splice(index, 1, ...newChildren);
      return index + newChildren.length;
    });
  };
}
