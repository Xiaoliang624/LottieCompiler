type JsonObject = Record<string, unknown>;

const PROPERTY_ALIASES: Record<string, string> = {
  position: 'position',
  pos: 'position',
  translate: 'position',
  p: 'position',
  positionx: 'positionX',
  x: 'positionX',
  translatex: 'positionX',
  movex: 'positionX',
  left: 'positionX',
  px: 'positionX',
  positiony: 'positionY',
  y: 'positionY',
  translatey: 'positionY',
  movey: 'positionY',
  top: 'positionY',
  py: 'positionY',
  scale: 'scale',
  size: 'scale',
  zoom: 'scale',
  s: 'scale',
  scalex: 'scaleX',
  sx: 'scaleX',
  scaley: 'scaleY',
  sy: 'scaleY',
  rotation: 'rotation',
  rotate: 'rotation',
  angle: 'rotation',
  r: 'rotation',
  opacity: 'opacity',
  alpha: 'opacity',
  fade: 'opacity',
  o: 'opacity',
  anchor: 'anchorPoint',
  anchorpoint: 'anchorPoint',
  a: 'anchorPoint',
  anchorx: 'anchorX',
  ax: 'anchorX',
  anchory: 'anchorY',
  ay: 'anchorY',
  skew: 'skew',
  sk: 'skew',
  skewaxis: 'skewAxis',
  sa: 'skewAxis',
  fill: 'fillColor',
  fillcolor: 'fillColor',
  color: 'fillColor',
  backgroundcolor: 'fillColor',
  fc: 'fillColor',
  fillopacity: 'fillOpacity',
  fillalpha: 'fillOpacity',
  fo: 'fillOpacity',
  stroke: 'strokeColor',
  strokecolor: 'strokeColor',
  bordercolor: 'strokeColor',
  sc: 'strokeColor',
  strokeopacity: 'strokeOpacity',
  strokealpha: 'strokeOpacity',
  so: 'strokeOpacity',
  strokewidth: 'strokeWidth',
  strokeweight: 'strokeWidth',
  linewidth: 'strokeWidth',
  borderwidth: 'strokeWidth',
  sw: 'strokeWidth',
  trim: 'trimEnd',
  trimstart: 'trimStart',
  start: 'trimStart',
  trimpathstart: 'trimStart',
  trimend: 'trimEnd',
  end: 'trimEnd',
  trimpathend: 'trimEnd',
  trimoffset: 'trimOffset',
  offset: 'trimOffset',
  trimpathoffset: 'trimOffset',
};

const ALLOWED_PROPERTIES = new Set(Object.values(PROPERTY_ALIASES));
const SPEC_KEYS = ['spec', 'animationSpec', 'animation_spec', 'animation-spec', 'animation-spec.json', 'json'];

export function extractAnimationSpecFromText(text: string, scene?: unknown): JsonObject {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  const direct = tryParseJson(cleaned);
  if (direct !== null) return normalizeAnimationSpec(direct, scene);

  for (const candidate of extractJsonObjectCandidates(cleaned)) {
    const parsed = tryParseJson(candidate);
    if (parsed !== null) return normalizeAnimationSpec(parsed, scene);
  }

  throw new Error('AI 没有返回有效的 animation-spec.json。');
}

export function normalizeAnimationSpec(input: unknown, scene?: unknown): JsonObject {
  const source = unwrapSpecObject(input);
  const root = Array.isArray(source) ? { animations: source } : asObject(source);
  const rawAnimations = firstArray(root.animations, root.layers, root.keyframes);
  const sceneTargets = collectSceneTargets(scene);
  const durationFrames = clampNumber(
    numberValue(asObject(root.meta).durationFrames) ??
      numberValue(asObject(root.meta).duration) ??
      numberValue(root.durationFrames) ??
      numberValue(root.duration) ??
      60,
    1,
    600
  );

  const animations = rawAnimations
    .map((animation) => normalizeAnimation(animation, durationFrames, sceneTargets))
    .filter((animation): animation is JsonObject => Boolean(animation));

  if (!animations.length) {
    throw new Error(rawAnimations.length ? 'animation-spec.json 没有可用动画。' : 'AI 没有返回 animations。');
  }

  const meta = asObject(root.meta);
  return {
    meta: {
      name: typeof meta.name === 'string' ? meta.name : 'AI 动效',
      ...meta,
      durationFrames: Math.round(durationFrames),
    },
    animations,
  };
}

export function summarizeSpec(spec: unknown): string {
  const root = asObject(spec);
  const animations = Array.isArray(root.animations) ? root.animations : [];
  const targets = new Set<string>();
  for (const item of animations) {
    const animation = asObject(item);
    const target = valueAsString(animation.target);
    if (target) targets.add(target);
  }
  return `${animations.length} 个动画 / ${targets.size} 个目标`;
}

export function summarizeLottie(output: unknown): Array<{ title: string; value: string }> {
  const lottie = asObject(output);
  const width = numberValue(lottie.w);
  const height = numberValue(lottie.h);
  const fps = numberValue(lottie.fr);
  const ip = numberValue(lottie.ip) ?? 0;
  const op = numberValue(lottie.op);
  const layers = Array.isArray(lottie.layers) ? lottie.layers.length : 0;
  const duration = fps && op ? (op - ip) / fps : null;

  return [
    { title: '尺寸', value: width && height ? `${width} x ${height}` : '-' },
    { title: '帧率', value: fps ? formatNumber(fps) : '-' },
    { title: '帧数', value: op ? formatNumber(op - ip) : '-' },
    { title: '时长', value: duration ? `${formatNumber(duration)}s` : '-' },
    { title: '图层', value: String(layers) },
    { title: '版本', value: valueAsString(lottie.v) || '-' },
  ];
}

export function scenePromptContext(scene: unknown, limit = 90): string {
  const nodes = collectSceneNodes(scene).slice(0, limit);
  if (!nodes.length) return JSON.stringify(scene, null, 2).slice(0, 12000);

  return nodes
    .map((node) => {
      const size = node.width || node.height ? ` ${formatNumber(node.width)}x${formatNumber(node.height)}` : '';
      const pos = node.x || node.y ? ` @${formatNumber(node.x)},${formatNumber(node.y)}` : '';
      return `- ${node.id}${node.name ? ` (${node.name})` : ''}${pos}${size}`;
    })
    .join('\n');
}

type ScenePromptNode = {
  id: string;
  name: string;
  parent: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type SceneTarget = {
  raw: string;
  canonical: string;
};

function normalizeAnimation(input: unknown, durationFrames: number, sceneTargets: SceneTarget[]): JsonObject | null {
  const animation = asObject(input);
  const target = canonicalTarget(animation, sceneTargets);
  const property = normalizeProperty(valueAsString(animation.property ?? animation.type ?? animation.attribute ?? animation.prop));
  const rawKeyframes = firstArray(animation.keyframes, animation.frames, animation.values, animation.k);

  if (!target || !property || !rawKeyframes.length) return null;

  let keyframes = rawKeyframes
    .map((keyframe) => normalizeKeyframe(keyframe, property, durationFrames))
    .filter((keyframe): keyframe is JsonObject => Boolean(keyframe))
    .sort((a, b) => (numberValue(a.frame) ?? 0) - (numberValue(b.frame) ?? 0));

  keyframes = normalizeAnimationSpatialTangents(animation, keyframes, property);
  if (!keyframes.length) return null;

  return {
    target,
    property,
    keyframes,
  };
}

function normalizeKeyframe(input: unknown, property: string, durationFrames: number): JsonObject | null {
  const keyframe = asObject(input);
  const rawValue = keyframe.value ?? keyframe.v ?? keyframe.k ?? keyframe.color ?? keyframe.point ?? keyframe.position;
  const value = normalizeValue(rawValue, property);
  if (value === undefined) return null;

  const frame = clampNumber(numberValue(keyframe.frame ?? keyframe.t ?? keyframe.time) ?? 0, 0, durationFrames);
  const output: JsonObject = {
    frame: Math.round(frame),
    value,
    easing: normalizeEasing(keyframe.easing ?? keyframe.ease),
  };

  if (property === 'position') {
    copyPointAlias(output, keyframe, 'outTangent', ['outTangent', 'spatialOut', 'spatialOutTangent', 'to']);
    copyPointAlias(output, keyframe, 'inTangent', ['inTangent', 'spatialIn', 'spatialInTangent', 'ti']);
    copyPointAlias(output, keyframe, 'outControl', ['outControl', 'outControlPoint', 'controlPointOut', 'spatialOutControl']);
    copyPointAlias(output, keyframe, 'inControl', ['inControl', 'inControlPoint', 'controlPointIn', 'spatialInControl']);
  }

  return output;
}

function normalizeAnimationSpatialTangents(animation: JsonObject, keyframes: JsonObject[], property: string): JsonObject[] {
  if (property !== 'position' || keyframes.length < 2) return keyframes;
  const pair = normalizeSpatialTangentPair(animation.spatialTangents ?? animation.motionPath ?? animation.pathTangents);
  if (!pair) return keyframes;

  const output = keyframes.map((keyframe) => ({ ...keyframe }));
  if (pair.outTangent && !output[0].outTangent) output[0].outTangent = pair.outTangent;
  const lastIndex = output.length - 1;
  if (pair.inTangent && !output[lastIndex].inTangent) output[lastIndex].inTangent = pair.inTangent;
  return output;
}

function normalizeSpatialTangentPair(value: unknown): { outTangent?: number[]; inTangent?: number[] } | null {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      outTangent: normalizedPoint(value[0]),
      inTangent: normalizedPoint(value[1]),
    };
  }

  const object = asObject(value);
  const outTangent = normalizedPoint(object.outTangent ?? object.spatialOut ?? object.spatialOutTangent ?? object.to ?? object.out);
  const inTangent = normalizedPoint(object.inTangent ?? object.spatialIn ?? object.spatialInTangent ?? object.ti ?? object.in);
  return outTangent || inTangent ? { outTangent, inTangent } : null;
}

function normalizeProperty(property: string): string | null {
  const mapped = PROPERTY_ALIASES[property.toLowerCase().replace(/[\s_.-]/g, '')] ?? property;
  return ALLOWED_PROPERTIES.has(mapped) ? mapped : null;
}

function normalizeValue(value: unknown, property: string): unknown {
  if (property === 'fillColor' || property === 'strokeColor') return normalizedColorValue(value);
  if (property === 'position' || property === 'anchorPoint') return normalizedPoint(value);
  if (property === 'scale') {
    const point = normalizedPoint(value);
    if (point) return point.map((item) => clampNumber(item, 0, 500));
    const scalar = numberValue(value);
    return scalar === null ? undefined : clampNumber(scalar, 0, 500);
  }

  const raw = Array.isArray(value)
    ? numberValue(property === 'positionY' || property === 'scaleY' || property === 'anchorY' ? value[1] : value[0])
    : numberValue(value);
  if (raw === null) return undefined;
  if (property === 'opacity' || property === 'fillOpacity' || property === 'strokeOpacity' || property === 'trimStart' || property === 'trimEnd') {
    return clampNumber(raw > 0 && raw <= 1 ? raw * 100 : raw, 0, 100);
  }
  if (property === 'scaleX' || property === 'scaleY') return clampNumber(raw, 0, 500);
  return raw;
}

function normalizedPoint(value: unknown): number[] | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = numberValue(value[0]);
    const y = numberValue(value[1]);
    return x === null || y === null ? undefined : [x, y];
  }

  const object = asObject(value);
  const x = numberValue(object.x ?? object['0']);
  const y = numberValue(object.y ?? object['1']);
  return x === null || y === null ? undefined : [x, y];
}

function normalizedColorValue(value: unknown): number[] | undefined {
  if (typeof value === 'string') {
    const hex = value.trim().replace(/^#/, '');
    if (/^[\da-f]{6}([\da-f]{2})?$/i.test(hex)) {
      const hasAlpha = hex.length === 8;
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        hasAlpha ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      ];
    }
  }

  const object = asObject(value);
  if ('r' in object || 'red' in object) {
    const r = numberValue(object.r ?? object.red);
    const g = numberValue(object.g ?? object.green);
    const b = numberValue(object.b ?? object.blue);
    if (r === null || g === null || b === null) return undefined;
    const a = numberValue(object.a ?? object.alpha) ?? 1;
    return [normalizedColorChannel(r), normalizedColorChannel(g), normalizedColorChannel(b), clampNumber(a, 0, 1)];
  }

  if (Array.isArray(value) && value.length >= 3) {
    const r = numberValue(value[0]);
    const g = numberValue(value[1]);
    const b = numberValue(value[2]);
    if (r === null || g === null || b === null) return undefined;
    const a = numberValue(value[3]) ?? 1;
    return [normalizedColorChannel(r), normalizedColorChannel(g), normalizedColorChannel(b), clampNumber(a, 0, 1)];
  }

  return undefined;
}

function normalizeEasing(easing: unknown): unknown {
  if (easing && typeof easing === 'object') return easing;
  const raw = valueAsString(easing || 'ease-in-out')
    .toLowerCase()
    .replace(/[_\s]/g, '-');
  switch (raw) {
    case 'linear':
    case '线性':
      return { out: [0, 0], in: [1, 1] };
    case 'easein':
    case 'ease-in':
    case '缓入':
      return { out: [0.42, 0], in: [1, 1] };
    case 'easeout':
    case 'ease-out':
    case '缓出':
      return { out: [0, 0], in: [0.58, 1] };
    default:
      return { out: [0.42, 0], in: [0.58, 1] };
  }
}

function unwrapSpecObject(input: unknown): unknown {
  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    return parsed === null ? input : unwrapSpecObject(parsed);
  }
  if (Array.isArray(input)) {
    return input;
  }
  const object = asObject(input);
  if (Array.isArray(object.animations) || Array.isArray(object.layers) || Array.isArray(object.keyframes)) return object;
  for (const key of SPEC_KEYS) {
    if (key in object) return unwrapSpecObject(object[key]);
  }
  if (Array.isArray(object.variants) && object.variants.length) return unwrapSpecObject(object.variants[0]);
  if (typeof object.content === 'string') return unwrapSpecObject(object.content);
  if (typeof object.text === 'string') return unwrapSpecObject(object.text);
  return object;
}

function canonicalTarget(animation: JsonObject, sceneTargets: SceneTarget[]): string | null {
  const targetObject = asObject(animation.target);
  const rawTarget = valueAsString(
    animation.target ??
      targetObject.id ??
      targetObject.name ??
      animation.nodeId ??
      animation.nodeID ??
      animation.node ??
      animation.id ??
      animation.name ??
      animation.layer
  );
  if (!rawTarget) return null;
  if (!sceneTargets.length) return rawTarget;
  const exact = sceneTargets.find((item) => item.raw === rawTarget);
  if (exact) return exact.canonical;
  const lower = rawTarget.toLowerCase();
  return sceneTargets.find((item) => item.raw.toLowerCase() === lower)?.canonical ?? null;
}

function collectSceneTargets(scene: unknown): SceneTarget[] {
  return collectSceneNodes(scene).flatMap((node) => {
    const output: SceneTarget[] = [];
    if (node.id) output.push({ raw: node.id, canonical: node.id });
    if (node.name) output.push({ raw: node.name, canonical: node.name });
    return output;
  });
}

function copyPointAlias(output: JsonObject, input: JsonObject, outputKey: string, aliases: string[]) {
  for (const alias of aliases) {
    const point = normalizedPoint(input[alias]);
    if (point) {
      output[outputKey] = point;
      return;
    }
  }
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObjectCandidates(text: string): string[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') starts.push(i);
  }

  const candidates: string[] = [];
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString && ch === '{') {
        depth += 1;
      } else if (!inString && ch === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function collectSceneNodes(scene: unknown, depth = 0, parent?: string): ScenePromptNode[] {
  const node = asObject(scene);
  const root = asObject(node.root);
  if (root && Object.keys(root).length) return collectSceneNodes(root, depth, parent);

  const children = Array.isArray(node.children) ? node.children : [];
  const id = valueAsString(node.id ?? node.nodeId ?? node.name);
  const name = valueAsString(node.name ?? node.label);
  const current = id || name
    ? [{
        id: id || name,
        name,
        parent: parent ?? '',
        depth,
        x: numberValue(node.x) ?? 0,
        y: numberValue(node.y) ?? 0,
        width: numberValue(node.width) ?? 0,
        height: numberValue(node.height) ?? 0,
      }]
    : [];

  return [
    ...current,
    ...children.flatMap((child) => collectSceneNodes(child, depth + 1, name || id || parent)),
  ];
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) as unknown[] ?? [];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function valueAsString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizedColorChannel(value: number): number {
  return value > 1 ? clampNumber(value / 255, 0, 1) : clampNumber(value, 0, 1);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
