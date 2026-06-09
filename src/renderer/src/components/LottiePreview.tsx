import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationItem, BMEnterFrameEvent } from 'lottie-web';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCompilerStore } from '../store/compiler-store';
import { summarizeLottie } from '../engine/animation-spec';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function createPreviewAnimationData(lottieOutput: object): object {
  const output = JSON.parse(JSON.stringify(lottieOutput)) as JsonRecord;
  const ip = numberValue(output.ip) ?? 0;
  const op = numberValue(output.op) ?? 0;
  if (op - ip > 1) {
    output.op = op - 1;
  }
  return output;
}

export function LottiePreview() {
  const lottieOutput = useCompilerStore((s) => s.lottieOutput);
  const isCompiling = useCompilerStore((s) => s.isCompiling);
  const compileError = useCompilerStore((s) => s.compileError);

  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<AnimationItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const summary = useMemo(() => (lottieOutput ? summarizeLottie(lottieOutput) : []), [lottieOutput]);
  const progress = totalFrames > 0 ? Math.min(1, Math.max(0, currentFrame / totalFrames)) : 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!lottieOutput || !container) return;
    const previewContainer: HTMLDivElement = container;
    const currentOutput = lottieOutput;

    let cancelled = false;
    let animation: AnimationItem | null = null;
    const cleanupListeners: Array<() => void> = [];

    previewContainer.innerHTML = '';
    setPreviewError(null);
    setIsPlaying(true);
    setCurrentFrame(0);
    setTotalFrames(0);

    async function loadAnimation() {
      try {
        const lottie = (await import('lottie-web')).default;
        if (cancelled) return;

        previewContainer.innerHTML = '';
        const animationData = createPreviewAnimationData(currentOutput);
        const previewRoot = asRecord(animationData);
        animation = lottie.loadAnimation({
          container: previewContainer,
          renderer: 'svg',
          animationData,
          loop: true,
          autoplay: true,
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid meet',
            progressiveLoad: true,
          },
        });

        animation.setSubframe(false);

        const syncFrameInfo = () => {
          if (!animation) return;
          const frames = animation.totalFrames || animation.getDuration(true) || numberValue(previewRoot.op) || 0;
          setTotalFrames(Math.max(0, Math.round(frames)));
          setCurrentFrame(Math.max(0, Math.round(animation.currentFrame || 0)));
        };

        const handleFrame = (event: BMEnterFrameEvent) => {
          setCurrentFrame(Math.max(0, Math.round(event.currentTime)));
          setTotalFrames(Math.max(0, Math.round(event.totalTime)));
        };

        const handleLoaded = () => {
          syncFrameInfo();
          animation?.play();
          setIsPlaying(true);
        };

        const handleFailed = () => {
          setPreviewError('Lottie 预览加载失败，请检查生成结果中的图层、图片资源或路径。');
          setIsPlaying(false);
        };

        cleanupListeners.push(animation.addEventListener('enterFrame', handleFrame));
        cleanupListeners.push(animation.addEventListener('DOMLoaded', handleLoaded));
        cleanupListeners.push(animation.addEventListener('data_ready', handleLoaded));
        cleanupListeners.push(animation.addEventListener('data_failed', handleFailed));
        cleanupListeners.push(animation.addEventListener('error', handleFailed));

        animationRef.current = animation;
        syncFrameInfo();
      } catch (err) {
        console.error('Failed to load Lottie animation:', err);
        setPreviewError(err instanceof Error ? err.message : 'Lottie 预览加载失败。');
      }
    }

    loadAnimation();
    return () => {
      cancelled = true;
      cleanupListeners.forEach((cleanup) => cleanup());
      animation?.destroy();
      if (animationRef.current === animation) animationRef.current = null;
      previewContainer.innerHTML = '';
    };
  }, [lottieOutput]);

  const togglePlay = useCallback(() => {
    const animation = animationRef.current;
    if (!animation || previewError) return;
    if (isPlaying) {
      animation.pause();
    } else {
      animation.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, previewError]);

  const reset = useCallback(() => {
    const animation = animationRef.current;
    animation?.stop();
    animation?.goToAndStop(0, true);
    setCurrentFrame(0);
    setIsPlaying(false);
  }, []);

  const seek = useCallback((value: number) => {
    const animation = animationRef.current;
    if (!animation || totalFrames <= 0 || previewError) return;
    const frame = Math.round(value * totalFrames);
    animation.pause();
    animation.goToAndStop(frame, true);
    setCurrentFrame(frame);
    setIsPlaying(false);
  }, [previewError, totalFrames]);

  if (isCompiling) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-blue-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">正在编译...</span>
        </div>
      </div>
    );
  }

  if (compileError) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-red-500 text-sm font-medium mb-1">编译失败</div>
          <p className="text-xs text-neutral-500 max-w-xs">{compileError}</p>
        </div>
      </div>
    );
  }

  if (!lottieOutput) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-neutral-400">
          <Play className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">暂无动画</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-[#f8fafc] bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]">
        <div ref={containerRef} className="w-full h-full flex items-center justify-center min-h-0 [&>svg]:max-w-full [&>svg]:max-h-full" />
        {previewError && (
          <div className="absolute inset-0 flex items-center justify-center p-4 bg-white/80 text-center text-sm text-red-500 dark:bg-neutral-950/80">
            {previewError}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 p-3 border-t border-neutral-100 dark:border-neutral-800 shrink-0">
        <button
          onClick={togglePlay}
          disabled={Boolean(previewError)}
          className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 disabled:opacity-40"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={reset}
          disabled={Boolean(previewError)}
          className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 disabled:opacity-40"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(event) => seek(Number(event.target.value))}
          disabled={Boolean(previewError) || totalFrames <= 0}
          className="flex-1 accent-blue-500 disabled:opacity-40"
        />
        <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400 min-w-[72px] text-right">
          {Math.round(currentFrame)}/{Math.round(totalFrames)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 pb-3 text-xs">
        {summary.map((item) => (
          <div key={item.title} className="flex items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
            <span>{item.title}</span>
            <span className="font-medium text-blue-600 dark:text-blue-400 tabular-nums truncate">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
