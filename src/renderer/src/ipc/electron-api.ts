// src/ipc/electron-api.ts

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface ElectronAPI {
  dialog: {
    openFile: (filters: FileFilter[]) => Promise<string | null>;
    saveFile: (defaultName: string, filters: FileFilter[]) => Promise<string | null>;
  };
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  figmaBridge: {
    getPort: () => Promise<number>;
    onSceneReceived: (callback: (scene: unknown) => void) => void;
  };
  fs: {
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<void>;
    getDefaultDownloadPath: () => Promise<string>;
  };
  network: {
    fetchAI: (url: string, apiKey: string, body: object) => Promise<{
      status: number;
      statusText: string;
      data: unknown;
    }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Safe accessor that works in both Electron and browser dev
export function getElectronAPI(): ElectronAPI | undefined {
  return window.electronAPI;
}
