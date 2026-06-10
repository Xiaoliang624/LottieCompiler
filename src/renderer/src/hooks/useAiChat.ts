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

type JsonObject = Record<string, unknown>;

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
          content: `${usedFallback ? 'AI 修改操作不可用，已使用本地兜底编辑。' : '已直接编辑 Lottie 本体并生成动画文件。'}\n${summarizeLottieEditEffects(summary)}`,
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
          content: `${usedFallback ? 'AI 返回的动画不可播放，已使用兜底动画。' : '已生成 animation-spec.json'}（${summarizeSpec(spec)}）\n${summarizeSpecEffects(spec)}`,
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

function summarizeLottieEditEffects(summary: string): string {
  const lines = summary.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '添加的动画效果：\n- 已应用 Lottie 修改操作。';
  return `添加的动画效果：\n${lines.map((line) => `- ${line.replace(/^[-•]\s*/, '')}`).join('\n')}`;
}

function summarizeSpecEffects(spec: unknown): string {
  const root = asObject(spec);
  const animations = Array.isArray(root.animations) ? root.animations : [];
  const lines = animations
    .map(summarizeSpecAnimation)
    .filter(Boolean)
    .slice(0, 10);

  if (!lines.length) return '添加的动画效果：\n- 已生成关键帧动画。';

  const overflow = animations.length > lines.length ? `\n- 另外还有 ${animations.length - lines.length} 个动画效果。` : '';
  return `添加的动画效果：\n${lines.map((line) => `- ${line}`).join('\n')}${overflow}`;
}

function summarizeSpecAnimation(item: unknown): string {
  const animation = asObject(item);
  const target = valueAsString(animation.target) || '未命名目标';
  const property = valueAsString(animation.property) || '属性';
  const keyframes = Array.isArray(animation.keyframes) ? animation.keyframes.map(asObject) : [];
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  const startFrame = first ? numberValue(first.frame) : null;
  const endFrame = last ? numberValue(last.frame) : null;
  const frameText = startFrame !== null && endFrame !== null ? `，${formatNumber(startFrame)}-${formatNumber(endFrame)} 帧` : '';
  const valueText = first && last ? `，从 ${formatSpecValue(first.value)} 到 ${formatSpecValue(last.value)}` : '';
  const keyframeText = keyframes.length ? `，${keyframes.length} 个关键帧` : '';
  return `${target}：添加${propertyLabel(property)}${frameText}${valueText}${keyframeText}`;
}

function propertyLabel(property: string): string {
  const labels: Record<string, string> = {
    position: '位移动画',
    positionX: '横向位移动画',
    positionY: '纵向位移动画',
    scale: '缩放动画',
    scaleX: '横向缩放动画',
    scaleY: '纵向缩放动画',
    rotation: '旋转动画',
    opacity: '透明度动画',
    anchorPoint: '锚点动画',
    anchorX: '横向锚点动画',
    anchorY: '纵向锚点动画',
    skew: '倾斜动画',
    skewAxis: '倾斜轴动画',
    fillColor: '填充颜色动画',
    fillOpacity: '填充透明度动画',
    strokeColor: '描边颜色动画',
    strokeOpacity: '描边透明度动画',
    strokeWidth: '描边宽度动画',
    trimStart: '路径起点裁剪动画',
    trimEnd: '路径终点裁剪动画',
    trimOffset: '路径裁剪偏移动画',
    path: '路径锚点动画',
  };
  return labels[property] ?? `${property} 动画`;
}

function formatSpecValue(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.slice(0, 4).map(formatSpecValue).join(', ')}${value.length > 4 ? ', ...' : ''}]`;
  const object = asObject(value);
  if (Array.isArray(object.v)) return `路径 ${object.v.length} 个锚点`;
  if (Object.keys(object).length) return JSON.stringify(object).slice(0, 80);
  return '-';
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

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function valueAsString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
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
