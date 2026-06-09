type JsonObject = Record<string, unknown>;

type ScenePromptNode = {
  id: string;
  name: string;
  type: string;
  sourceType: string;
  parent: string;
  depth: number;
  childCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  opacity: number;
  rotation: number;
  hasFill: boolean;
  hasStroke: boolean;
  hasFillGeometry: boolean;
  hasStrokeGeometry: boolean;
  hasImageAsset: boolean;
  isMask: boolean;
  isRootFrame: boolean;
};

type SceneTarget = {
  raw: string;
  canonical: string;
  targetable: boolean;
  fallbackTarget?: string;
};

const PROPERTY_ALIASES: Record<string, string> = {
  position: 'position',
  pos: 'position',
  translate: 'position',
  transformposition: 'position',
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
  widthscale: 'scaleX',
  scaley: 'scaleY',
  sy: 'scaleY',
  heightscale: 'scaleY',
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
  anchorposition: 'anchorPoint',
  transformanchor: 'anchorPoint',
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
  path: 'path',
  shapepath: 'path',
  shape: 'path',
  vertices: 'path',
  vertexpath: 'path',
  pathvertices: 'path',
};

const SPEC_KEYS = ['spec', 'animationSpec', 'animation_spec', 'animation-spec', 'animation-spec.json', 'json'];
const ALLOWED_PROPERTIES = new Set(Object.values(PROPERTY_ALIASES));
const TRANSFORM_PROPERTIES = new Set([
  'position',
  'positionX',
  'positionY',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'anchorPoint',
  'anchorX',
  'anchorY',
  'skew',
  'skewAxis',
]);

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
      sceneDurationFrames(scene),
    1,
    600
  );

  const animations = rawAnimations
    .map((animation) => normalizeAnimation(animation, durationFrames, sceneTargets, scene))
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
  const sizeKb = lottieSizeKb(output);

  return [
    { title: '尺寸', value: width && height ? `${width} x ${height}` : '-' },
    { title: '帧率', value: fps ? formatNumber(fps) : '-' },
    { title: '帧数', value: op ? formatNumber(op - ip) : '-' },
    { title: '时长', value: duration ? `${formatNumber(duration)}s` : '-' },
    { title: '图层', value: String(layers) },
    { title: '体积', value: sizeKb === null ? '-' : `${formatNumber(sizeKb)} KB` },
  ];
}

function lottieSizeKb(output: unknown): number | null {
  try {
    const json = JSON.stringify(output);
    if (!json) return null;
    return new Blob([json]).size / 1024;
  } catch {
    return null;
  }
}

export function scenePromptContext(scene: unknown, focusText = '', limit = 90): string {
  const allNodes = collectSceneNodes(scene);
  const focusedNodes = focusedSceneNodes(allNodes, focusText);
  const sourceNodes = focusedNodes.length ? focusedNodes : allNodes;
  const nodes = sourceNodes.slice(0, limit);
  if (!nodes.length) return JSON.stringify(scene, null, 2).slice(0, 12000);

  return JSON.stringify({
    canvas: sceneCanvas(scene),
    nodeCount: allNodes.length,
    contextMode: focusedNodes.length ? 'focused-nodes' : 'first-nodes',
    nodesIncluded: nodes.length,
    truncated: sourceNodes.length > nodes.length,
    targetRule: 'Use a targetable node id or exact node name. Do not target the root frame/canvas when targetable is false.',
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      sourceType: node.sourceType,
      parent: node.parent,
      depth: node.depth,
      childCount: node.childCount,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      centerX: node.centerX,
      centerY: node.centerY,
      opacity: node.opacity,
      rotation: node.rotation,
      hasFill: node.hasFill,
      hasStroke: node.hasStroke,
      hasFillGeometry: node.hasFillGeometry,
      hasStrokeGeometry: node.hasStrokeGeometry,
      hasImageAsset: node.hasImageAsset,
      isMask: node.isMask,
      targetable: isTargetableSceneNode(node),
    })),
  });
}

export function hasPlayableAnimation(lottie: unknown): boolean {
  return hasAnimatedProperty(lottie, new Set());
}

export function createFallbackAnimationSpec(scene: unknown): JsonObject {
  const target = firstTargetableSceneNode(scene);
  const endFrame = Math.max(1, Math.round(sceneDurationFrames(scene)));
  const fadeFrame = Math.max(1, Math.min(12, Math.round(endFrame / 3)));
  const settleFrame = Math.max(1, Math.min(18, Math.round(endFrame / 2)));

  return {
    meta: {
      name: '兜底动效',
      durationFrames: endFrame,
    },
    animations: target ? [
      {
        target: target.id || target.name,
        property: 'opacity',
        keyframes: [
          { frame: 0, value: 0, easing: 'ease-out' },
          { frame: fadeFrame, value: 100, easing: 'ease-out' },
          { frame: endFrame, value: 100, easing: 'linear' },
        ],
      },
      {
        target: target.id || target.name,
        property: 'scale',
        keyframes: [
          { frame: 0, value: 92, easing: 'ease-out' },
          { frame: settleFrame, value: 104, easing: 'ease-out' },
          { frame: endFrame, value: 100, easing: 'ease-in-out' },
        ],
      },
    ] : [],
  };
}

function normalizeAnimation(input: unknown, durationFrames: number, sceneTargets: SceneTarget[], scene: unknown): JsonObject | null {
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
  keyframes = normalizePositionAnimationCoordinates(target, property, keyframes, scene);
  if (!keyframes.length) return null;

  return {
    target,
    property,
    keyframes,
  };
}

function normalizeKeyframe(input: unknown, property: string, durationFrames: number): JsonObject | null {
  const keyframe = asObject(input);
  const rawValue = property === 'path'
    ? keyframe.value ?? keyframe.path ?? keyframe.shapePath ?? keyframe.vertices ?? keyframe.points ?? keyframe
    : keyframe.value ?? keyframe.v ?? keyframe.k ?? keyframe.color ?? keyframe.point ?? keyframe.position;
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

function normalizePositionAnimationCoordinates(target: string, property: string, keyframes: JsonObject[], scene: unknown): JsonObject[] {
  if (property !== 'position' && property !== 'positionX' && property !== 'positionY') return keyframes;
  const reference = sceneNodeReference(scene, target);
  if (!reference) return keyframes;

  return keyframes.map((keyframe) => {
    const output = { ...keyframe };
    if (property === 'position') {
      const point = normalizedPoint(output.value);
      if (!point) return output;
      const normalizedPointValue = normalizePositionPoint(point, reference);
      output.value = normalizedPointValue;
      normalizeAbsoluteSpatialControls(output, normalizedPointValue, reference);
      return output;
    }

    const raw = numberValue(output.value);
    if (raw === null) return output;
    output.value = normalizePositionAxisValue(
      raw,
      property === 'positionX' ? reference.x : reference.y,
      property === 'positionX' ? reference.centerX : reference.centerY
    );
    return output;
  });
}

function normalizePositionPoint(point: number[], reference: ScenePromptNode): number[] {
  return [
    normalizePositionAxisValue(point[0], reference.x, reference.centerX),
    normalizePositionAxisValue(point[1], reference.y, reference.centerY),
  ];
}

function normalizePositionAxisValue(value: number, referenceValue: number, centerValue: number): number {
  return Math.abs(value - referenceValue) < 0.01 ? centerValue : value;
}

function normalizeAbsoluteSpatialControls(keyframe: JsonObject, position: number[], reference: ScenePromptNode) {
  const outControl = normalizedPoint(keyframe.outControl);
  if (outControl) {
    const control = normalizePositionPoint(outControl, reference);
    keyframe.outTangent = [control[0] - position[0], control[1] - position[1]];
    delete keyframe.outControl;
  }

  const inControl = normalizedPoint(keyframe.inControl);
  if (inControl) {
    const control = normalizePositionPoint(inControl, reference);
    keyframe.inTangent = [control[0] - position[0], control[1] - position[1]];
    delete keyframe.inControl;
  }
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
  if (property === 'path') return normalizedPathValue(value);
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

function normalizedPathValue(value: unknown): JsonObject | string | undefined {
  if (typeof value === 'string') {
    const pathData = value.trim();
    return pathData ? pathData : undefined;
  }

  const object = asObject(value);
  const vertices = normalizedPointList(firstArray(object.v, object.vertices, object.points, Array.isArray(value) ? value : undefined));
  if (!vertices.length) return undefined;

  const inTangents = normalizedTangentList(
    firstArray(object.i, object.inTangents, object.in, object.ti),
    vertices.length
  );
  const outTangents = normalizedTangentList(
    firstArray(object.o, object.outTangents, object.out, object.to),
    vertices.length
  );
  const closed = typeof object.c === 'boolean'
    ? object.c
    : (typeof object.closed === 'boolean' ? object.closed : true);
  const coordinateSpace = valueAsString(object.coordinateSpace ?? object.space);

  return {
    v: vertices,
    i: inTangents,
    o: outTangents,
    c: closed,
    ...(coordinateSpace ? { coordinateSpace } : {}),
  };
}

function normalizedPointList(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => normalizedPoint(point))
    .filter((point): point is number[] => Boolean(point));
}

function normalizedTangentList(value: unknown, length: number): number[][] {
  const points = normalizedPointList(value);
  return Array.from({ length }, (_, index) => points[index] ?? [0, 0]);
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
    case 'default':
    case '默认':
      return { out: [0.25, 0.1], in: [0.25, 1] };
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
    case 'smooth':
    case 'easeinout':
    case 'ease-in-out':
    case '缓入缓出':
      return { out: [0.42, 0], in: [0.58, 1] };
    default:
      return { out: [0.42, 0], in: [0.58, 1] };
  }
}

function unwrapSpecObject(input: unknown): unknown {
  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    return parsed === null ? input : unwrapSpecObject(parsed);
  }
  if (Array.isArray(input)) return input;
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
  if (exact) return exact.targetable ? exact.canonical : exact.fallbackTarget ?? null;
  const lower = rawTarget.toLowerCase();
  const insensitive = sceneTargets.find((item) => item.raw.toLowerCase() === lower);
  if (insensitive) return insensitive.targetable ? insensitive.canonical : insensitive.fallbackTarget ?? null;
  return null;
}

function collectSceneTargets(scene: unknown): SceneTarget[] {
  const nodes = collectSceneNodes(scene);
  const firstTargetable = nodes.find(isTargetableSceneNode);
  const fallbackTarget = firstTargetable?.id || firstTargetable?.name;
  const targets = nodes.flatMap((node) => {
    const output: SceneTarget[] = [];
    const targetable = isTargetableSceneNode(node);
    const nodeFallbackTarget = targetable ? undefined : fallbackTarget;
    if (node.id) output.push({ raw: node.id, canonical: node.id, targetable, fallbackTarget: nodeFallbackTarget });
    if (node.name) output.push({ raw: node.name, canonical: node.name, targetable, fallbackTarget: nodeFallbackTarget });
    return output;
  });

  return [
    ...rootSceneAliases(scene).map((raw) => ({
      raw,
      canonical: raw,
      targetable: false,
      fallbackTarget,
    })),
    ...targets,
  ];
}

function rootSceneAliases(scene: unknown): string[] {
  const sceneObject = asObject(scene);
  const root = asObject(sceneObject.root);
  const aliases = [
    valueAsString(root.id ?? root.nodeId),
    valueAsString(root.name ?? root.label),
  ].filter(Boolean);
  return [...new Set(aliases)];
}

function sceneNodeReference(scene: unknown, target: string): ScenePromptNode | null {
  const nodes = collectSceneNodes(scene);
  const exact = nodes.find((node) => node.id === target || node.name === target);
  if (exact) return exact;
  const lower = target.toLowerCase();
  return nodes.find((node) => node.id.toLowerCase() === lower || node.name.toLowerCase() === lower) ?? null;
}

function firstTargetableSceneNode(scene: unknown): ScenePromptNode | undefined {
  return collectSceneNodes(scene).find(isTargetableSceneNode);
}

function isTargetableSceneNode(node: ScenePromptNode): boolean {
  if (node.isMask) return false;
  if (node.isRootFrame) return false;
  if (node.hasImageAsset || node.hasFill || node.hasStroke || node.hasFillGeometry || node.hasStrokeGeometry) return true;
  const type = `${node.type} ${node.sourceType}`.toLowerCase();
  if (type.includes('text') || type.includes('image') || type.includes('vector') || type.includes('star') || type.includes('ellipse') || type.includes('rectangle') || type.includes('shape')) return true;
  return node.childCount === 0 && Boolean(node.id || node.name);
}

function focusedSceneNodes(nodes: ScenePromptNode[], focusText: string): ScenePromptNode[] {
  const keywords = focusText
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff:_-]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  if (!keywords.length) return [];

  const focusedNames = new Set<string>();
  const included = new Set<string>();
  for (const node of nodes) {
    const haystack = [node.id, node.name, node.type, node.sourceType, node.parent].join(' ').toLowerCase();
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      const key = sceneNodeKey(node);
      if (key) included.add(key);
      if (node.name) focusedNames.add(node.name.toLowerCase());
      if (node.parent) focusedNames.add(node.parent.toLowerCase());
    }
  }

  if (!included.size) return [];
  for (const node of nodes) {
    const key = sceneNodeKey(node);
    if (!key) continue;
    if (focusedNames.has(node.name.toLowerCase()) || focusedNames.has(node.parent.toLowerCase())) included.add(key);
  }
  return nodes.filter((node) => {
    const key = sceneNodeKey(node);
    return key ? included.has(key) : false;
  });
}

function sceneNodeKey(node: ScenePromptNode): string {
  return node.id || node.name;
}

function sceneCanvas(scene: unknown): { width: number; height: number } {
  const object = asObject(scene);
  const root = asObject(object.root);
  return {
    width: numberValue(object.width ?? object.w ?? root.width) ?? 0,
    height: numberValue(object.height ?? object.h ?? root.height) ?? 0,
  };
}

function sceneDurationFrames(scene: unknown): number {
  const object = asObject(scene);
  const meta = asObject(object.meta);
  return clampNumber(
    numberValue(meta.durationFrames) ?? numberValue(object.durationFrames) ?? 60,
    1,
    600
  );
}

function collectSceneNodes(scene: unknown, depth = 0, parent = '', forceRootFrame = false): ScenePromptNode[] {
  const node = asObject(scene);
  const root = asObject(node.root);
  if (root && Object.keys(root).length) return collectSceneNodes(root, depth, parent, true);

  const children = Array.isArray(node.children) ? node.children : [];
  if (valueAsString(node.role) === 'root') {
    return children.flatMap((child) => collectSceneNodes(child, depth, '', false));
  }

  const id = valueAsString(node.id ?? node.nodeId ?? node.name);
  const name = valueAsString(node.name ?? node.label);
  const x = numberValue(node.x) ?? 0;
  const y = numberValue(node.y) ?? 0;
  const width = numberValue(node.width) ?? 0;
  const height = numberValue(node.height) ?? 0;
  const currentName = name || id || parent;
  const current = id || name ? [{
    id: id || name,
    name,
    type: valueAsString(node.type ?? node.figmaType ?? node.sourceType),
    sourceType: valueAsString(node.sourceType ?? node.figmaType),
    parent,
    depth,
    childCount: children.length,
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    opacity: numberValue(node.opacity) ?? 100,
    rotation: numberValue(node.rotation) ?? 0,
    hasFill: nonEmptyArray(node.fills),
    hasStroke: nonEmptyArray(node.strokes),
    hasFillGeometry: nonEmptyArray(node.fillGeometry),
    hasStrokeGeometry: nonEmptyArray(node.strokeGeometry),
    hasImageAsset: Boolean(asObject(node.imageAsset).id || asObject(node.imageAsset).p),
    isMask: Boolean(node.isMask),
    isRootFrame: forceRootFrame || (depth === 0 && children.length > 0),
  }] : [];

  return [
    ...current,
    ...children.flatMap((child) => collectSceneNodes(child, depth + 1, currentName, false)),
  ];
}

function hasAnimatedProperty(value: unknown, seen: Set<unknown>): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (!Array.isArray(value)) {
    const object = value as JsonObject;
    if (object.a === 1 && Array.isArray(object.k) && animatedKeyframesDiffer(object.k)) return true;
  }

  const values = Array.isArray(value) ? value : Object.values(value as JsonObject);
  return values.some((item) => hasAnimatedProperty(item, seen));
}

function animatedKeyframesDiffer(keyframes: unknown[]): boolean {
  const frames = keyframes.map(asObject);
  if (frames.some((frame) => frame.e !== undefined && !jsonValuesEqual(frame.s, frame.e))) return true;

  const values = frames.map((frame) => frame.s).filter((value) => value !== undefined);
  return values.length > 1 && values.slice(1).some((value) => !jsonValuesEqual(value, values[0]));
}

function jsonValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
