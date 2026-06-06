import { useCallback } from 'react';
import { useCompilerStore } from '../store/compiler-store';
import {
  compileLottieJson,
  compileCssToLottie,
  sampleBrowserAnimation,
} from '../engine/engine-bridge';
import { shouldPreferBrowserSampler } from '../engine/css-strategy';
import { hasPlayableAnimation } from '../engine/animation-spec';

export function useCompiler() {
  const {
    mode,
    sceneJson,
    specJson,
    cssCode,
    parseMode,
    cssDuration,
    cssFrameRate,
    canvasWidth,
    canvasHeight,
    setCompiling,
    setLottieOutput,
    setCompileError,
  } = useCompilerStore();

  const compile = useCallback(async () => {
    setCompiling(true);

    try {
      let output: object;

      switch (mode) {
        case 'json': {
          if (!sceneJson || !specJson) {
            throw new Error('请先加载 scene.json 和 animation-spec.json。');
          }
          output = compileLottieJson(sceneJson, specJson);
          if (!hasPlayableAnimation(output)) {
            throw new Error('生成的 Lottie 没有可播放关键帧，请检查 animation-spec.json 是否选中了真实图层，而不是根画布。');
          }
          break;
        }

        case 'css': {
          if (!cssCode.trim()) {
            throw new Error('请输入 CSS 或 React 动画代码。');
          }

          const options = {
            durationMs: cssDuration > 0 ? cssDuration : undefined,
            fps: cssFrameRate,
            width: canvasWidth,
            height: canvasHeight,
          };

          if (parseMode === 'browser' || (parseMode === 'auto' && shouldPreferBrowserSampler(cssCode))) {
            try {
              output = sampleBrowserAnimation(cssCode, options);
            } catch (error) {
              if (parseMode === 'browser') throw error;
              output = compileCssToLottie(cssCode, options);
            }
          } else {
            output = compileCssToLottie(cssCode, options);
          }
          break;
        }

        default:
          throw new Error('未知编译模式。');
      }

      setLottieOutput(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : '编译失败。';
      setCompileError(message);
    }
  }, [
    mode,
    sceneJson,
    specJson,
    cssCode,
    parseMode,
    cssDuration,
    cssFrameRate,
    canvasWidth,
    canvasHeight,
    setCompiling,
    setLottieOutput,
    setCompileError,
  ]);

  return { compile };
}
