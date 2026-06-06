import { useCallback } from 'react';
import { useCompilerStore } from '../store/compiler-store';
import { fetchAI } from '../ipc/tauri-api';
import { normalizeAIEndpoint, type AIEndpointKind } from '../engine/ai-endpoint';
import {
  extractAnimationSpecFromText,
  scenePromptContext,
  summarizeSpec,
} from '../engine/animation-spec';
import { compileLottieJson } from '../engine/engine-bridge';

const SYSTEM_PROMPT = `You are an animation specification assistant.
Return ONLY valid animation-spec.json. Do not wrap it in markdown.

Shape:
{
  "animations": [
    {
      "target": "nodeId",
      "property": "position|scale|rotation|opacity|anchorPoint|skew|fillColor|strokeColor|strokeWidth|trimStart|trimEnd|trimOffset",
      "keyframes": [
        { "frame": 0, "value": [0, 0] },
        { "frame": 60, "value": [120, 0], "easing": "easeInOut" }
      ]
    }
  ]
}`;

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
};

export function useAiChat() {
  const {
    sceneJson,
    specJson,
    chatMessages,
    apiBaseUrl,
    apiKey,
    modelName,
    setSpecJson,
    addChatMessage,
    setIsAiThinking,
    setCompileError,
  } = useCompilerStore();

  const sendMessage = useCallback(async (userMessage: string) => {
    const prompt = userMessage.trim();
    if (!prompt) return;

    addChatMessage({ role: 'user', content: prompt });
    setIsAiThinking(true);
    setCompileError(null);

    try {
      if (!sceneJson) throw new Error('使用 AI 生成前请先加载 scene.json。');
      if (!apiKey.trim()) throw new Error('请先配置 API Key。');

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `Scene targets:\n${scenePromptContext(sceneJson)}` },
        ...(specJson ? [{ role: 'system', content: `Current animation-spec.json:\n${JSON.stringify(specJson, null, 2).slice(0, 14000)}` }] : []),
        ...chatMessages.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) })),
        { role: 'user', content: prompt },
      ];

      const endpoint = normalizeAIEndpoint(apiBaseUrl);
      const model = modelName.trim() || 'gpt-4.1-mini';
      const content = await requestAIWithFallback(endpoint, apiKey.trim(), model, messages, true);
      const spec = await parseAndPreflightSpec(content, sceneJson, endpoint, apiKey.trim(), model, messages, true, 0);
      setSpecJson(spec);
      addChatMessage({ role: 'assistant', content: `已生成 animation-spec.json（${summarizeSpec(spec)}）。` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'AI 请求失败。');
      addChatMessage({ role: 'assistant', content: `错误：${message}` });
      setCompileError(message);
    } finally {
      setIsAiThinking(false);
    }
  }, [
    sceneJson,
    specJson,
    chatMessages,
    apiBaseUrl,
    apiKey,
    modelName,
    setSpecJson,
    addChatMessage,
    setIsAiThinking,
    setCompileError,
  ]);

  return { sendMessage };
}

function requestBody(
  kind: AIEndpointKind,
  model: string,
  messages: Array<{ role: string; content: string }>,
  useJsonFormat: boolean
) {
  if (kind === 'responses') {
    const [system, ...rest] = messages;
    return {
      model,
      instructions: system?.content ?? SYSTEM_PROMPT,
      input: rest
        .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
        .join('\n\n'),
      temperature: 0.2,
      ...(useJsonFormat ? { text: { format: { type: 'json_object' } } } : {}),
    };
  }

  return {
    model,
    messages,
    temperature: 0.2,
    ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
  };
}

async function requestAIWithFallback(
  endpoint: { kind: AIEndpointKind; url: string },
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  useJsonFormat: boolean
): Promise<string> {
  try {
    const result = await fetchAI(endpoint.url, apiKey, requestBody(endpoint.kind, model, messages, useJsonFormat));
    const content = extractAIContent(result.data as ChatResponse);
    if (!content) throw new Error('AI 没有返回内容。');
    return content;
  } catch (error) {
    const message = errorMessage(error);
    if (useJsonFormat && shouldRetryWithoutJsonFormat(message)) {
      const result = await fetchAI(endpoint.url, apiKey, requestBody(endpoint.kind, model, messages, false));
      const content = extractAIContent(result.data as ChatResponse);
      if (!content) throw new Error('AI 没有返回内容。');
      return content;
    }
    throw new Error(message);
  }
}

async function parseAndPreflightSpec(
  content: string,
  sceneJson: object,
  endpoint: { kind: AIEndpointKind; url: string },
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  useJsonFormat: boolean,
  repairAttempt: number
): Promise<object> {
  try {
    const spec = extractAnimationSpecFromText(content, sceneJson);
    compileLottieJson(sceneJson, spec);
    return spec;
  } catch (error) {
    if (repairAttempt > 0) throw error;
    const repairMessages = [
      ...messages,
      {
        role: 'user',
        content: [
          'Previous attempt failed and must be repaired.',
          `Failure reason: ${errorMessage(error)}`,
          `Previous invalid or uncompilable content:\n${content.slice(0, 6000)}`,
          'Return a corrected animation-spec.json only. Use only targets and properties that compile with the supplied scene context.',
        ].join('\n\n'),
      },
    ];
    const repaired = await requestAIWithFallback(endpoint, apiKey, model, repairMessages, useJsonFormat);
    return parseAndPreflightSpec(repaired, sceneJson, endpoint, apiKey, model, messages, useJsonFormat, repairAttempt + 1);
  }
}

function shouldRetryWithoutJsonFormat(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /(^|\s)(400|422)(\D|$)/.test(lower) &&
    (lower.includes('response_format') ||
      lower.includes('json_object') ||
      lower.includes('unsupported') ||
      lower.includes('not support') ||
      lower.includes('不支持'))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function extractAIContent(data: ChatResponse | unknown): string {
  const pieces = collectText(data);
  return pieces.join('\n').trim();
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectText);

  const object = value as Record<string, unknown>;
  const direct = [object.output_text, object.text, object.content]
    .flatMap(collectText)
    .filter(Boolean);
  if (direct.length) return direct;

  const choices = object.choices;
  if (Array.isArray(choices)) {
    const text = choices.flatMap((choice) => {
      const item = choice as Record<string, unknown>;
      return collectText(item.message ?? item.text);
    });
    if (text.length) return text;
  }

  const output = collectText(object.output);
  if (output.length) return output;

  const candidates = object.candidates;
  if (Array.isArray(candidates)) {
    return candidates.flatMap((candidate) => {
      const item = candidate as Record<string, unknown>;
      return collectText((item.content as Record<string, unknown> | undefined)?.parts ?? item.content);
    });
  }

  return [];
}
