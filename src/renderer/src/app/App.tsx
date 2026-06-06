import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { getSetting } from "../ipc/tauri-api";
import { useCompilerStore } from "../store/compiler-store";

export default function App() {
  const setApiConfig = useCompilerStore((state) => state.setApiConfig);

  useEffect(() => {
    async function loadSavedSettings() {
      try {
        const [apiBaseUrl, apiKey, modelName, theme] = await Promise.all([
          getSetting("apiBaseUrl"),
          getSetting("apiKey"),
          getSetting("modelName"),
          getSetting("theme"),
        ]);

        setApiConfig({
          ...(apiBaseUrl ? { apiBaseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(modelName ? { modelName } : {}),
        });

        applyTheme(isThemeMode(theme) ? theme : "light");
      } catch {
        applyTheme("light");
      }
    }

    void loadSavedSettings();
  }, [setApiConfig]);

  return <RouterProvider router={router} />;
}

type ThemeMode = "light" | "dark" | "system";

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}
