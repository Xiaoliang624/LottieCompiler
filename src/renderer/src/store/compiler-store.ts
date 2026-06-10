// src/store/compiler-store.ts
// Central state management — replaces SwiftUI CompilerViewModel
import { create } from 'zustand';

export type CompilerMode = 'json' | 'css';
export type ParseMode = 'auto' | 'static' | 'browser';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface CompilerState {
  mode: CompilerMode;
  sceneJson: object | null;
  sceneFilePath: string | null;
  lottieSourceJson: object | null;
  lottieSourceFilePath: string | null;
  specJson: object | null;
  specFilePath: string | null;
  specHistory: object[];
  lottieOutput: object | null;
  cssCode: string;
  parseMode: ParseMode;
  cssDuration: number;
  cssFrameRate: 30 | 60;
  canvasWidth: number;
  canvasHeight: number;
  chatMessages: ChatMessage[];
  isAiThinking: boolean;
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  isCompiling: boolean;
  compileError: string | null;
  compileSuccess: boolean;
}

export interface CompilerActions {
  setMode: (mode: CompilerMode) => void;
  setSceneJson: (json: object, filePath?: string) => void;
  setLottieSourceJson: (json: object, filePath?: string) => void;
  setSpecJson: (json: object, filePath?: string) => void;
  pushSpecHistory: (json: object) => void;
  undoSingleSpec: () => void;
  clearScene: () => void;
  clearCurrentMode: () => void;
  setCssCode: (code: string) => void;
  setParseMode: (mode: ParseMode) => void;
  setCssDuration: (duration: number) => void;
  setCssFrameRate: (fps: 30 | 60) => void;
  setCanvasSize: (width: number, height: number) => void;
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearChat: () => void;
  setIsAiThinking: (thinking: boolean) => void;
  setApiConfig: (config: Partial<Pick<CompilerState, 'apiBaseUrl' | 'apiKey' | 'modelName'>>) => void;
  setCompiling: (compiling: boolean) => void;
  setLottieOutput: (output: object | null) => void;
  setCompileError: (error: string | null) => void;
  resetCurrentMode: () => void;
}

export type CompilerStore = CompilerState & CompilerActions;

let messageCounter = 0;

export const useCompilerStore = create<CompilerStore>((set, get) => ({
  mode: 'json',
  sceneJson: null,
  sceneFilePath: null,
  lottieSourceJson: null,
  lottieSourceFilePath: null,
  specJson: null,
  specFilePath: null,
  specHistory: [],
  lottieOutput: null,
  cssCode: '',
  parseMode: 'auto',
  cssDuration: 0,
  cssFrameRate: 60,
  canvasWidth: 390,
  canvasHeight: 390,
  chatMessages: [],
  isAiThinking: false,
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelName: 'gpt-4.1-mini',
  isCompiling: false,
  compileError: null,
  compileSuccess: false,

  setMode: (mode) => {
    if (get().mode === mode) return;
    set({ mode });
    get().resetCurrentMode();
  },
  setSceneJson: (json, filePath) => set({
    sceneJson: json,
    sceneFilePath: filePath ?? null,
    lottieSourceJson: null,
    lottieSourceFilePath: null,
    lottieOutput: null,
    compileError: null,
    compileSuccess: false,
  }),
  setLottieSourceJson: (json, filePath) => set({
    lottieSourceJson: json,
    lottieSourceFilePath: filePath ?? null,
    sceneJson: null,
    sceneFilePath: null,
    specJson: null,
    specFilePath: null,
    specHistory: [],
    lottieOutput: json,
    compileError: null,
    compileSuccess: true,
  }),
  setSpecJson: (json, filePath) => {
    const current = get().specJson;
    if (current) set((s) => ({ specHistory: [...s.specHistory, current] }));
    set({
      specJson: json,
      specFilePath: filePath ?? null,
      lottieOutput: null,
      compileError: null,
      compileSuccess: false,
    });
  },
  pushSpecHistory: (json) => set((s) => ({ specHistory: [...s.specHistory, json] })),
  undoSingleSpec: () => {
    const history = get().specHistory;
    if (history.length === 0) return;
    set({
      specJson: history[history.length - 1],
      specFilePath: 'restored animation-spec.json',
      specHistory: history.slice(0, -1),
      lottieOutput: null,
      compileError: null,
      compileSuccess: false,
    });
  },
  clearScene: () => set({
    sceneJson: null,
    sceneFilePath: null,
    lottieSourceJson: null,
    lottieSourceFilePath: null,
    specJson: null,
    specFilePath: null,
    specHistory: [],
    chatMessages: [],
    lottieOutput: null,
    compileError: null,
    compileSuccess: false,
  }),
  clearCurrentMode: () => {
    const mode = get().mode;
    if (mode === 'json') {
      get().clearScene();
      return;
    }
    set({
      cssCode: '',
      cssDuration: 0,
      cssFrameRate: 60,
      canvasWidth: 390,
      canvasHeight: 390,
      parseMode: 'auto',
      lottieOutput: null,
      compileError: null,
      compileSuccess: false,
    });
  },
  setCssCode: (code) => set({ cssCode: code }),
  setParseMode: (mode) => set({ parseMode: mode }),
  setCssDuration: (duration) => set({ cssDuration: duration }),
  setCssFrameRate: (fps) => set({ cssFrameRate: fps }),
  setCanvasSize: (width, height) => set({ canvasWidth: width, canvasHeight: height }),
  addChatMessage: (message) => set((s) => ({
    chatMessages: [...s.chatMessages, { ...message, id: `msg-${++messageCounter}`, timestamp: Date.now() }],
  })),
  clearChat: () => set({ chatMessages: [] }),
  setIsAiThinking: (thinking) => set({ isAiThinking: thinking }),
  setApiConfig: (config) => set(config),
  setCompiling: (compiling) => set({ isCompiling: compiling, compileError: null }),
  setLottieOutput: (output) => set({ lottieOutput: output, compileSuccess: true, isCompiling: false, compileError: null }),
  setCompileError: (error) => set({ compileError: error, compileSuccess: false, isCompiling: false }),
  resetCurrentMode: () => set({ lottieOutput: null, compileError: null, compileSuccess: false, isCompiling: false }),
}));
