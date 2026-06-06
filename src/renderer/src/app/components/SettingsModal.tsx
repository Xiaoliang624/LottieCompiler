import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Code2,
  Eye,
  EyeOff,
  Globe,
  Info,
  Loader2,
  Monitor,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { fetchAI, getSetting, setSetting } from '../../ipc/tauri-api';
import { useCompilerStore } from '../../store/compiler-store';
import { modelsUrlFromEndpoint } from '../../engine/ai-endpoint';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ThemeMode = 'light' | 'dark' | 'system';
type VerifyStatus = 'idle' | 'success' | 'error';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const savedApiBaseUrl = useCompilerStore((state) => state.apiBaseUrl);
  const savedApiKey = useCompilerStore((state) => state.apiKey);
  const savedModelName = useCompilerStore((state) => state.modelName);
  const setApiConfig = useCompilerStore((state) => state.setApiConfig);
  const [activeTab, setActiveTab] = useState<'general' | 'api'>('api');
  const [showApiKey, setShowApiKey] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [apiBaseUrl, setApiBaseUrl] = useState(savedApiBaseUrl);
  const [apiKey, setApiKey] = useState(savedApiKey);
  const [modelName, setModelName] = useState(savedModelName);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    setApiBaseUrl(savedApiBaseUrl);
    setApiKey(savedApiKey);
    setModelName(savedModelName);
  }, [savedApiBaseUrl, savedApiKey, savedModelName]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const [baseUrl, savedKey, savedModel, savedTheme] = await Promise.all([
          getSetting('apiBaseUrl'),
          getSetting('apiKey'),
          getSetting('modelName'),
          getSetting('theme'),
        ]);

        if (baseUrl) {
          setApiBaseUrl(baseUrl);
          setApiConfig({ apiBaseUrl: baseUrl });
        }
        if (savedKey) {
          setApiKey(savedKey);
          setApiConfig({ apiKey: savedKey });
        }
        if (savedModel) {
          setModelName(savedModel);
          setApiConfig({ modelName: savedModel });
        }
        if (isThemeMode(savedTheme)) {
          setTheme(savedTheme);
          applyTheme(savedTheme);
        } else {
          applyTheme('light');
        }
      } catch {
        applyTheme('light');
      }
    }

    if (isOpen) void loadSettings();
  }, [isOpen, setApiConfig]);

  const persistApiBaseUrl = async (value: string) => {
    setApiBaseUrl(value);
    setApiConfig({ apiBaseUrl: value });
    try { await setSetting('apiBaseUrl', value); } catch {}
  };

  const persistApiKey = async (value: string) => {
    setApiKey(value);
    setApiConfig({ apiKey: value });
    try { await setSetting('apiKey', value); } catch {}
  };

  const persistModelName = async (value: string) => {
    setModelName(value);
    setApiConfig({ modelName: value });
    try { await setSetting('modelName', value); } catch {}
  };

  const handleThemeChange = async (value: ThemeMode) => {
    setTheme(value);
    applyTheme(value);
    try { await setSetting('theme', value); } catch {}
  };

  const handleVerify = async () => {
    const endpoint = apiBaseUrl.trim();
    const key = apiKey.trim();

    if (!endpoint) {
      setVerifyStatus('error');
      setVerifyMessage('请填写 Base URL 或接口地址。');
      return;
    }
    if (!key) {
      setVerifyStatus('error');
      setVerifyMessage('请填写 API Key。');
      return;
    }

    setIsVerifying(true);
    setVerifyStatus('idle');
    setVerifyMessage('');

    try {
      const result = await fetchAI(modelsUrlFromEndpoint(endpoint), key, {}, 'GET');
      const data = result.data as { data?: { id?: string }[] };
      const models = (data.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id))
        .filter((id) => !/audio|tts|dall-e|whisper/i.test(id))
        .sort();

      setAvailableModels(models);
      if (models.length > 0 && !models.includes(modelName)) {
        const preferred =
          models.find((model) => model === savedModelName) ??
          models.find((model) => model === 'gpt-4.1-mini') ??
          models.find((model) => model.includes('gpt-4o')) ??
          models[0];
        await persistModelName(preferred);
      }

      await persistApiBaseUrl(endpoint);
      await persistApiKey(key);
      setVerifyStatus('success');
      setVerifyMessage(`检测到 ${models.length} 个模型。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '未知错误');
      setVerifyStatus('error');
      setVerifyMessage(`连接失败：${message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'general' as const, label: '通用', icon: Globe },
    { id: 'api' as const, label: 'API', icon: Code2 },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-neutral-900/20 dark:bg-neutral-950/40 backdrop-blur-sm transition-opacity" onClick={onClose} />

      <div className="relative bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] w-full max-w-[880px] h-full max-h-[640px] flex overflow-hidden border border-white/40 dark:border-neutral-800 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-48 bg-[#F8FAFC]/80 dark:bg-neutral-950/50 border-r border-neutral-100 dark:border-neutral-800 p-4 flex flex-col gap-1 shrink-0">
          <h2 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-3 px-2 mt-1">设置</h2>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 hover:text-neutral-900 dark:hover:text-white font-medium'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 flex flex-col bg-white dark:bg-neutral-900 min-w-0">
          <div className="h-16 flex items-center justify-between px-8 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
            <h3 className="font-semibold text-neutral-900 dark:text-white text-lg">
              {tabs.find((tab) => tab.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 text-neutral-400 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-300 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-8 flex-1 overflow-y-auto min-h-0">
            {activeTab === 'general' && (
              <div className="space-y-8">
                <div className="space-y-4 pb-4">
                  <div>
                    <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">主题</label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">选择应用外观。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-6">
                    {[
                      { id: 'light' as const, icon: Sun, label: '浅色' },
                      { id: 'dark' as const, icon: Moon, label: '深色' },
                      { id: 'system' as const, icon: Monitor, label: '跟随系统' },
                    ].map((item) => {
                      const ThemeIcon = item.icon;
                      const isActive = theme === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleThemeChange(item.id)}
                          className={`flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium transition-all ${
                            isActive
                              ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-sm'
                              : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                          }`}
                        >
                          <ThemeIcon className="w-4 h-4" />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-8 max-w-3xl">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">模型 API</h4>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">支持 OpenAI 兼容的 Chat Completions 或 Responses 接口。</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Base URL 或完整接口地址</label>
                    <input
                      type="text"
                      value={apiBaseUrl}
                      onChange={(event) => setApiBaseUrl(event.target.value)}
                      onBlur={(event) => persistApiBaseUrl(event.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full px-3.5 py-2.5 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm text-neutral-700 dark:text-neutral-300 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 dark:focus:border-blue-500 transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-800 dark:text-neutral-200">API Key</label>
                    <div className="flex flex-wrap sm:flex-nowrap gap-2">
                      <div className="relative flex-1 min-w-[200px]">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          onBlur={(event) => persistApiKey(event.target.value)}
                          placeholder="sk-..."
                          className="w-full pl-3.5 pr-10 py-2.5 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm text-neutral-700 dark:text-neutral-300 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 dark:focus:border-blue-500 transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        onClick={handleVerify}
                        disabled={isVerifying}
                        className="px-5 py-2.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-medium rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-sm whitespace-nowrap shrink-0 disabled:opacity-50"
                      >
                        {isVerifying ? (
                          <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />检测中</span>
                        ) : '验证'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-800 dark:text-neutral-200">模型</label>
                    <div className="relative">
                      <select
                        value={modelName}
                        onChange={(event) => persistModelName(event.target.value)}
                        className="w-full appearance-none px-3.5 py-2.5 pr-10 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm text-neutral-700 dark:text-neutral-300 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 dark:focus:border-blue-500 transition-all"
                      >
                        {(availableModels.length > 0 ? availableModels : [modelName, 'gpt-4.1-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'])
                          .filter((model, index, list) => model && list.indexOf(model) === index)
                          .map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                      </select>
                      {verifyStatus !== 'idle' && (
                        <p className={`text-xs mt-2 flex items-center gap-1 ${verifyStatus === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                          {verifyStatus === 'success' ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                          {verifyMessage}
                        </p>
                      )}
                      <ChevronDown className="w-4 h-4 text-neutral-400 dark:text-neutral-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="mt-8 p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-800/30 flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-neutral-800 dark:text-neutral-200">API 说明</p>
                    <p>1. 可以填写类似 https://api.openai.com/v1 的 Base URL。</p>
                    <p>2. 也支持填写完整的 /chat/completions 或 /responses 接口。</p>
                    <p>3. 验证时会自动使用匹配的 /models 接口。</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}
