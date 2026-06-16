// Lazy-loaded Mermaid renderer. Keeps initial bundle small — mermaid is
// only imported on first use.

import type { ThemeName } from '../theme';
import { isDarkTheme } from '../theme';

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;
let currentTheme: ThemeName = 'light';
let renderCounter = 0;

async function getMermaid(theme: ThemeName): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: isDarkTheme(theme) ? 'dark' : 'default',
        securityLevel: 'strict',
        fontFamily: 'inherit',
      });
      currentTheme = theme;
      return m;
    });
  }
  const m = await mermaidPromise;
  if (theme !== currentTheme) {
    m.initialize({
      startOnLoad: false,
      theme: isDarkTheme(theme) ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'inherit',
    });
    currentTheme = theme;
  }
  return m;
}

/**
 * Scan the container for <code class="language-mermaid"> blocks and replace
 * their parent <pre> with rendered SVG. Safe to call multiple times —
 * already-rendered blocks are skipped via a data-rendered marker.
 *
 * `isCancelled` lets the caller abort between async steps. Each <pre> is
 * also re-checked just before replacement, so two concurrent renders for
 * the same block can't both write SVG.
 */
export async function renderMermaidBlocks(
  container: HTMLElement,
  theme: ThemeName,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  if (isCancelled()) return;
  const initial = container.querySelectorAll<HTMLElement>(
    'code.language-mermaid:not([data-mermaid-rendered])',
  );
  if (initial.length === 0) return;

  const mermaid = await getMermaid(theme);
  if (isCancelled()) return;

  // Re-query — the DOM may have changed during the await above (theme switch,
  // re-render). The single render effect cancels its predecessor before the
  // next pass starts, and a cancelled pass bails before writing (the isCancelled
  // checks below), so two passes never both render the same block. We therefore
  // do NOT mark blocks "claimed": a claim that leaked when a pass was cancelled
  // mid-render (after claiming, before writing) left the block skipped forever
  // by every later pass — that was why diagrams sometimes stayed as raw text on
  // cold launch (content + theme settling racing the first mermaid import).
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(
      'code.language-mermaid:not([data-mermaid-rendered])',
    ),
  );

  for (const codeEl of blocks) {
    if (isCancelled()) return;
    if (!codeEl.isConnected) continue; // detached during a re-render
    const source = codeEl.textContent ?? '';
    const pre = codeEl.closest('pre');
    const host = pre ?? codeEl;
    if (!host.isConnected) continue;
    const id = `mermaid-${Date.now()}-${++renderCounter}`;

    try {
      const { svg, bindFunctions } = await mermaid.render(id, source);
      if (isCancelled() || !host.isConnected) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-diagram';
      wrapper.setAttribute('data-mermaid-rendered', '1');
      wrapper.setAttribute('data-mermaid-source', source);
      wrapper.innerHTML = svg;
      host.replaceWith(wrapper);
      if (bindFunctions) bindFunctions(wrapper);
    } catch (err) {
      if (isCancelled() || !host.isConnected) continue;
      const msg = err instanceof Error ? err.message : String(err);
      const errEl = document.createElement('pre');
      errEl.className = 'mermaid-error';
      errEl.setAttribute('data-mermaid-rendered', '1');
      errEl.textContent = `Mermaid render error:\n${msg}\n\nSource:\n${source}`;
      host.replaceWith(errEl);
    }
  }
}

/**
 * Re-render already-rendered diagrams under a new theme. Reads the original
 * source from data-mermaid-source and reverts each wrapper to a <pre><code
 * class="language-mermaid"> so the normal render path handles it.
 */
export function rerenderMermaidForTheme(
  container: HTMLElement,
  theme: ThemeName,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  if (isCancelled()) return Promise.resolve();
  container
    .querySelectorAll<HTMLElement>('.mermaid-diagram[data-mermaid-source]')
    .forEach((wrapper) => {
      const source = wrapper.getAttribute('data-mermaid-source') ?? '';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      code.textContent = source;
      pre.appendChild(code);
      wrapper.replaceWith(pre);
    });
  return renderMermaidBlocks(container, theme, isCancelled);
}
