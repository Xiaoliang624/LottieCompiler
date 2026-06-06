import { setWindowTheme } from '../ipc/tauri-api';

export type ThemeMode = 'light' | 'dark' | 'system';

let stopSystemThemeWatch: (() => void) | null = null;

export async function setAppTheme(theme: ThemeMode) {
  stopSystemThemeWatch?.();
  stopSystemThemeWatch = null;

  await applyTheme(theme);

  if (theme === 'system') {
    stopSystemThemeWatch = watchSystemTheme();
  }
}

export async function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark));

  try {
    await setWindowTheme(theme === 'system' ? null : theme);
  } catch {}
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function watchSystemTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    void applyTheme('system');
  };

  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}
