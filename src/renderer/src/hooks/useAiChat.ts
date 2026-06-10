import { useCallback } from 'react';
import { useCompilerStore } from '../store/compiler-store';
import { fetchAI } from '../ipc/tauri-api';
import { normalizeAIEndpoint, type AIEndpointKind } from '../engine/ai-endpoint';
import {
  createFallbackAnimationSpec,
  extractAnimationSpecFromText,
  hasPlayableAnimation,
  scenePromptContext,
  summarizeSpec,
} from '../engine/animation-spec';
import { compileLottieJson } from '../engine/engine-bridge';
import {
  applyLottieEditPatch,
  extractLottieEditPatchFromText,
  lottieEditFallback,
  summarizeLottieEditContext,
} from '../engine/lottie-editor';

const SYSTEM_PROMPT = `OUTPUT CONTRACT
You are a JSON generator, not a chat assistant.
Your entire response must be one valid animation-spec.json object.
The first character of your response must be { and the last character must be }.
Do not wrap the JSON in Markdown or code fences.
Do not write explanations, apologies, greetings, notes, analysis, comments, HTML, XML, YAML, CSS, JavaScript, or raw Lottie JSON.
If you cannot satisfy the user request exactly, still return a valid animation-spec.json that approximates the request by animating existing scene nodes.

REQUIRED JSON SHAPE
{
  "meta": { "durationFrames": 60, "name": "optional short name" },
  "animations": [
    {
      "target": "node id or exact node name from scene.json",
      "property": "opacity",
      "keyframes": [
        { "frame": 0, "value": 0, "easing": "ease-out" },
        { "frame": 18, "value": 100, "easing": "ease-out" }
      ]
    }
  ]
}

VALIDATION RULES
1. The root object must contain "meta" and "animations".
2. Use only node ids or exact node names present in the supplied scene context.
3. Prefer nodes where targetable is true. Do not target the root frame/canvas when targetable is false.
4. Supported properties are: "position", "positionX", "positionY", "scale", "scaleX", "scaleY", "rotation", "opacity", "anchorPoint", "anchorX", "anchorY", "skew", "skewAxis", "fillColor", "fillOpacity", "strokeColor", "strokeOpacity", "strokeWidth", "trimStart", "trimEnd", "trimOffset", "path".
5. Use numeric frame fields. frame must be between 0 and meta.durationFrames.
6. opacity values are 0-100. scale values are percentages, usually 80-130. rotation is degrees.
7. Use at least two keyframes with different values for every animation.
8. Values may be numbers, [x,y] points, [r,g,b] or [r,g,b,a] colors using 0-1 color channels.
9. For "path", target a vector/path shape and use value objects like { "v": [[x,y]], "i": [[0,0]], "o": [[0,0]], "c": true }; every path keyframe for the same animation must keep the same vertex count and closed flag. Coordinates are local to the shape center unless "coordinateSpace": "topLeft" or "absolute" is included.
10. For a simple scene, animate the visible child layer rather than the canvas/frame container.`;

const LOTTIE_EDIT_SYSTEM_PROMPT = `OUTPUT CONTRACT
You are a JSON patch generator for existing Lottie JSON, not a chat assistant.
Your entire response must be one valid JSON object.
The first character of your response must be { and the last character must be }.
Do not return a full Lottie file. Do not return animation-spec.json. Do not write explanations or Markdown.

REQUIRED JSON SHAPE
{
  "meta": { "name": "optional edited animation name" },
  "summary": "Short Chinese summary of the intended animation.",
  "operations": [
    {
      "type": "animateShapePath",
      "target": { "ind": 5, "name": "尾巴" },
      "shapeIndex": 0,
      "fixedVertices": [0],
      "keyframes": [
        { "frame": 0, "offsets": [[0,0],[0,0],[0,0],[0,0]] },
        { "frame": 70, "offsets": [[0,0],[2,1],[5,-1],[2,0]] },
        { "frame": 119, "offsets": [[0,0],[0,0],[0,0],[0,0]] }
      ]
    }
  ]
}

SUPPORTED OPERATIONS
1. animateTransform: target, property, keyframes. property is one of position, scale, rotation, opacity, anchorPoint.
2. animateShapePath: target, shapeIndex, fixedVertices, keyframes with offsets or vertices.

RULES
1. Use layer ind from the supplied Lottie context when possible.
2. For shape path animation, use offsets when possible. Keep fixedVertices at [0] or other supplied root/mouth vertices when the user asks to keep a connection fixed.
3. Keep motions gentle unless the user asks for large motion.
4. Use frames within the Lottie outPoint. Prefer loop-friendly first and last frames.
5. Return only operations and summary. The app will apply the patch locally and generate the final Lottie JSON.`;

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
};

export function useAiChat() {
  const {
    sceneJson,
    lottieSourceJson,
    specJson,
    chatMessages,
    apiBaseUrl,
    apiKey,
    modelName,
    setSpecJson,
    setLottieSourceJson,
    setLottieOutput,
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
      if (!sceneJson && !lottieSourceJson) throw new Error('使用 AI 生成前请先加载 scene.json 或 Lottie JSON。');
      if (!apiKey.trim()) throw new Error('请先配置 API Key。');

      const endpoint = normalizeAIEndpoint(apiBaseUrl);
      const model = modelName.trim() || 'gpt-4.1-mini';
      if (lottieSourceJson) {
        const messages = [
          ...chatMessages.slice(-8).map((message) => ({ role: message.role, content: message.content.slice(0, 1200) })),
          {
            role: 'user',
            content: lottieEditUserPrompt(prompt, lottieSourceJson, chatMessages.slice(-8)),
          },
        ];
        const content = await requestAIWithFallback(endpoint, apiKey.trim(), model, messages, true, LOTTIE_EDIT_SYSTEM_PROMPT);
        const { lottie, summary, usedFallback } = parseAndApplyLottiePatch(content, lottieSourceJson, prompt);
        setLottieSourceJson(lottie, 'AI 编辑后的 lottie.json');
        setLottieOutput(lottie);
        addChatMessage({
          role: 'assistant',
          content: `${usedFallback ? 'AI 修改操作不可用，已使用本地兜底编辑。' : '已直接编辑 Lottie 本体并生成动画文件。'}\n${summary}`,
        });
      } else if (sceneJson) {
        const messages = [
          ...chatMessages.slice(-8).map((message) => ({ role: message.role, content: message.content.slice(0, 1200) })),
          {
            role: 'user',
            content: aiUserPrompt(prompt, sceneJson, specJson, chatMessages.slice(-8)),
          },
        ];
        const content = await requestAIWithFallback(endpoint, apiKey.trim(), model, messages, true);
        const { spec, usedFallback } = await parseAndPreflightSpec(content, sceneJson, endpoint, apiKey.trim(), model, messages, true, 0);
        setSpecJson(spec);
        addChatMessage({
          role: 'assistant',
          content: `${usedFallback ? 'AI 返回的动画不可播放，已使用兜底动画。' : '已生成 animation-spec.json'}（${summarizeSpec(spec)}）`,
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      addChatMessage({ role: 'assistant', content: `错误：${message}` });
      setCompileError(message);
    } finally {
      setIsAiThinking(false);
    }
  }, [
    sceneJson,
    lottieSourceJson,
    specJson,
    chatMessages,
    apiBaseUrl,
    apiKey,
    modelName,
    setSpecJson,
    setLottieSourceJson,
    setLottieOutput,
    addChatMessage,
    setIsAiThinking,
    setCompileError,
  ]);

  return { sendMessage };
}

function aiUserPrompt(
  userPrompt: string,
  sceneJson: object,
  currentSpec: object | null,
  contextMessages: Array<{ role: string; content: string }>
): string {
  return [
    'Generate animation-spec.json only.',
    '',
    'Recent conversation context in this app session:',
    contextMessages.map((message) => `${message.role}: ${message.content}`).join('\n') || '(none)',
    '',
    'Current animation-spec.json before this request:',
    currentSpec ? JSON.stringify(currentSpec, null, 2).slice(0, 14000) : '(none)',
    '',
    'User animation request:',
    userPrompt,
    '',
    'Scene context:',
    scenePromptContext(sceneJson, userPrompt),
  ].join('\n');
}

function lottieEditUserPrompt(
  userPrompt: string,
  lottieJson: object,
  contextMessages: Array<{ role: string; content: string }>
): string {
  return [
    'Generate Lottie edit operations only.',
    '',
    'Recent conversation context in this app session:',
    contextMessages.map((message) => `${message.role}: ${message.content}`).join('\n') || '(none)',
    '',
    'User animation request:',
    userPrompt,
    '',
    'Lottie context:',
    summarizeLottieEditContext(lottieJson, userPrompt),
  ].join('\n');
}

function parseAndApplyLottiePatch(
  content: string,
  lottieJson: object,
  userPrompt: string
): { lottie: object; summary: string; usedFallback: boolean } {
  try {
    const patch = extractLottieEditPatchFromText(content);
    const result = applyLottieEditPatch(lottieJson, patch);
    return { ...result, usedFallback: false };
  } catch {
    const result = lottieEditFallback(lottieJson, userPrompt);
    return { ...result, usedFallback: true };
  }
}

function requestBody(
  kind: AIEndpointKind,
  model: string,
  messages: Array<{ role: string; content: string }>,
  useJsonFormat: boolean,
  systemPrompt = SYSTEM_PROMPT
) {
  if (kind === 'responses') {
    return {
      model,
      instructions: systemPrompt,
      input: messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n'),
      temperature: 0.2,
      ...(useJsonFormat ? { text: { format: { type: 'json_object' } } } : {}),
    };
  }

  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature: 0.2,
    ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
  };
}

async function requestAIWithFallback(
  endpoint: { kind: AIEndpointKind; url: string },
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  useJsonFormat: boolean,
  systemPrompt = SYSTEM_PROMPT
): Promise<string> {
  try {
    const result = await fetchAI(endpoint.url, apiKey, requestBody(endpoint.kind, model, messages, useJsonFormat, systemPrompt));
    const content = extractAIContent(result.data as ChatResponse);
    if (!content) throw new Error('AI 没有返回内容。');
    return content;
  } catch (error) {
    const message = errorMessage(error);
    if (useJsonFormat && shouldRetryWithoutJsonFormat(message)) {
      const result = await fetchAI(endpoint.url, apiKey, requestBody(endpoint.kind, model, messages, false, systemPrompt));
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
): Promise<{ spec: object; usedFallback: boolean }> {
  try {
    const spec = extractAnimationSpecFromText(content, sceneJson);
    const lottie = compileLottieJson(sceneJson, spec);
    if (!hasPlayableAnimation(lottie)) {
      throw new Error('生成结果没有可播放的关键帧，可能是 AI 选择了根画布或静态容器。');
    }
    return { spec, usedFallback: false };
  } catch (error) {
    if (repairAttempt === 0) {
      const repairMessages = [
        ...messages,
        {
          role: 'user',
          content: [
            'Previous attempt failed and must be repaired.',
            `Failure reason: ${errorMessage(error)}`,
            `Previous invalid, static, or uncompilable content:\n${content.slice(0, 6000)}`,
            'Return a corrected animation-spec.json only. Use only targetable scene nodes and ensure the compiled Lottie contains animated keyframes.',
          ].join('\n\n'),
        },
      ];
      const repaired = await requestAIWithFallback(endpoint, apiKey, model, repairMessages, useJsonFormat);
      return parseAndPreflightSpec(repaired, sceneJson, endpoint, apiKey, model, messages, useJsonFormat, repairAttempt + 1);
    }

    const fallbackSpec = createFallbackAnimationSpec(sceneJson);
    const fallbackLottie = compileLottieJson(sceneJson, fallbackSpec);
    if (!hasPlayableAnimation(fallbackLottie)) throw error;
    return { spec: fallbackSpec, usedFallback: true };
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
