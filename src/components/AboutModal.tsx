import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../stores/appStore';
import { isDarkTheme } from '../theme';
import { editionLabel } from '../edition';

interface AboutModalProps {
  onClose: () => void;
}

function countStats(raw: string) {
  if (!raw) return null;

  // Characters (excluding whitespace)
  const chars = raw.replace(/\s/g, '').length;

  // Chinese characters
  const chineseMatches = raw.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  const chineseChars = chineseMatches ? chineseMatches.length : 0;

  // English words (consecutive latin letters/numbers)
  const englishMatches = raw.match(/[a-zA-Z0-9]+/g);
  const englishWords = englishMatches ? englishMatches.length : 0;

  // Total words = chinese chars + english words
  const words = chineseChars + englishWords;

  // Lines
  const lines = raw.split('\n').length;

  // Token estimate:
  // - English: ~1 token per 0.75 words (GPT-like), so words / 0.75
  // - Chinese: ~1.5 tokens per character
  const tokenEstimate = Math.round(englishWords / 0.75 + chineseChars * 1.5);

  return { chars, words, chineseChars, englishWords, lines, tokenEstimate };
}

export default function AboutModal({ onClose }: AboutModalProps) {
  const rawMarkdown = useAppStore((s) => s.rawMarkdown);
  const currentFile = useAppStore((s) => s.currentFile);
  const theme = useAppStore((s) => s.theme);
  const [version, setVersion] = useState<string>('');

  // Designer ships two backdrop variants: pick the one that contrasts with
  // the current app theme so the mark always pops instead of blending in.
  const iconSrc = isDarkTheme(theme) ? '/vellum-light.png' : '/vellum-dark.png';

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const stats = useMemo(() => countStats(rawMarkdown), [rawMarkdown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[400px] p-6 relative select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded hover:bg-[var(--hover-bg)] text-[var(--text-color)] opacity-50 hover:opacity-100 transition-opacity"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col items-center text-center">
          <img
            src={iconSrc}
            alt="Vellum"
            className="w-14 h-14 mb-3"
            draggable={false}
          />
          <h2 className="text-lg font-semibold mb-1 tracking-tight">{editionLabel}</h2>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              openUrl('https://github.com/Liyue2341/vellum/releases');
            }}
            className="text-xs text-gray-500 mb-4 hover:text-[var(--link-color)] cursor-pointer transition-colors"
            title="Check for updates on GitHub"
          >
            {version ? `Version ${version}` : 'Version'} · check for updates
          </a>

          <p className="text-sm text-[var(--text-color)] mb-4 leading-relaxed">
            The lightest place to read Markdown.
          </p>

          {stats && currentFile && (
            <div className="w-full border-t border-[var(--border-color)] pt-4 mt-2 space-y-1.5 text-sm">
              <p className="text-xs text-gray-500 mb-2 font-medium">Document Stats</p>
              <div className="flex justify-between">
                <span className="text-gray-500">Words</span>
                <span>{stats.words.toLocaleString()}</span>
              </div>
              {stats.chineseChars > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500 pl-3 text-xs">Chinese</span>
                  <span className="text-xs">{stats.chineseChars.toLocaleString()} chars</span>
                </div>
              )}
              {stats.englishWords > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500 pl-3 text-xs">English</span>
                  <span className="text-xs">{stats.englishWords.toLocaleString()} words</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Characters</span>
                <span>{stats.chars.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Lines</span>
                <span>{stats.lines.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tokens (est.)</span>
                <span>~{stats.tokenEstimate.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="w-full border-t border-[var(--border-color)] pt-4 mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Author</span>
              <span>Yue Li</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Source</span>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openUrl('https://github.com/Liyue2341/vellum'); }}
                className="text-blue-500 hover:underline cursor-pointer"
              >
                github.com/Liyue2341/vellum
              </a>
            </div>
          </div>

          <p className="text-[10px] text-gray-400 mt-6">
            &copy; 2026 Yue Li
          </p>
        </div>
      </div>
    </div>
  );
}
