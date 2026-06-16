import { useEffect, useRef, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { convertFileSrc } from '@tauri-apps/api/core';
import { dirname, resolve } from '@tauri-apps/api/path';
import { useAppStore } from '../stores/appStore';
import { tauriCommands } from '../utils/tauriCommands';
import { renderMermaidBlocks, rerenderMermaidForTheme } from '../utils/mermaid';
import { renderVegaBlocks, rerenderVegaForTheme } from '../utils/vega';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MARKDOWN_EXT_RE = /\.(md|mdx|markdown)$/i;
const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const LOCAL_FILE_EXTENSION_RE = /\.[a-z][a-z0-9]{0,9}$/i;

function stripLinkSuffix(href: string) {
  return href.split('#', 1)[0].split('?', 1)[0];
}

function hasExplicitExtension(path: string) {
  return /\.[^\\/]+$/.test(path);
}

function decodeLinkPath(path: string) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function isAbsoluteLocalPath(path: string) {
  return WINDOWS_ABSOLUTE_PATH_RE.test(path) || path.startsWith('/') || path.startsWith('\\');
}

function fileUrlToPath(href: string) {
  const url = new URL(href);
  let path = decodeURIComponent(url.pathname);
  if (/^\/[a-zA-Z]:\//.test(path)) {
    path = path.slice(1);
  }
  return path;
}

function isExternalResource(src: string) {
  if (src.startsWith('data:')) return true;
  if (src.startsWith('blob:')) return true;
  return EXTERNAL_SCHEME_RE.test(src) && !src.startsWith('file://') && !WINDOWS_ABSOLUTE_PATH_RE.test(src);
}

function looksLikeLocalFileReference(value: string) {
  const target = value.trim();
  if (!target) return false;
  if (target.startsWith('file://')) return true;
  if (isExternalResource(target)) return false;
  if (isAbsoluteLocalPath(target)) return true;
  if (target.startsWith('./') || target.startsWith('../')) return true;
  if (target.includes('/') || target.includes('\\')) return true;
  if (LOCAL_FILE_EXTENSION_RE.test(target)) return true;
  return false;
}

function isBareLocalName(value: string) {
  return (
    !value.startsWith('file://') &&
    !isAbsoluteLocalPath(value) &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

async function resolveLocalPath(target: string, currentFile: string | null) {
  if (target.startsWith('file://')) return fileUrlToPath(target);
  if (isAbsoluteLocalPath(target)) return target;
  if (!currentFile) return target;
  return resolve(await dirname(currentFile), target);
}

async function dirnameOrNull(path: string) {
  try {
    return await dirname(path);
  } catch {
    return null;
  }
}

async function resolveLocalPathCandidates(target: string, currentFile: string | null) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    candidates.push(path);
  };

  if (target.startsWith('file://')) {
    addCandidate(fileUrlToPath(target));
    return candidates;
  }

  if (isAbsoluteLocalPath(target) || !currentFile) {
    addCandidate(target);
    return candidates;
  }

  let base = await dirname(currentFile);
  while (true) {
    addCandidate(await resolve(base, target));
    const parent = await dirnameOrNull(base);
    if (!parent) break;
    if (parent === base) break;
    base = parent;
  }

  return candidates;
}

async function getAncestorDirs(currentFile: string | null, limit = 4) {
  const dirs: string[] = [];
  if (!currentFile) return dirs;

  let base = await dirname(currentFile);
  while (dirs.length < limit) {
    dirs.push(base);
    const parent = await dirnameOrNull(base);
    if (!parent) break;
    if (parent === base) break;
    base = parent;
  }

  return dirs;
}

async function findExistingLocalPath(target: string, currentFile: string | null) {
  const candidates = await resolveLocalPathCandidates(target, currentFile);
  for (const candidate of candidates) {
    if (await tauriCommands.pathExists(candidate)) return candidate;
  }

  if (currentFile && isBareLocalName(target)) {
    const found = await tauriCommands.findPathByName(await getAncestorDirs(currentFile), target);
    if (found) return found;
  }

  return null;
}

interface MarkdownViewProps {
  loadFile: (path: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  occurrenceIndex: number;
}

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SavedSelection {
  selectedText: string;
  occurrenceIndex: number;
  rects: SelectionRect[];
}

export default function MarkdownView({ loadFile }: MarkdownViewProps) {
  const renderedHTML = useAppStore((s) => s.renderedHTML);
  const rawMarkdown = useAppStore((s) => s.rawMarkdown);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchCaseSensitive = useAppStore((s) => s.searchCaseSensitive);
  const currentMatch = useAppStore((s) => s.currentMatch);
  const currentFile = useAppStore((s) => s.currentFile);
  const theme = useAppStore((s) => s.theme);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const noticeTimeoutRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [savedSelection, setSavedSelection] = useState<SavedSelection | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, 3200);
  };

  useEffect(() => {
    setSavedSelection(null);
    setContextMenu(null);
  }, [renderedHTML, currentFile]);

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  useEffect(() => {
    const closeMenus = () => closeContextMenu();
    window.addEventListener('scroll', closeMenus, true);
    return () => {
      window.removeEventListener('scroll', closeMenus, true);
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  const countOccurrences = (value: string, needle: string) => {
    if (!needle) return 0;
    let count = 0;
    let index = value.indexOf(needle);
    while (index !== -1) {
      count++;
      index = value.indexOf(needle, index + needle.length);
    }
    return count;
  };

  const getSelectionSnapshot = () => {
    const selection = window.getSelection();
    const root = rootRef.current;
    const container = contentRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !root || !container) {
      return { selectedText: '', occurrenceIndex: 0, rects: [] as SelectionRect[] };
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      return { selectedText: '', occurrenceIndex: 0, rects: [] as SelectionRect[] };
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      return { selectedText: '', occurrenceIndex: 0, rects: [] as SelectionRect[] };
    }

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(container);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const occurrenceIndex = countOccurrences(prefixRange.toString(), selectedText);
    const rootRect = root.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      }));

    return { selectedText, occurrenceIndex, rects };
  };

  const pointInsideSelection = (clientX: number, clientY: number, rects: SelectionRect[]) => {
    const root = rootRef.current;
    if (!root) return false;
    const rootRect = root.getBoundingClientRect();
    const x = clientX - rootRect.left;
    const y = clientY - rootRect.top;

    return rects.some((rect) =>
      x >= rect.left - 4 &&
      x <= rect.left + rect.width + 4 &&
      y >= rect.top - 4 &&
      y <= rect.top + rect.height + 4
    );
  };

  const saveCurrentSelection = () => {
    const snapshot = getSelectionSnapshot();
    if (snapshot.selectedText && snapshot.rects.length > 0) {
      setSavedSelection(snapshot);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    closeContextMenu();
    if (savedSelection && !pointInsideSelection(e.clientX, e.clientY, savedSelection.rects)) {
      setSavedSelection(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    saveCurrentSelection();
  };

  const getLiveContentSelectionText = () => {
    const selection = window.getSelection();
    const container = contentRef.current;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';

    const range = selection.getRangeAt(0);
    if (!container?.contains(range.commonAncestorContainer)) return null;

    return selection.toString();
  };

  const refreshCurrentFile = async () => {
    if (!currentFile) return;
    try {
      const content = await tauriCommands.readFile(currentFile);
      useAppStore.getState().updateActiveTab({ rawMarkdown: content });
      showNotice('Document refreshed');
    } catch (err) {
      console.error('Failed to refresh document', err);
      showNotice('Could not refresh document');
    }
  };

  const saveAsMarkdown = async () => {
    const suggestedName = currentFile?.split(/[/\\]/).pop() || 'document.md';
    try {
      const result = await tauriCommands.saveMarkdownDialog(suggestedName, rawMarkdown);
      if (result) showNotice(`Saved: ${result.path.split(/[/\\]/).pop()}`);
    } catch (err) {
      console.error('Failed to save markdown', err);
      showNotice('Could not save Markdown');
    }
  };

  const copySelection = async (selectedText: string) => {
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      showNotice('Copied');
    } catch {
      showNotice('Could not copy selection');
    }
  };

  const errorMessage = (err: unknown, fallback: string) => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    return fallback;
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const savedSelectionAtPoint =
      savedSelection && pointInsideSelection(e.clientX, e.clientY, savedSelection.rects)
        ? savedSelection
        : null;
    const snapshot = getSelectionSnapshot();
    const selection = savedSelectionAtPoint ?? (snapshot.selectedText ? snapshot : savedSelection);
    if (savedSelectionAtPoint) {
      setSavedSelection(savedSelectionAtPoint);
    } else if (snapshot.selectedText) {
      setSavedSelection(snapshot);
    } else if (
      savedSelection &&
      !pointInsideSelection(e.clientX, e.clientY, savedSelection.rects)
    ) {
      setSavedSelection(null);
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      selectedText: selection?.selectedText ?? '',
      occurrenceIndex: selection?.occurrenceIndex ?? 0,
    });
  };

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      const liveSelection = getLiveContentSelectionText();
      if (liveSelection === null) return;

      const selectedText = liveSelection || savedSelection?.selectedText;
      if (!selectedText) return;

      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectedText);
      if (!e.clipboardData) {
        navigator.clipboard?.writeText(selectedText).catch(() => {
          showNotice('Could not copy selection');
        });
      }
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [savedSelection]);

  // Compute highlighted HTML from string (no DOM manipulation)
  const { displayHTML, matchCount } = useMemo(() => {
    if (!searchQuery || !renderedHTML) return { displayHTML: renderedHTML, matchCount: 0 };

    let count = 0;
    const escaped = escapeRegex(searchQuery);
    const regex = new RegExp(escaped, searchCaseSensitive ? 'g' : 'gi');

    // Split HTML into tags and text, only highlight in text segments
    const parts = renderedHTML.split(/(<[^>]*>)/);
    const highlighted = parts.map(part => {
      if (part.startsWith('<')) return part;
      return part.replace(regex, (match) => {
        count++;
        const bg = count === currentMatch ? '#f97316' : '#fbbf24';
        return `<mark data-search="${count}" style="background-color:${bg};color:#000;border-radius:2px;padding:1px 2px">${match}</mark>`;
      });
    }).join('');

    return { displayHTML: highlighted, matchCount: count };
  }, [renderedHTML, searchQuery, currentMatch, searchCaseSensitive]);

  // Sync match count to store
  useEffect(() => {
    const state = useAppStore.getState();
    if (state.searchMatches !== matchCount) {
      state.setSearchMatches(matchCount);
    }
    if (matchCount > 0 && state.currentMatch === 0) {
      state.setCurrentMatch(1);
    }
    if (matchCount === 0 && state.currentMatch !== 0) {
      state.setCurrentMatch(0);
    }
  }, [matchCount]);

  // Scroll to current match
  useEffect(() => {
    if (currentMatch < 1) return;
    requestAnimationFrame(() => {
      const el = contentRef.current?.querySelector(`mark[data-search="${currentMatch}"]`) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [currentMatch, displayHTML]);

  // Mark inline code spans that can be opened as local file references.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    container.querySelectorAll('code').forEach((code) => {
      if (code.closest('pre')) return;
      const value = code.textContent?.trim() ?? '';
      const isFileReference = looksLikeLocalFileReference(value);
      code.classList.toggle('file-reference', isFileReference);
      if (isFileReference) {
        code.setAttribute('title', 'Open file or folder');
      } else {
        code.removeAttribute('title');
      }
    });
  }, [displayHTML]);

  // Link click handler
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const openLocalTarget = async (value: string) => {
      const rawTarget = decodeLinkPath(stripLinkSuffix(value.trim()));
      const linkTargets = hasExplicitExtension(rawTarget)
        ? [rawTarget]
        : [`${rawTarget}.md`, rawTarget];

      for (const linkTarget of linkTargets) {
        const absolute = await findExistingLocalPath(linkTarget, currentFile);
        if (!absolute) continue;
        if (MARKDOWN_EXT_RE.test(linkTarget)) {
          loadFile(absolute);
        } else {
          await tauriCommands.openLocalPath(absolute);
        }
        return;
      }

      showNotice(`File not found: ${rawTarget}`);
    };

    const handleLinkClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor) {
        const code = target.closest('code');
        if (!code || code.closest('pre')) return;
        const codeTarget = code.textContent?.trim() ?? '';
        if (!looksLikeLocalFileReference(codeTarget)) return;

        e.preventDefault();
        try {
          await openLocalTarget(codeTarget);
        } catch (err) {
          console.error('Failed to open inline file reference', codeTarget, err);
          showNotice(errorMessage(err, `Could not open: ${codeTarget}`));
        }
        return;
      }

      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        try {
          await openUrl(href);
        } catch (err) {
          console.error('Failed to open external link', err);
          showNotice(errorMessage(err, 'Could not open link'));
        }
      } else if (href.startsWith('vellum://wiki/')) {
        e.preventDefault();
        if (!currentFile) return;
        // Strip scheme prefix and decode the path the wikilink plugin URI-encoded.
        let target = decodeURI(href.slice('vellum://wiki/'.length));
        // Wikilinks default to Markdown when no explicit extension is given.
        if (!/\.[a-z0-9]+$/i.test(target)) target += '.md';
        try {
          const absolute = await findExistingLocalPath(target, currentFile);
          if (absolute) {
            loadFile(absolute);
          } else {
            showNotice(`File not found: ${target}`);
          }
        } catch (err) {
          console.error('Failed to resolve wikilink', target, err);
          showNotice(errorMessage(err, `Could not open: ${target}`));
        }
      } else if (href.startsWith('#')) {
        e.preventDefault();
        const targetId = href.substring(1);
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        const isExternalScheme =
          EXTERNAL_SCHEME_RE.test(href) &&
          !href.startsWith('file://') &&
          !WINDOWS_ABSOLUTE_PATH_RE.test(href);
        if (isExternalScheme) {
          e.preventDefault();
          try {
            await openUrl(href);
          } catch (err) {
            console.error('Failed to open external link', err);
            showNotice(errorMessage(err, 'Could not open link'));
          }
          return;
        }

        e.preventDefault();
        try {
          await openLocalTarget(href);
        } catch (err) {
          console.error('Failed to resolve file link', href, err);
          showNotice(errorMessage(err, `Could not open: ${href}`));
        }
      }
    };

    container.addEventListener('click', handleLinkClick);
    return () => container.removeEventListener('click', handleLinkClick);
  }, [displayHTML, currentFile, loadFile]);

  // Image src conversion
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const images = container.querySelectorAll('img');
    images.forEach(async img => {
      const src = img.getAttribute('src');
      if (!src || isExternalResource(src)) return;
      try {
        const localPath = await resolveLocalPath(decodeLinkPath(stripLinkSuffix(src)), currentFile);
        img.src = convertFileSrc(localPath);
      } catch (e) {
        console.warn("Could not convert image src", src);
      }
    });
  }, [displayHTML, currentFile]);

  // Render Mermaid + Vega diagrams on content or theme change. The cancelled
  // flag is checked inside the renderers between async steps so a re-render
  // (e.g. theme load completing right after content load on cold launch)
  // can supersede an in-flight render without leaving half-rendered DOM.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    let retryTimer = 0;
    let attempts = 0;

    const pendingDiagram = () =>
      container.querySelector(
        'code.language-mermaid:not([data-mermaid-rendered]), ' +
        'code.language-vega-lite:not([data-vega-rendered]), ' +
        'code.language-vega:not([data-vega-rendered])',
      );

    const renderDiagrams = async (retry: boolean) => {
      if (cancelled) return;
      // First pass reverts diagrams drawn under the old theme, then renders.
      // Retries only fill in blocks a superseded pass missed — no revert, so
      // already-rendered diagrams are left untouched.
      if (retry) {
        await renderMermaidBlocks(container, theme, isCancelled);
        await renderVegaBlocks(container, theme, isCancelled);
      } else {
        await rerenderMermaidForTheme(container, theme, isCancelled);
        await rerenderVegaForTheme(container, theme, isCancelled);
      }
      if (cancelled) return;
      // Cold launch races content + settings loading against the first (slow)
      // mermaid/vega chunk import, so the opening pass can be superseded before
      // it draws. Retry briefly until every diagram block has rendered.
      if (pendingDiagram() && attempts < 8) {
        attempts++;
        retryTimer = window.setTimeout(() => {
          renderDiagrams(true).catch(() => {});
        }, 120);
      }
    };

    renderDiagrams(false).catch((e) => {
      if (!cancelled) console.error('Diagram render failed', e);
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [renderedHTML, theme]);

  return (
    <div
      ref={rootRef}
      className="relative box-border w-full max-w-none px-6 py-8 pb-32 sm:px-8 lg:px-10"
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div
        ref={contentRef}
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: displayHTML }}
      />
      {savedSelection?.rects.map((rect, index) => (
        <div
          key={`${rect.left}-${rect.top}-${index}`}
          className="pointer-events-none absolute z-40 rounded-sm bg-[var(--link-color)]/25"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-color)] py-1 text-sm text-[var(--text-color)] shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {contextMenu.selectedText && (
            <>
              <button
                className="block w-full px-4 py-2 text-left hover:bg-[var(--hover-bg)]"
                onClick={() => { copySelection(contextMenu.selectedText); closeContextMenu(); }}
              >
                Copy
              </button>
              <div className="my-1 border-t border-[var(--border-color)]" />
            </>
          )}
          <button
            className="block w-full px-4 py-2 text-left hover:bg-[var(--hover-bg)]"
            onClick={() => { refreshCurrentFile(); closeContextMenu(); }}
          >
            Refresh document
          </button>
          <button
            className="block w-full px-4 py-2 text-left hover:bg-[var(--hover-bg)]"
            onClick={() => { saveAsMarkdown(); closeContextMenu(); }}
          >
            Save as Markdown...
          </button>
          <button
            className="block w-full px-4 py-2 text-left hover:bg-[var(--hover-bg)]"
            onClick={() => { window.print(); closeContextMenu(); }}
          >
            Print
          </button>
        </div>
      )}
      {notice && (
        <div
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-md border border-[var(--border-color)] bg-[var(--sidebar-bg)] px-4 py-3 text-sm text-[var(--text-color)] shadow-xl"
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
