import { FileText, FilePlus } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { tauriCommands } from '../utils/tauriCommands';
import { isDarkTheme } from '../theme';

interface WelcomePageProps {
  loadFile: (path: string) => void;
}

export default function WelcomePage({ loadFile }: WelcomePageProps) {
  const { recentFiles, theme } = useAppStore();
  // Theme-aware icon — pick the variant whose backdrop contrasts with the
  // current app background so the mark always pops.
  const iconSrc = isDarkTheme(theme) ? '/vellum-light.png' : '/vellum-dark.png';

  const handleOpenFile = async () => {
    const result = await tauriCommands.openFileDialog();
    if (result) loadFile(result.path);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 select-none">
      <img
        src={iconSrc}
        alt="Vellum"
        className="w-20 h-20 mb-5"
        draggable={false}
      />
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Vellum</h1>
      <p className="text-gray-500 mb-10 text-center max-w-md">
        A quiet place to read Markdown.
      </p>

      <button
        onClick={handleOpenFile}
        className="flex flex-col items-center justify-center p-6 bg-[var(--sidebar-bg)] hover:bg-[var(--hover-bg)] rounded-xl transition-all group border border-[var(--border-color)] mb-10"
      >
        <FilePlus size={32} className="mb-3 text-[var(--link-color)] group-hover:scale-110 transition-transform" />
        <span className="font-medium">Open File</span>
        <span className="text-xs text-gray-500 mt-1">Ctrl + O</span>
      </button>

      {recentFiles.length > 0 && (
        <div className="w-full max-w-lg">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Files</h2>
          <div className="bg-[var(--sidebar-bg)] rounded-lg border border-[var(--border-color)] overflow-hidden">
            {recentFiles.map((path, i) => (
              <div
                key={i}
                className={`flex items-center p-3 cursor-pointer hover:bg-[var(--hover-bg)] ${i !== recentFiles.length - 1 ? 'border-b border-[var(--border-color)]' : ''}`}
                onClick={() => loadFile(path)}
              >
                <FileText size={18} className="text-gray-400 mr-3 flex-shrink-0" />
                <div className="truncate text-sm" title={path}>
                  <div className="font-medium truncate">{path.split(/[/\\]/).pop()}</div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">{path}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
