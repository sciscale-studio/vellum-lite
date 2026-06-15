import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, FolderOpen, Palette, Search, Info } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { tauriCommands } from '../utils/tauriCommands';
import AboutModal from './AboutModal';
import { getAvailableThemes } from '../theme';
import { getClampedPopoverPosition } from '../utils/popoverPosition';

interface ToolbarProps {
  loadFile: (path: string) => void;
}

const THEME_MENU_WIDTH = 176;
const THEME_MENU_ITEM_HEIGHT = 36;
const THEME_MENU_VERTICAL_PADDING = 8;

export default function Toolbar({ loadFile }: ToolbarProps) {
  const [showAbout, setShowAbout] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState({ left: 8, top: 40 });
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const {
    theme,
    setTheme,
    setSearchVisible,
    searchVisible,
  } = useAppStore();

  const handleOpenFile = async () => {
    const result = await tauriCommands.openFileDialog();
    if (result) loadFile(result.path);
  };

  const availableThemes = getAvailableThemes();
  const currentTheme = availableThemes.find((item) => item.id === theme) ?? availableThemes[0];

  const updateThemeMenuPosition = useCallback(() => {
    const button = themeButtonRef.current;
    if (!button) return;

    setThemeMenuPosition(getClampedPopoverPosition(button.getBoundingClientRect(), {
      width: THEME_MENU_WIDTH,
      height: availableThemes.length * THEME_MENU_ITEM_HEIGHT + THEME_MENU_VERTICAL_PADDING * 2,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, [availableThemes.length]);

  useLayoutEffect(() => {
    if (showThemes) updateThemeMenuPosition();
  }, [showThemes, updateThemeMenuPosition]);

  useEffect(() => {
    if (!showThemes) return;

    const closeThemeMenu = (event: MouseEvent) => {
      if (!themeMenuRef.current?.contains(event.target as Node)) {
        setShowThemes(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowThemes(false);
    };

    window.addEventListener('mousedown', closeThemeMenu);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updateThemeMenuPosition);
    return () => {
      window.removeEventListener('mousedown', closeThemeMenu);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updateThemeMenuPosition);
    };
  }, [showThemes, updateThemeMenuPosition]);

  return (
    <div className="flex items-center gap-1 px-2 shrink-0">
      <button
        onClick={handleOpenFile}
        className="p-1.5 rounded hover:bg-[var(--tab-hover)] text-[var(--text-color)]"
        title="Open File (Ctrl+O)"
      >
        <FolderOpen size={16} />
      </button>

      <div className="w-px h-4 bg-[var(--border-color)] mx-0.5" />

      <button
        onClick={() => setSearchVisible(!searchVisible)}
        className="p-1.5 rounded hover:bg-[var(--tab-hover)] text-[var(--text-color)]"
        title="Search (Ctrl+F)"
      >
        <Search size={16} />
      </button>

      <div className="relative" ref={themeMenuRef}>
        <button
          ref={themeButtonRef}
          onClick={() => setShowThemes((visible) => !visible)}
          className="p-1.5 rounded hover:bg-[var(--tab-hover)] text-[var(--text-color)]"
          title={`Theme: ${currentTheme.label} (Ctrl+Shift+T)`}
          aria-haspopup="menu"
          aria-expanded={showThemes}
        >
          <Palette size={16} />
        </button>

        {showThemes && (
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-color)] py-1 text-sm text-[var(--text-color)] shadow-xl"
            style={{ left: themeMenuPosition.left, top: themeMenuPosition.top }}
            role="menu"
          >
            {availableThemes.map((item) => (
              <button
                key={item.id}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--hover-bg)]"
                onClick={() => {
                  setTheme(item.id);
                  setShowThemes(false);
                }}
                role="menuitem"
              >
                <span
                  className="h-3 w-3 rounded-full border border-[var(--border-color)]"
                  style={{ backgroundColor: item.swatch }}
                />
                <span className="flex-1">{item.label}</span>
                {item.id === theme && <Check size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-[var(--border-color)] mx-0.5" />

      <button
        onClick={() => setShowAbout(true)}
        className="p-1.5 rounded hover:bg-[var(--tab-hover)] text-[var(--text-color)]"
        title="About Vellum"
      >
        <Info size={16} />
      </button>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
