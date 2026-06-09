import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { getSetting } from "../ipc/tauri-api";
import { useCompilerStore } from "../store/compiler-store";
import { isThemeMode, setAppTheme } from "./theme";
import { TextContextMenu } from "../components/TextContextMenu";

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

        void setAppTheme(isThemeMode(theme) ? theme : "light");
      } catch {
        void setAppTheme("light");
      }
    }

    void loadSavedSettings();
  }, [setApiConfig]);

  return (
    <>
      <RouterProvider router={router} />
      <TextContextMenu />
    </>
  );
}
