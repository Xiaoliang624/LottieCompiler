import { createHashRouter, Outlet, useLocation, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import {
  ArrowUp,
  Check,
  Circle,
  CircleDashed,
  Code2,
  Download,
  FileJson2,
  FileVideo,
  Info,
  Menu,
  PanelLeftClose,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { SettingsModal } from './components/SettingsModal';
import {
  onSceneReceived,
  openFileDialog,
  readFile,
  saveFileDialog,
  writeFile,
} from '../ipc/tauri-api';
import { type CompilerStore, useCompilerStore } from '../store/compiler-store';
import { useCompiler } from '../hooks/useCompiler';
import { useAiChat } from '../hooks/useAiChat';
import { LottiePreview } from '../components/LottiePreview';
import { normalizeAnimationSpec } from '../engine/animation-spec';
import { inferDuration } from '../engine/engine-bridge';
import { isLottieJson } from '../engine/lottie-editor';
import starsIcon from '../assets/stars.svg?raw';

type JsonDropHandler = (json: object, name: string) => void;
type JsonDropErrorHandler = (message: string) => void;

const jsonFilters = [{ name: 'JSON 文件', extensions: ['json'] }];

function statusText(error: string | null, success: boolean, idle = '等待输入') {
  if (error) return `错误：${error}`;
  return success ? '已就绪' : idle;
}

async function readJsonFile(path: string): Promise<object> {
  const content = await readFile(path);
  return JSON.parse(content) as object;
}

function fileName(path: string | null) {
  if (!path) return '';
  return path.split(/[\\/]/).pop() || path;
}

function createJsonDropHandler(callback: JsonDropHandler, onError?: JsonDropErrorHandler) {
  return async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      const file = Array.from(event.dataTransfer.files).find((item) => item.name.toLowerCase().endsWith('.json'));
      if (!file) {
        onError?.('请拖入 JSON 文件。');
        return;
      }

      const text = await file.text();
      callback(JSON.parse(text) as object, file.name);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '读取拖入文件失败。');
    }
  };
}

function handleFileDrag(event: React.DragEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'copy';
}

function downloadLottie(store: CompilerStore) {
  return async () => {
    if (!store.lottieOutput) return;
    const json = JSON.stringify(store.lottieOutput, null, 2);
    try {
      const filePath = await saveFileDialog('lottie.json', jsonFilters);
      if (filePath) await writeFile(filePath, json);
    } catch {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lottie.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  };
}

const CompilerPage = () => {
  const store = useCompilerStore();
  const { compile } = useCompiler();
  const { sendMessage } = useAiChat();
  const [aiInput, setAiInput] = useState('');
  const setMode = store.setMode;

  useEffect(() => {
    setMode('json');
  }, [setMode]);

  const handleSelectSceneJson = async () => {
    const filePath = await openFileDialog(jsonFilters);
    if (!filePath) return;
    try {
      const json = await readJsonFile(filePath);
      if (isLottieJson(json)) store.setLottieSourceJson(json, filePath);
      else store.setSceneJson(json, filePath);
    } catch (error) {
      store.setCompileError(error instanceof Error ? error.message : '加载 JSON 失败。');
    }
  };

  const handleSelectSpecJson = async () => {
    const filePath = await openFileDialog(jsonFilters);
    if (!filePath) return;
    try {
      store.setSpecJson(normalizeAnimationSpec(await readJsonFile(filePath), store.sceneJson), filePath);
    } catch (error) {
      store.setCompileError(error instanceof Error ? error.message : '加载 animation-spec.json 失败。');
    }
  };

  const handleSendAiMessage = () => {
    if (!aiInput.trim()) return;
    sendMessage(aiInput);
    setAiInput('');
  };

  const handleSceneDrop = createJsonDropHandler((json, name) => {
    if (isLottieJson(json)) store.setLottieSourceJson(json, name);
    else store.setSceneJson(json, name);
  }, store.setCompileError);
  const handleSpecDrop = createJsonDropHandler(
    (json, name) => store.setSpecJson(normalizeAnimationSpec(json, store.sceneJson), name),
    store.setCompileError
  );
  const isLottieEditMode = Boolean(store.lottieSourceJson);
  const canGenerate = Boolean((store.lottieSourceJson || (store.sceneJson && store.specJson)) && !store.isCompiling);

  return (
    <div className="page-content h-full flex flex-col bg-transparent p-6 overflow-y-auto animate-in fade-in duration-300">
      <TopActionBar
        title="scene + spec"
        status={statusText(store.compileError, store.compileSuccess)}
        canDownload={Boolean(store.lottieOutput)}
        canGenerate={canGenerate}
        generateLabel={isLottieEditMode ? '预览本体' : '生成动画'}
        onDownload={downloadLottie(store)}
        onGenerate={compile}
      />

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] gap-6 flex-1 min-h-0">
        <div className="flex flex-col gap-6 min-h-0">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-sm border border-neutral-100 dark:border-neutral-800 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-medium">
                <span>输入</span>
              </div>
              <button
                onClick={store.clearCurrentMode}
                className="inline-flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空
              </button>
            </div>

            <div className="flex items-start gap-3 mb-6 shrink-0 overflow-hidden">
              <FilePickerCard
                title="scene.json / lottie.json"
                subtitle="选择或拖入 scene 或 Lottie 文件"
                active={Boolean(store.sceneJson || store.lottieSourceJson)}
                tone="blue"
                onSelect={handleSelectSceneJson}
                onDrop={handleSceneDrop}
              />

              {!isLottieEditMode && (
                <FilePickerCard
                  title="animation-spec.json"
                  subtitle="选择、拖入或生成 spec"
                  active={Boolean(store.specJson)}
                  tone="green"
                  onSelect={handleSelectSpecJson}
                  onDrop={handleSpecDrop}
                  extra={
                    <>
                      <button
                        onClick={store.undoSingleSpec}
                        disabled={store.specHistory.length === 0}
                        className="p-1 rounded-md text-neutral-400 hover:text-blue-500 disabled:opacity-30 disabled:hover:text-neutral-400"
                        title="恢复上一版生成的 spec"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    </>
                  }
                />
              )}
            </div>

            <div className="flex items-center justify-between mb-3 px-1 shrink-0">
              <h4 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                AI助手
              </h4>
              {store.isAiThinking && <span className="text-xs text-blue-500">思考中...</span>}
            </div>

            <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl flex-1 flex flex-col overflow-hidden bg-neutral-50/50 dark:bg-neutral-800/20 min-h-[180px]">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {store.chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <span
                      aria-hidden="true"
                      className="mb-3 block h-6 w-6 bg-blue-500"
                      style={{
                        mask: `url("data:image/svg+xml,${encodeURIComponent(starsIcon)}") center / contain no-repeat`,
                        WebkitMask: `url("data:image/svg+xml,${encodeURIComponent(starsIcon)}") center / contain no-repeat`,
                      }}
                    />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {isLottieEditMode ? '描述要在当前 Lottie 本体上修改的动画。' : '描述你想生成的动效。'}
                    </p>
                  </div>
                ) : (
                  store.chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`w-fit min-w-0 max-w-[85%] break-words text-sm rounded-lg px-3 py-2 ${
                        message.role === 'user'
                          ? 'ml-auto bg-blue-500 text-white'
                          : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200 border border-neutral-100 dark:border-neutral-700'
                      }`}
                    >
                      {message.content}
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 border-t border-neutral-100 dark:border-neutral-700 bg-white dark:bg-neutral-800 m-2 rounded-lg flex items-center gap-2 shadow-sm border border-neutral-200/60 dark:border-neutral-700">
                <input
                  type="text"
                  className="flex-1 bg-transparent text-sm outline-none px-2 dark:text-white dark:placeholder-neutral-500"
                  placeholder="描述你想要的动画..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendAiMessage()}
                />
                <button
                  onClick={handleSendAiMessage}
                  disabled={store.isAiThinking || !aiInput.trim()}
                  className="w-7 h-7 rounded-full bg-blue-500 disabled:bg-neutral-300 dark:disabled:bg-neutral-600 flex items-center justify-center text-white"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <PreviewCard />
      </div>
    </div>
  );
};

const StyleCodePage = () => {
  const store = useCompilerStore();
  const { compile } = useCompiler();
  const setMode = store.setMode;

  useEffect(() => {
    setMode('css');
  }, [setMode]);

  const canGenerate = Boolean(store.cssCode.trim() && !store.isCompiling);
  const handleCssCodeChange = (code: string) => {
    store.setCssCode(code);
    store.setCssDuration(code.trim() ? inferDuration(code) : 0);
  };

  return (
    <div className="page-content h-full flex flex-col bg-transparent p-6 overflow-y-auto animate-in fade-in duration-300">
      <h1 className="text-2xl font-bold mb-6 text-neutral-900 dark:text-white">Lottie Compiler</h1>

      <TopActionBar
        title="CSS / 组件"
        status={statusText(store.compileError, store.compileSuccess)}
        canDownload={Boolean(store.lottieOutput)}
        canGenerate={canGenerate}
        generateLabel="生成"
        onDownload={downloadLottie(store)}
        onGenerate={compile}
      />

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] gap-6 flex-1 min-h-0">
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-sm border border-neutral-100 dark:border-neutral-800 flex flex-col min-h-0 gap-4">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-medium">
              <span>输入</span>
            </div>
            <button
              onClick={store.clearCurrentMode}
              className="inline-flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空
            </button>
          </div>

          <div className="flex-1 min-h-[220px]">
            <textarea
              className="w-full h-full resize-none border border-neutral-200/60 dark:border-neutral-700 rounded-xl p-4 text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-neutral-50/30 dark:bg-neutral-800/30"
              value={store.cssCode}
              onChange={(e) => handleCssCodeChange(e.target.value)}
              placeholder="粘贴 CSS / React 动画代码..."
            />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 shrink-0">
            <ReadOnlyField label="时长" value={store.cssDuration > 0 ? `${store.cssDuration} ms` : '未识别'} />
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">帧率</label>
              <select
                value={store.cssFrameRate}
                onChange={(e) => store.setCssFrameRate(parseInt(e.target.value, 10) as 30 | 60)}
                className="w-full px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 rounded-lg text-sm text-neutral-900 dark:text-neutral-200 focus:outline-none focus:border-blue-500 transition-all shadow-sm"
              >
                <option value={60}>60</option>
                <option value={30}>30</option>
              </select>
            </div>
            <NumberInput label="宽度" value={store.canvasWidth} onChange={(value) => store.setCanvasSize(value, store.canvasHeight)} />
            <NumberInput label="高度" value={store.canvasHeight} onChange={(value) => store.setCanvasSize(store.canvasWidth, value)} />
          </div>

          <div className="mt-1 shrink-0">
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">解析模式</label>
            <div className="flex flex-wrap items-center bg-neutral-200/60 dark:bg-neutral-800/60 p-1 rounded-lg w-fit">
              {[
                ['auto', '自动'],
                ['static', '静态'],
                ['browser', '浏览器'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => store.setParseMode(mode as 'auto' | 'static' | 'browser')}
                  className={`px-4 py-1.5 text-xs font-medium rounded-md ${
                    store.parseMode === mode
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <PreviewCard />
      </div>
    </div>
  );
};

const TopActionBar = ({
  title,
  status,
  canDownload,
  canGenerate,
  generateLabel,
  onDownload,
  onGenerate,
}: {
  title: string;
  status: string;
  canDownload: boolean;
  canGenerate: boolean;
  generateLabel: string;
  onDownload: () => void;
  onGenerate: () => void;
}) => (
  <div className="px-1 flex flex-wrap items-center justify-between gap-4 mb-6 ml-10 md:ml-0 transition-all shrink-0">
    <div className="flex items-start gap-3">
      <div className="mt-0.5 w-5 h-5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center shrink-0">
        <Info className="w-3 h-3" />
      </div>
      <div>
        <h3 className="font-semibold text-sm text-neutral-900 dark:text-white">{title}</h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">{status}</p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <button
        onClick={onDownload}
        disabled={!canDownload}
        className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg ${canDownload ? 'text-neutral-700 dark:text-neutral-200 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-700' : 'text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800/50 cursor-not-allowed'}`}
      >
        <Download className="w-4 h-4" />
        <span>下载</span>
      </button>
      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-300 dark:disabled:bg-neutral-700 rounded-lg shadow-sm transition-colors shadow-blue-500/20 disabled:shadow-none"
      >
        <Sparkles className="w-4 h-4" />
        <span>{generateLabel}</span>
      </button>
    </div>
  </div>
);

const FilePickerCard = ({
  title,
  subtitle,
  active,
  tone,
  onSelect,
  onDrop,
  extra,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  tone?: 'blue' | 'green';
  onSelect: () => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  extra?: React.ReactNode;
}) => {
  const gradient = tone === 'green'
    ? 'from-emerald-400 to-emerald-200'
    : 'from-indigo-500 to-indigo-200';
  const titleHoverColor = tone === 'green' ? 'group-hover:text-emerald-600' : 'group-hover:text-indigo-600';
  const ringColor = tone === 'green' ? 'focus-visible:ring-emerald-500/40' : 'focus-visible:ring-indigo-500/40';

  return (
    <div
      role="button"
      tabIndex={0}
      onDragEnter={handleFileDrag}
      onDragOver={handleFileDrag}
      onDrop={onDrop}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group min-w-0 flex-1 cursor-pointer flex items-start justify-between gap-2 rounded-lg px-1 py-1 focus:outline-none focus-visible:ring-2 ${ringColor}`}
    >
      <div className="min-w-0 flex-1 flex items-start gap-2 text-left">
        <span className={`relative flex h-8 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${gradient} text-white shadow-sm`}>
          <span className="absolute right-0 top-0 h-2 w-2 rounded-bl bg-white/50" />
          <FileJson2 className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start gap-1.5">
            <span className={`min-w-0 whitespace-nowrap text-[12px] font-semibold leading-tight text-neutral-900 transition-colors dark:text-white ${titleHoverColor}`}>{title}</span>
            {active && (
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="h-2 w-2" />
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[10px] font-normal leading-tight text-neutral-500 dark:text-neutral-400">{subtitle}</span>
        </span>
      </div>
      <div
        className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {extra}
      </div>
    </div>
  );
};

const NumberInput = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
}) => (
  <div>
    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      placeholder={placeholder}
      className="w-full px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 rounded-lg text-sm text-neutral-900 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-all shadow-sm"
    />
  </div>
);

const ReadOnlyField = ({ label, value }: { label: string; value: string }) => (
  <div>
    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{label}</label>
    <div className="w-full px-3 py-1.5 bg-neutral-50 dark:bg-neutral-800/70 border border-neutral-200/80 dark:border-neutral-700 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 shadow-sm">
      {value}
    </div>
  </div>
);

const PreviewCard = () => {
  const store = useCompilerStore();
  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-sm border border-neutral-100 dark:border-neutral-800 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-medium">
          <span>预览</span>
        </div>
        <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2.5 py-1 rounded-full text-xs font-medium">
          {store.isCompiling ? (
            <><CircleDashed className="w-3 h-3 animate-[spin_3s_linear_infinite]" /><span>编译中</span></>
          ) : store.compileSuccess ? (
            <><Circle className="w-3 h-3" /><span>已就绪</span></>
          ) : (
            <><CircleDashed className="w-3 h-3 animate-[spin_3s_linear_infinite]" /><span>等待中</span></>
          )}
        </div>
      </div>
      <LottiePreview />
    </div>
  );
};

const SidebarItem = ({ icon: Icon, label, path }: { icon: React.ElementType; label: string; path: string }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === path;

  return (
    <button
      onClick={() => navigate(path)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg mb-1 transition-all ${
        isActive
          ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/20'
          : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-neutral-800/50 hover:shadow-sm hover:text-neutral-900 dark:hover:text-white'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </button>
  );
};

const RootLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAutoSidebarCollapsed, setIsAutoSidebarCollapsed] = useState(false);
  const [hasManualSidebarChoice, setHasManualSidebarChoice] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const setMode = useCompilerStore((state) => state.setMode);
  const setSceneJson = useCompilerStore((state) => state.setSceneJson);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    onSceneReceived((scene) => {
      if (scene && typeof scene === 'object') {
        setMode('json');
        setSceneJson(scene as object, 'Figma 导入');
        navigate('/');
      }
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [navigate, setMode, setSceneJson]);

  useEffect(() => {
    const collapseWidth = 980;
    const expandWidth = 1120;

    const syncSidebarToWindow = () => {
      const width = window.innerWidth;
      if (hasManualSidebarChoice) {
        if (width > expandWidth) setHasManualSidebarChoice(false);
        return;
      }
      if (width < collapseWidth && isSidebarOpen) {
        setIsSidebarOpen(false);
        setIsAutoSidebarCollapsed(true);
        return;
      }
      if (width > expandWidth && isAutoSidebarCollapsed && !isSidebarOpen) {
        setIsSidebarOpen(true);
        setIsAutoSidebarCollapsed(false);
      }
    };

    syncSidebarToWindow();
    window.addEventListener('resize', syncSidebarToWindow);
    return () => window.removeEventListener('resize', syncSidebarToWindow);
  }, [hasManualSidebarChoice, isAutoSidebarCollapsed, isSidebarOpen]);

  const closeSidebarManually = () => {
    setIsSidebarOpen(false);
    setIsAutoSidebarCollapsed(false);
    setHasManualSidebarChoice(true);
  };

  const openSidebarManually = () => {
    setIsSidebarOpen(true);
    setIsAutoSidebarCollapsed(false);
    setHasManualSidebarChoice(true);
  };

  return (
    <div className="app-window h-screen flex flex-col bg-[#E5E7EB] dark:bg-neutral-950 font-sans overflow-hidden">
      <div className="flex flex-1 min-h-0 bg-[#E5E7EB] dark:bg-neutral-950 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-white dark:from-neutral-900 to-[#E5E7EB] dark:to-neutral-950 overflow-hidden relative">
      <div className="window-drag-strip" data-tauri-drag-region="" />
      <aside
        className={`${isSidebarOpen ? 'w-56 translate-x-0' : 'w-0 -translate-x-full'} transition-all duration-300 ease-in-out bg-white/42 dark:bg-neutral-950/42 backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150 flex flex-col pt-0 pb-6 shrink-0 border-r border-white/55 dark:border-white/10 absolute z-30 h-full md:relative overflow-hidden md:flex shadow-[1px_0_28px_rgba(15,23,42,0.08),inset_-1px_0_0_rgba(255,255,255,0.36)] dark:shadow-[1px_0_28px_rgba(0,0,0,0.28),inset_-1px_0_0_rgba(255,255,255,0.08)]`}
        style={{ minWidth: isSidebarOpen ? '14rem' : '0' }}
      >
        <div className="px-4 mb-4 flex justify-end items-center w-56 h-12 shrink-0">
          <button onClick={closeSidebarManually} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 p-1 rounded-md">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto w-56 flex flex-col min-h-0">
          <nav className="px-3 mb-8">
            <SidebarItem icon={FileVideo} label="动画规范" path="/" />
            <SidebarItem icon={Code2} label="样式代码" path="/style" />
          </nav>
        </div>

        <div className="px-3 pt-4 w-56 shrink-0">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-neutral-800/50 hover:shadow-sm rounded-lg transition-all"
          >
            <Settings className="w-4 h-4" />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <main className={`flex-1 flex flex-col bg-white dark:bg-neutral-900 overflow-hidden relative shadow-sm min-w-0 ${isSidebarOpen ? '' : 'sidebar-collapsed'}`}>
        {!isSidebarOpen && (
          <div className="absolute top-4 left-4 z-30">
            <button
              onClick={openSidebarManually}
              className="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-sm border border-neutral-100 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        )}
        <Outlet />
      </main>

      {isSidebarOpen && <div className="fixed inset-0 bg-black/20 dark:bg-black/40 z-10 md:hidden" onClick={closeSidebarManually} />}

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      </div>
    </div>
  );
};

export const router = createHashRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: CompilerPage },
      { path: 'style', Component: StyleCodePage },
    ],
  },
]);
