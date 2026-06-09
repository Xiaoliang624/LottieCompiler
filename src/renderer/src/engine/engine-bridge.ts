// src/engine/engine-bridge.ts
// Wraps the three JS engine files loaded via <script> tags.
// Each engine registers globals on `window`.

// ── Types ──

interface CssCompileOptions {
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
}

interface SampleOptions {
  code: string;
  fps: number;
  width: number;
  height: number;
  durationMs?: number | null;
}

// ── compiler-core.js globals ──

declare global {
  function buildLottie(scene: object, spec: object): object;
  function buildLottieFromCode(code: string, options: CssCompileOptions): object;
  function inferAnimationDurationFromCode(code: string): number;
  interface Window {
    __lottieBrowserSampler?: {
      sampleSync(code: string, options: SampleOptions): object;
    };
  }
}

// ── JSON Mode: scene.json + spec.json → Lottie JSON ──

export function compileLottieJson(sceneJson: object, specJson: object): object {
  if (typeof buildLottie !== 'function') {
    throw new Error('compiler-core.js 未加载，请确认 index.html 已包含该脚本。');
  }
  try {
    return buildLottie(sceneJson, specJson);
  } catch (e) {
    throw new Error(`Lottie 编译失败：${(e as Error).message}`);
  }
}

// ── CSS Mode: CSS/React code → Lottie JSON (static parsing) ──

export function compileCssToLottie(
  code: string,
  options: CssCompileOptions = {}
): object {
  if (typeof buildLottieFromCode !== 'function') {
    throw new Error('css-to-lottie-core.js 未加载。');
  }
  try {
    return buildLottieFromCode(code, options);
  } catch (e) {
    throw new Error(`CSS 编译失败：${(e as Error).message}`);
  }
}

export function inferDuration(code: string): number {
  if (typeof inferAnimationDurationFromCode !== 'function') {
    return 2000; // default 2 seconds
  }
  try {
    return inferAnimationDurationFromCode(code);
  } catch {
    return 2000;
  }
}

// ── CSS Mode: Browser DOM sampling → Lottie JSON ──

export function sampleBrowserAnimation(
  code: string,
  options: { fps?: number; width?: number; height?: number; durationMs?: number } = {}
): object {
  const sampler = window.__lottieBrowserSampler;
  if (!sampler || typeof sampler.sampleSync !== 'function') {
    throw new Error('browser-sampler-core.js 未加载。');
  }
  try {
    return sampler.sampleSync(code, {
      code,
      fps: options.fps ?? 60,
      width: options.width ?? 390,
      height: options.height ?? 390,
      durationMs: options.durationMs ?? null,
    });
  } catch (e) {
    throw new Error(`浏览器采样失败：${(e as Error).message}`);
  }
}
