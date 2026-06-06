// src/renderer/src/ipc/tauri-api.ts
// Tauri-based API wrapper — replaces Electron's window.electronAPI

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';

export interface FileFilter {
  name: string;
  extensions: string[];
}

// ── Dialog ──

export async function openFileDialog(filters: FileFilter[]): Promise<string | null> {
  try {
    const result = await open({
      multiple: false,
      filters: filters.map((f) => ({
        name: f.name,
        extensions: f.extensions,
      })),
    });
    return result as string | null;
  } catch {
    return null;
  }
}

export async function saveFileDialog(
  defaultName: string,
  filters: FileFilter[]
): Promise<string | null> {
  try {
    const result = await save({
      defaultPath: defaultName,
      filters: filters.map((f) => ({
        name: f.name,
        extensions: f.extensions,
      })),
    });
    return result as string | null;
  } catch {
    return null;
  }
}

// ── File System ──

export async function readFile(path: string): Promise<string> {
  return readTextFile(path);
}

export async function writeFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content);
}

export async function getDownloadDir(): Promise<string> {
  return invoke<string>('get_download_dir');
}

// ── Store (Settings) ──

export async function getSetting(key: string): Promise<string> {
  return invoke<string>('get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  await invoke('set_setting', { key, value });
}

// ── AI Fetch ──

export async function fetchAI(
  url: string,
  apiKey: string,
  body: object,
  method = 'POST'
): Promise<{ status: number; data: unknown }> {
  return invoke<{ status: number; data: unknown }>('fetch_ai', { url, apiKey, body, method });
}

// ── Figma Bridge ──

export async function getFigmaPort(): Promise<number> {
  return invoke<number>('get_figma_port');
}

export async function onSceneReceived(callback: (scene: unknown) => void): Promise<() => void> {
  const unlisten = await listen<unknown>('figma-bridge:scene-received', (event) => {
    callback(event.payload);
  });
  return unlisten;
}
