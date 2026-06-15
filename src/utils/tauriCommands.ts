import { invoke } from '@tauri-apps/api/core';

export interface FileResult {
  path: string;
  content: string;
}

export interface SaveResult {
  path: string;
}

export const tauriCommands = {
  async openFileDialog(): Promise<FileResult | null> {
    return invoke<FileResult | null>('open_file_dialog');
  },

  async readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path });
  },

  async writeFile(path: string, content: string): Promise<void> {
    return invoke<void>('write_file', { path, content });
  },

  async fileExists(path: string): Promise<boolean> {
    return invoke<boolean>('file_exists', { path });
  },

  async pathExists(path: string): Promise<boolean> {
    return invoke<boolean>('path_exists', { path });
  },

  async openLocalPath(path: string): Promise<void> {
    return invoke<void>('open_local_path', { path });
  },

  async findPathByName(roots: string[], name: string): Promise<string | null> {
    return invoke<string | null>('find_path_by_name', { roots, name });
  },

  async saveMarkdownDialog(suggestedName: string, content: string): Promise<SaveResult | null> {
    return invoke<SaveResult | null>('save_markdown_dialog', { suggestedName, content });
  },

  async watchFile(path: string): Promise<void> {
    return invoke<void>('watch_file', { path });
  },

  async unwatchFile(): Promise<void> {
    return invoke<void>('unwatch_file');
  },

  async openDefaultAppsSettings(): Promise<void> {
    return invoke<void>('open_default_apps_settings');
  },

  async getInitialFile(): Promise<string | null> {
    return invoke<string | null>('get_initial_file');
  }
};
