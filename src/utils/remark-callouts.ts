import { visit } from 'unist-util-visit';

// Callout types we recognize. Anything not in this map becomes a "note"
// fallback so unknown types still render visually rather than silently
// dropping the [!unknown] marker into the prose.
const CALLOUT_TYPES = new Set([
  'note', 'info', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example',
  'quote', 'abstract', 'todo',
]);

// Match `[!type]` optionally followed by `+` (default open) or `-` (default
// collapsed). For now we ignore the open/collapse hint — non-foldable
// callouts in v0.4.0.
const CALLOUT_RE = /^\[!([a-zA-Z]+)\][+-]?\s*(.*)$/;

/**
 * Remark plugin: detect Obsidian-style callout blockquotes and turn them
 * into styled <div class="callout callout-{type}"> blocks.
 *
 * Input:
 *   > [!warning] Optional title
 *   > Body content here.
 *   > More body.
 *
 * The first text node of the first paragraph carries the [!type] marker.
 * If present, we strip the marker, separate the rest of that line as the
 * callout title (or use the type name if empty), and wrap everything in a
 * <div> with the callout class. The original blockquote node is replaced.
 */
export default function remarkCallouts() {
  return (tree: any) => {
    visit(tree, 'blockquote', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) return;
      const firstChild = node.children?.[0];
      if (!firstChild || firstChild.type !== 'paragraph') return;
      const firstPara = firstChild;
      const firstInline = firstPara.children?.[0];
      if (!firstInline || firstInline.type !== 'text') return;

      // Only the first line of the first paragraph can carry the marker.
      const firstLine = firstInline.value.split('\n')[0] ?? '';
      const match = firstLine.match(CALLOUT_RE);
      if (!match) return;

      let [, rawType, titleRest] = match;
      const type = rawType.toLowerCase();
      const safeType = CALLOUT_TYPES.has(type) ? type : 'note';
      const title = (titleRest || '').trim() ||
        rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();

      // Strip the marker line from the first text node. If there was content
      // after the first line in the same text node (multi-line text within
      // the marker paragraph), keep it.
      const restOfFirstLine = firstInline.value.slice(firstLine.length);
      if (restOfFirstLine.length > 0) {
        firstInline.value = restOfFirstLine.replace(/^\n/, '');
      } else if (firstPara.children.length > 1) {
        // The marker text node was the only content on its line, but the
        // paragraph has more inline children (rare — e.g. emphasis right
        // after the marker). Drop just the marker text node.
        firstPara.children.shift();
      } else {
        // The whole first paragraph WAS just the marker line. Drop it.
        node.children.shift();
      }

      // If after stripping, the first paragraph is empty, drop it too.
      if (
        firstPara.children.length === 1 &&
        firstPara.children[0].type === 'text' &&
        firstPara.children[0].value.trim() === ''
      ) {
        const idx = node.children.indexOf(firstPara);
        if (idx !== -1) node.children.splice(idx, 1);
      }

      // Wrap the remaining body in a callout-body div, and prepend a title.
      const newNode = {
        type: 'callout',
        data: {
          hName: 'div',
          hProperties: { className: ['callout', `callout-${safeType}`] },
        },
        children: [
          {
            type: 'callout-title',
            data: {
              hName: 'div',
              hProperties: { className: ['callout-title'] },
            },
            children: [
              {
                type: 'callout-icon',
                data: {
                  hName: 'span',
                  hProperties: {
                    className: ['callout-icon'],
                    'data-callout-type': safeType,
                  },
                },
                children: [],
              },
              {
                type: 'callout-title-text',
                data: {
                  hName: 'span',
                  hProperties: { className: ['callout-title-text'] },
                },
                children: [{ type: 'text', value: title }],
              },
            ],
          },
          {
            type: 'callout-body',
            data: {
              hName: 'div',
              hProperties: { className: ['callout-body'] },
            },
            children: node.children,
          },
        ],
      };

      parent.children[index] = newNode;
    });
  };
}
