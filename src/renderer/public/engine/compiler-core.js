function clampNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function asPoint(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    return [
      clampNumber(value[0], fallback[0]),
      clampNumber(value[1], fallback[1])
    ];
  }

  if (value && typeof value === 'object') {
    return [
      clampNumber(value.x, fallback[0]),
      clampNumber(value.y, fallback[1])
    ];
  }

  return fallback;
}

function asColor(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return [
      clamp(clampNumber(value[0], fallback[0]), 0, 1),
      clamp(clampNumber(value[1], fallback[1]), 0, 1),
      clamp(clampNumber(value[2], fallback[2]), 0, 1),
      value.length > 3 ? clamp(clampNumber(value[3], 1), 0, 1) : 1
    ];
  }

  if (value && typeof value === 'object') {
    return [
      clamp(clampNumber(value.r, fallback[0]), 0, 1),
      clamp(clampNumber(value.g, fallback[1]), 0, 1),
      clamp(clampNumber(value.b, fallback[2]), 0, 1),
      clamp(clampNumber(value.a, 1), 0, 1)
    ];
  }

  return fallback.concat([1]).slice(0, 4);
}

function normalizeAnimationProperty(property) {
  const normalized = String(property || '').toLowerCase().replace(/[\s_.-]/g, '');
  switch (normalized) {
    case 'position':
    case 'pos':
    case 'translate':
    case 'p':
      return 'position';
    case 'positionx':
    case 'x':
    case 'translatex':
    case 'px':
      return 'positionX';
    case 'positiony':
    case 'y':
    case 'translatey':
    case 'py':
      return 'positionY';
    case 'scale':
    case 's':
      return 'scale';
    case 'scalex':
    case 'sx':
      return 'scaleX';
    case 'scaley':
    case 'sy':
      return 'scaleY';
    case 'rotation':
    case 'rotate':
    case 'r':
      return 'rotation';
    case 'opacity':
    case 'alpha':
    case 'o':
      return 'opacity';
    case 'anchor':
    case 'anchorpoint':
    case 'a':
      return 'anchorPoint';
    case 'anchorx':
    case 'ax':
      return 'anchorX';
    case 'anchory':
    case 'ay':
      return 'anchorY';
    case 'skew':
    case 'sk':
      return 'skew';
    case 'skewaxis':
    case 'sa':
      return 'skewAxis';
    case 'fill':
    case 'fillcolor':
    case 'color':
    case 'fc':
      return 'fillColor';
    case 'fillopacity':
    case 'fo':
      return 'fillOpacity';
    case 'stroke':
    case 'strokecolor':
    case 'sc':
      return 'strokeColor';
    case 'strokeopacity':
    case 'so':
      return 'strokeOpacity';
    case 'strokewidth':
    case 'strokeweight':
    case 'linewidth':
    case 'sw':
      return 'strokeWidth';
    case 'trimstart':
      return 'trimStart';
    case 'trimend':
      return 'trimEnd';
    case 'trimoffset':
      return 'trimOffset';
    default:
      return property;
  }
}

function getNodeKind(node) {
  const rawType = node && node.type != null ? String(node.type) : '';
  const rawSourceType = node && node.sourceType != null ? String(node.sourceType) : '';
  const normalizedType = rawType.toLowerCase();
  const normalizedSourceType = rawSourceType.toLowerCase();

  if (normalizedType === 'text' || rawSourceType === 'TEXT') {
    return 'text';
  }

  switch (normalizedType) {
    case 'rect':
    case 'rectangle':
      return 'rect';
    case 'ellipse':
      return 'ellipse';
    case 'star':
      return 'star';
    case 'polygon':
      return 'polygon';
    case 'path':
    case 'vector':
    case 'boolean_operation':
    case 'line':
      return 'path';
    default:
      break;
  }

  switch (normalizedSourceType) {
    case 'rectangle':
      return 'rect';
    case 'ellipse':
      return 'ellipse';
    case 'star':
      return 'star';
    case 'polygon':
      return 'polygon';
    case 'vector':
    case 'boolean_operation':
    case 'path':
    case 'line':
      return 'path';
    default:
      return normalizedType || 'layer';
  }
}

function isContainerNode(node) {
  const rawType = node && node.type != null ? String(node.type) : '';
  const rawSourceType = node && node.sourceType != null ? String(node.sourceType) : '';
  const normalizedType = rawType.toLowerCase();
  const normalizedSourceType = rawSourceType.toLowerCase();

  return normalizedType === 'frame' ||
    normalizedType === 'group' ||
    normalizedType === 'component' ||
    normalizedType === 'instance' ||
    normalizedType === 'component_set' ||
    normalizedType === 'section' ||
    normalizedSourceType === 'frame' ||
    normalizedSourceType === 'group' ||
    normalizedSourceType === 'component' ||
    normalizedSourceType === 'instance' ||
    normalizedSourceType === 'component_set' ||
    normalizedSourceType === 'section';
}

function hexLikeFromColor(color) {
  if (!color) {
    return [0, 0, 0, 1];
  }

  return [
    clampNumber(color.r, 0),
    clampNumber(color.g, 0),
    clampNumber(color.b, 0),
    color.a == null ? 1 : clampNumber(color.a, 1)
  ];
}

function inferFontWeight(style) {
  const normalized = String(style || '').toLowerCase();
  if (normalized.includes('thin')) return '100';
  if (normalized.includes('extralight') || normalized.includes('ultralight')) return '200';
  if (normalized.includes('light')) return '300';
  if (normalized.includes('medium')) return '500';
  if (normalized.includes('semibold') || normalized.includes('demibold')) return '600';
  if (normalized.includes('extrabold') || normalized.includes('ultrabold')) return '800';
  if (normalized.includes('black') || normalized.includes('heavy')) return '900';
  if (normalized.includes('bold')) return '700';
  return '400';
}

function collectFonts(root) {
  const fonts = [];
  const seen = new Set();

  function walk(node) {
    if (!node) {
      return;
    }

    if (node.text && node.text.fontName && node.text.fontName.family) {
      const family = node.text.fontName.family;
      const style = node.text.fontName.style || 'Regular';
      const fontKey = `${family}__${style}`;
      if (!seen.has(fontKey)) {
        seen.add(fontKey);
        fonts.push({
          fName: `${family}-${style}`,
          fFamily: family,
          fPath: '',
          fClass: '',
          origin: 0,
          fWeight: inferFontWeight(style),
          fStyle: style,
          ascent: 75
        });
      }
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walk(child);
    }
  }

  walk(root);
  return fonts;
}

function collectImageAssets(root, assets) {
  const seen = new Set();

  function walk(node) {
    if (!node) {
      return;
    }

    if (node.imageAsset && node.imageAsset.id && !seen.has(node.imageAsset.id)) {
      seen.add(node.imageAsset.id);
      assets.push(node.imageAsset);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walk(child);
    }
  }

  walk(root);
}

function getAnimationsByTarget(spec) {
  const map = new Map();
  const animations = Array.isArray(spec.animations)
    ? spec.animations
    : (Array.isArray(spec.layers) ? spec.layers : []);

  for (const animation of animations) {
    if (!animation || !animation.target) {
      continue;
    }
    animation.property = normalizeAnimationProperty(animation.property || animation.type || animation.attribute);
    const normalizedAnimation = normalizeAnimationSpatialTangents(animation);
    const list = map.get(normalizedAnimation.target) || [];
    list.push(normalizedAnimation);
    map.set(normalizedAnimation.target, list);
  }

  return map;
}

function normalizeAnimationSpatialTangents(animation) {
  if (
    animation.property !== 'position' ||
    !Array.isArray(animation.keyframes) ||
    animation.keyframes.length < 2
  ) {
    return animation;
  }

  const pair = normalizeSpatialTangentPair(animation.spatialTangents || animation.motionPath || animation.pathTangents);
  if (!pair || (!pair.outTangent && !pair.inTangent)) {
    return animation;
  }

  const keyframes = animation.keyframes.map((frame) => (
    frame && typeof frame === 'object' ? Object.assign({}, frame) : frame
  ));
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (
    pair.outTangent &&
    first &&
    typeof first === 'object' &&
    first.outTangent == null &&
    first.spatialOut == null &&
    first.to == null
  ) {
    first.outTangent = pair.outTangent;
  }
  if (
    pair.inTangent &&
    last &&
    typeof last === 'object' &&
    last.inTangent == null &&
    last.spatialIn == null &&
    last.ti == null
  ) {
    last.inTangent = pair.inTangent;
  }

  return Object.assign({}, animation, { keyframes });
}

function getAnimationsForNode(node, animationsByTarget) {
  const byId = animationsByTarget.get(node.id);
  if (byId && byId.length > 0) {
    return byId;
  }

  const byName = animationsByTarget.get(node.name);
  if (byName && byName.length > 0) {
    return byName;
  }

  return [];
}

function buildAnimatedProperty(keyframes, transform, tangentTransform) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return null;
  }

  const normalizedKeyframes = keyframes
    .filter((frame) => frame && frame.value != null)
    .map((frame) => ({
      frame: clampNumber(frame.frame, clampNumber(frame.t, 0)),
      value: frame.value,
      easing: frame.easing,
      outTangent: normalizeSpatialTangent(frame.outTangent || frame.spatialOut || frame.to),
      inTangent: normalizeSpatialTangent(frame.inTangent || frame.spatialIn || frame.ti)
    }))
    .sort((a, b) => a.frame - b.frame);

  if (normalizedKeyframes.length === 0) {
    return null;
  }

  if (normalizedKeyframes.length === 1) {
    return {
      a: 0,
      k: transform(normalizedKeyframes[0].value)
    };
  }

  return {
    a: 1,
    k: normalizedKeyframes.map((frame, index) => {
      const current = transform(frame.value);
      if (index === normalizedKeyframes.length - 1) {
        return {
          t: frame.frame,
          s: current
        };
      }

      const easing = normalizeEasing(frame.easing);

      const keyframe = {
        t: frame.frame,
        s: current,
        e: transform(normalizedKeyframes[index + 1].value),
        i: easing.i,
        o: easing.o
      };
      if (typeof tangentTransform === 'function') {
        const outTangent = frame.outTangent;
        const inTangent = normalizedKeyframes[index + 1].inTangent;
        if (outTangent) {
          keyframe.to = tangentTransform(outTangent);
        }
        if (inTangent) {
          keyframe.ti = tangentTransform(inTangent);
        }
      }
      return keyframe;
    })
  };
}

function normalizeSpatialTangent(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return [
      clampNumber(value[0], 0),
      clampNumber(value[1], 0)
    ];
  }

  if (value && typeof value === 'object') {
    return [
      clampNumber(value.x, 0),
      clampNumber(value.y, 0)
    ];
  }

  return null;
}

function normalizeSpatialTangentPair(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      outTangent: normalizeSpatialTangent(value[0]),
      inTangent: normalizeSpatialTangent(value[1])
    };
  }

  if (value && typeof value === 'object') {
    return {
      outTangent: normalizeSpatialTangent(
        value.outTangent || value.spatialOut || value.spatialOutTangent || value.to || value.out
      ),
      inTangent: normalizeSpatialTangent(
        value.inTangent || value.spatialIn || value.spatialInTangent || value.ti || value.in
      )
    };
  }

  return null;
}

function normalizeBezierPoint(value, fallbackX, fallbackY) {
  if (!Array.isArray(value) || value.length < 2) {
    return [fallbackX, fallbackY];
  }

  return [
    clamp(clampNumber(value[0], fallbackX), 0, 1),
    clamp(clampNumber(value[1], fallbackY), 0, 1)
  ];
}

function normalizeEasing(easing) {
  const preset = normalizeEasingPreset(easing);
  if (preset) {
    return preset;
  }

  if (easing && typeof easing === 'object') {
    const outPoint = normalizeBezierPoint(easing.out, 0.25, 0.1);
    const inPoint = normalizeBezierPoint(easing.in, 0.25, 1);
    return {
      o: { x: [outPoint[0]], y: [outPoint[1]] },
      i: { x: [inPoint[0]], y: [inPoint[1]] }
    };
  }

  return {
    o: { x: [0.25], y: [0.1] },
    i: { x: [0.25], y: [1] }
  };
}

function normalizeEasingPreset(easing) {
  const name = typeof easing === 'string' ? easing.toLowerCase().replace(/[\s_-]/g, '') : '';
  switch (name) {
    case '':
    case 'default':
    case '默认':
      return {
        o: { x: [0.25], y: [0.1] },
        i: { x: [0.25], y: [1] }
      };
    case 'linear':
    case '线性':
      return {
        o: { x: [0], y: [0] },
        i: { x: [1], y: [1] }
      };
    case 'easein':
    case '缓入':
      return {
        o: { x: [0.42], y: [0] },
        i: { x: [1], y: [1] }
      };
    case 'easeout':
    case '缓出':
      return {
        o: { x: [0], y: [0] },
        i: { x: [0.58], y: [1] }
      };
    case 'easeinout':
    case 'easeineaseout':
    case '缓入缓出':
      return {
        o: { x: [0.42], y: [0] },
        i: { x: [0.58], y: [1] }
      };
    default:
      return null;
  }
}

function getNodeCenter(node) {
  return {
    x: clampNumber(node && node.x, 0) + clampNumber(node && node.width, 0) / 2,
    y: clampNumber(node && node.y, 0) + clampNumber(node && node.height, 0) / 2
  };
}

function buildTransform(node, animationsForNode, positionMode, parentNode) {
  const isCenterPosition = positionMode !== 'topLeft';
  const parentCenter = parentNode ? getNodeCenter(parentNode) : { x: 0, y: 0 };
  const nodeCenter = getNodeCenter(node);
  const defaultPositionX = (isCenterPosition ? nodeCenter.x : clampNumber(node.x, 0)) - parentCenter.x;
  const defaultPositionY = (isCenterPosition ? nodeCenter.y : clampNumber(node.y, 0)) - parentCenter.y;
  const transform = {
    p: { a: 0, k: [defaultPositionX, defaultPositionY, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
    r: { a: 0, k: clampNumber(node.rotation, 0) },
    o: { a: 0, k: clampNumber(node.opacity, 100) },
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 }
  };

  if (!animationsForNode || animationsForNode.length === 0) {
    return transform;
  }

  const byProperty = new Map();
  for (const animation of animationsForNode) {
    const property = normalizeAnimationProperty(animation.property);
    const existing = byProperty.get(property) || [];
    byProperty.set(property, existing.concat(animation.keyframes || []));
  }

  if (byProperty.has('anchorPoint')) {
    transform.a = buildAnimatedProperty(byProperty.get('anchorPoint'), (value) => {
      const point = asPoint(value, [0, 0]);
      return [point[0], point[1], 0];
    });
  }

  const positionFrames = byProperty.get('position');
  if (positionFrames) {
    transform.p = buildAnimatedProperty(
      positionFrames,
      (value) => {
        const point = asPoint(value, [defaultPositionX, defaultPositionY]);
        return [point[0] - parentCenter.x, point[1] - parentCenter.y, 0];
      },
      (value) => {
        const point = asPoint(value, [0, 0]);
        return [point[0], point[1], 0];
      }
    );
  }

  const xFrames = byProperty.get('positionX') || [{ frame: 0, value: defaultPositionX + parentCenter.x }];
  const yFrames = byProperty.get('positionY') || [{ frame: 0, value: defaultPositionY + parentCenter.y }];

  if (!positionFrames && (byProperty.has('positionX') || byProperty.has('positionY'))) {
    const frameSet = new Set([
      ...xFrames.map((item) => item.frame),
      ...yFrames.map((item) => item.frame)
    ]);
    const frames = Array.from(frameSet).sort((a, b) => a - b);
    let lastX = defaultPositionX;
    let lastY = defaultPositionY;
    const xMap = new Map(xFrames.map((item) => [item.frame, item]));
    const yMap = new Map(yFrames.map((item) => [item.frame, item]));
    transform.p = buildAnimatedProperty(
      frames.map((frame) => {
        const xEntry = xMap.get(frame) || null;
        const yEntry = yMap.get(frame) || null;
        if (xEntry) lastX = xEntry.value - parentCenter.x;
        if (yEntry) lastY = yEntry.value - parentCenter.y;
        return {
          frame,
          value: [lastX, lastY, 0],
          easing: xEntry && xEntry.easing != null
            ? xEntry.easing
            : (yEntry && yEntry.easing != null ? yEntry.easing : null)
        };
      }),
      (value) => value
    );
  }

  if (byProperty.has('scale')) {
    transform.s = buildAnimatedProperty(byProperty.get('scale'), (value) => {
      if (Array.isArray(value)) {
        return [clampNumber(value[0], 100), clampNumber(value[1], clampNumber(value[0], 100)), 100];
      }
      return [value, value, 100];
    });
  }

  if (byProperty.has('scaleX') || byProperty.has('scaleY')) {
    const scaleXFrames = byProperty.get('scaleX') || [{ frame: 0, value: 100 }];
    const scaleYFrames = byProperty.get('scaleY') || [{ frame: 0, value: 100 }];
    const frameSet = new Set([
      ...scaleXFrames.map((item) => item.frame),
      ...scaleYFrames.map((item) => item.frame)
    ]);
    const frames = Array.from(frameSet).sort((a, b) => a - b);
    let lastX = 100;
    let lastY = 100;
    const xMap = new Map(scaleXFrames.map((item) => [item.frame, item]));
    const yMap = new Map(scaleYFrames.map((item) => [item.frame, item]));
    transform.s = buildAnimatedProperty(
      frames.map((frame) => {
        const xEntry = xMap.get(frame) || null;
        const yEntry = yMap.get(frame) || null;
        if (xEntry) lastX = xEntry.value;
        if (yEntry) lastY = yEntry.value;
        return {
          frame,
          value: [lastX, lastY],
          easing: xEntry && xEntry.easing != null
            ? xEntry.easing
            : (yEntry && yEntry.easing != null ? yEntry.easing : null)
        };
      }),
      (value) => [value[0], value[1], 100]
    );
  }

  if (byProperty.has('rotation')) {
    transform.r = buildAnimatedProperty(byProperty.get('rotation'), (value) => value);
  }

  if (byProperty.has('opacity')) {
    transform.o = buildAnimatedProperty(byProperty.get('opacity'), (value) => value);
  }

  if (byProperty.has('anchorX') || byProperty.has('anchorY')) {
    const anchorXFrames = byProperty.get('anchorX') || [{ frame: 0, value: 0 }];
    const anchorYFrames = byProperty.get('anchorY') || [{ frame: 0, value: 0 }];
    const frameSet = new Set([
      ...anchorXFrames.map((item) => item.frame),
      ...anchorYFrames.map((item) => item.frame)
    ]);
    const frames = Array.from(frameSet).sort((a, b) => a - b);
    let lastX = 0;
    let lastY = 0;
    const xMap = new Map(anchorXFrames.map((item) => [item.frame, item]));
    const yMap = new Map(anchorYFrames.map((item) => [item.frame, item]));
    transform.a = buildAnimatedProperty(
      frames.map((frame) => {
        const xEntry = xMap.get(frame) || null;
        const yEntry = yMap.get(frame) || null;
        if (xEntry) lastX = xEntry.value;
        if (yEntry) lastY = yEntry.value;
        return {
          frame,
          value: [lastX, lastY],
          easing: xEntry && xEntry.easing != null
            ? xEntry.easing
            : (yEntry && yEntry.easing != null ? yEntry.easing : null)
        };
      }),
      (value) => [value[0], value[1], 0]
    );
  }

  if (byProperty.has('skew')) {
    transform.sk = buildAnimatedProperty(byProperty.get('skew'), (value) => value);
  }

  if (byProperty.has('skewAxis')) {
    transform.sa = buildAnimatedProperty(byProperty.get('skewAxis'), (value) => value);
  }

  return transform;
}

function createGroupTransform() {
  return {
    ty: 'tr',
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
    nm: 'Transform'
  };
}

function createShapeGroup(items, name) {
  return {
    ty: 'gr',
    it: items.concat(createGroupTransform()),
    nm: name || 'Group',
    np: items.length,
    cix: 2,
    bm: 0
  };
}

function createRectShape(w, h, r) {
  return {
    ty: 'rc',
    d: 1,
    s: { a: 0, k: [round(clampNumber(w, 0)), round(clampNumber(h, 0))] },
    p: { a: 0, k: [0, 0] },
    r: { a: 0, k: round(clampNumber(r, 0)) }
  };
}

function createEllipseShape(w, h) {
  return {
    ty: 'el',
    d: 1,
    s: { a: 0, k: [round(clampNumber(w, 0)), round(clampNumber(h, 0))] },
    p: { a: 0, k: [0, 0] }
  };
}

function createPathShape(points, name) {
  return {
    ty: 'sh',
    ks: {
      a: 0,
      k: {
        i: points.map(function () { return [0, 0]; }),
        o: points.map(function () { return [0, 0]; }),
        v: points.map(function (point) {
          return [round(point[0]), round(point[1])];
        }),
        c: true
      }
    },
    nm: name
  };
}

function createRadialPoints(pointCount, radiusX, radiusY, isStar, innerRadius) {
  const points = [];
  const count = Math.max(3, Math.round(clampNumber(pointCount, isStar ? 5 : 3)));
  const total = isStar ? count * 2 : count;
  const safeInnerRadius = Math.max(0.01, Math.min(1, clampNumber(innerRadius, 0.5)));
  const startAngle = -Math.PI / 2;

  for (let i = 0; i < total; i++) {
    const useInnerRadius = isStar && i % 2 === 1;
    const radiusScale = useInnerRadius ? safeInnerRadius : 1;
    const angle = startAngle + (i * Math.PI * 2) / total;
    points.push([
      Math.cos(angle) * radiusX * radiusScale,
      Math.sin(angle) * radiusY * radiusScale
    ]);
  }

  return points;
}

function parseSvgPathData(data, centerX, centerY) {
  const tokens = String(data || '').match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens) return [];

  const paths = [];
  let points = [];
  let inTangents = [];
  let outTangents = [];
  let command = '';
  let index = 0;
  let current = [0, 0];
  let start = [0, 0];
  let closed = false;

  function isCommand(token) {
    return /^[MLCQZmlcqz]$/.test(token);
  }

  function readNumber() {
    return parseFloat(tokens[index++]);
  }

  function toLocalPoint(point) {
    return [round(point[0] - centerX), round(point[1] - centerY)];
  }

  function pointsEqual(a, b) {
    return Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;
  }

  function finalizeCurrentPath() {
    if (points.length === 0) {
      return;
    }

    if (closed && points.length > 1 && pointsEqual(points[0], points[points.length - 1])) {
      inTangents[0] = inTangents[inTangents.length - 1];
      points.pop();
      inTangents.pop();
      outTangents.pop();
    }

    paths.push({
      points: points,
      inTangents: inTangents,
      outTangents: outTangents,
      closed: closed
    });

    points = [];
    inTangents = [];
    outTangents = [];
    closed = false;
  }

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }

    switch (command) {
      case 'M':
      case 'm': {
        if (points.length > 0) {
          finalizeCurrentPath();
        }
        const x = readNumber();
        const y = readNumber();
        current = command === 'm' ? [current[0] + x, current[1] + y] : [x, y];
        start = current.slice();
        points.push(toLocalPoint(current));
        inTangents.push([0, 0]);
        outTangents.push([0, 0]);
        command = command === 'm' ? 'l' : 'L';
        break;
      }
      case 'L':
      case 'l': {
        const x = readNumber();
        const y = readNumber();
        current = command === 'l' ? [current[0] + x, current[1] + y] : [x, y];
        points.push(toLocalPoint(current));
        inTangents.push([0, 0]);
        outTangents.push([0, 0]);
        break;
      }
      case 'C':
      case 'c': {
        const x1 = readNumber();
        const y1 = readNumber();
        const x2 = readNumber();
        const y2 = readNumber();
        const x = readNumber();
        const y = readNumber();

        const control1 = command === 'c' ? [current[0] + x1, current[1] + y1] : [x1, y1];
        const control2 = command === 'c' ? [current[0] + x2, current[1] + y2] : [x2, y2];
        const end = command === 'c' ? [current[0] + x, current[1] + y] : [x, y];
        const previous = current.slice();

        outTangents[outTangents.length - 1] = [round(control1[0] - previous[0]), round(control1[1] - previous[1])];
        points.push(toLocalPoint(end));
        inTangents.push([round(control2[0] - end[0]), round(control2[1] - end[1])]);
        outTangents.push([0, 0]);
        current = end;
        break;
      }
      case 'Q':
      case 'q': {
        const qx = readNumber();
        const qy = readNumber();
        const x = readNumber();
        const y = readNumber();
        const control = command === 'q' ? [current[0] + qx, current[1] + qy] : [qx, qy];
        const end = command === 'q' ? [current[0] + x, current[1] + y] : [x, y];
        const cubic1 = [
          current[0] + (2 / 3) * (control[0] - current[0]),
          current[1] + (2 / 3) * (control[1] - current[1])
        ];
        const cubic2 = [
          end[0] + (2 / 3) * (control[0] - end[0]),
          end[1] + (2 / 3) * (control[1] - end[1])
        ];
        outTangents[outTangents.length - 1] = [round(cubic1[0] - current[0]), round(cubic1[1] - current[1])];
        points.push(toLocalPoint(end));
        inTangents.push([round(cubic2[0] - end[0]), round(cubic2[1] - end[1])]);
        outTangents.push([0, 0]);
        current = end;
        break;
      }
      case 'Z':
      case 'z': {
        closed = true;
        current = start.slice();
        if (index < tokens.length && !isCommand(tokens[index])) {
          command = 'L';
        } else {
          finalizeCurrentPath();
        }
        break;
      }
      default: {
        index += 1;
        break;
      }
    }
  }

  finalizeCurrentPath();
  return paths;
}

function createPathShapesFromSvgData(data, name, centerX, centerY) {
  const parsedPaths = parseSvgPathData(data, centerX, centerY);
  const shapes = [];

  for (let i = 0; i < parsedPaths.length; i++) {
    const parsed = parsedPaths[i];
    if (!parsed || parsed.points.length === 0) {
      continue;
    }

    shapes.push({
      ty: 'sh',
      ks: {
        a: 0,
        k: {
          i: parsed.inTangents,
          o: parsed.outTangents,
          v: parsed.points,
          c: parsed.closed
        }
      },
      nm: name + (parsedPaths.length > 1 ? ' ' + (i + 1) : '')
    });
  }

  return shapes;
}

function createGeometryPathShapes(node, preferFillGeometry) {
  const shapes = [];
  let sourcePaths = [];

  if (preferFillGeometry && Array.isArray(node.fillGeometry) && node.fillGeometry.length > 0) {
    sourcePaths = node.fillGeometry;
  } else if (Array.isArray(node.vectorPaths) && node.vectorPaths.length > 0) {
    sourcePaths = node.vectorPaths;
  } else if (Array.isArray(node.fillGeometry) && node.fillGeometry.length > 0) {
    sourcePaths = node.fillGeometry;
  } else if (Array.isArray(node.strokeGeometry) && node.strokeGeometry.length > 0) {
    sourcePaths = node.strokeGeometry;
  }

  for (let i = 0; i < sourcePaths.length; i++) {
    const pathShapes = createPathShapesFromSvgData(
      sourcePaths[i].data,
      'Path',
      clampNumber(node.width, 0) / 2,
      clampNumber(node.height, 0) / 2
    );
    for (const shape of pathShapes) {
      shapes.push(shape);
    }
  }

  return shapes;
}

function createMergeShape(booleanOperation) {
  const map = {
    UNION: 1,
    SUBTRACT: 2,
    INTERSECT: 3,
    EXCLUDE: 4
  };

  return {
    ty: 'mm',
    mm: map[booleanOperation] || 1,
    nm: 'Merge Paths'
  };
}

function mapStrokeCapToLottie(cap) {
  switch (cap) {
    case 'ROUND':
      return 2;
    case 'SQUARE':
      return 3;
    case 'NONE':
    default:
      return 1;
  }
}

function mapStrokeJoinToLottie(join) {
  switch (join) {
    case 'ROUND':
      return 2;
    case 'BEVEL':
      return 3;
    case 'MITER':
    default:
      return 1;
  }
}

function invertTransformMatrix(matrix) {
  if (
    !Array.isArray(matrix) ||
    matrix.length !== 2 ||
    !Array.isArray(matrix[0]) ||
    !Array.isArray(matrix[1]) ||
    matrix[0].length !== 3 ||
    matrix[1].length !== 3
  ) {
    return [[1, 0, 0], [0, 1, 0]];
  }

  const a = matrix[0][0];
  const c = matrix[0][1];
  const tx = matrix[0][2];
  const b = matrix[1][0];
  const d = matrix[1][1];
  const ty = matrix[1][2];
  const det = a * d - b * c;

  if (Math.abs(det) < 0.000001) {
    return [[1, 0, 0], [0, 1, 0]];
  }

  const invDet = 1 / det;
  return [
    [d * invDet, -c * invDet, (c * ty - d * tx) * invDet],
    [-b * invDet, a * invDet, (b * tx - a * ty) * invDet]
  ];
}

function applyTransformToPoint(transform, point) {
  if (
    !Array.isArray(transform) ||
    transform.length !== 2 ||
    !Array.isArray(transform[0]) ||
    !Array.isArray(transform[1]) ||
    transform[0].length !== 3 ||
    transform[1].length !== 3
  ) {
    transform = [[1, 0, 0], [0, 1, 0]];
  }

  return [
    transform[0][0] * point[0] + transform[0][1] * point[1] + transform[0][2],
    transform[1][0] * point[0] + transform[1][1] * point[1] + transform[1][2]
  ];
}

function normalizedGradientPointToLottie(point, node) {
  const width = clampNumber(node.width, 0);
  const height = clampNumber(node.height, 0);
  return [
    round(point[0] * width - width / 2),
    round(point[1] * height - height / 2)
  ];
}

function getGradientHandlePoints(paint) {
  const transform = paint.gradientTransform || [[1, 0, 0], [0, 1, 0]];
  const inverse = invertTransformMatrix(transform);

  if (paint.type === 'GRADIENT_LINEAR') {
    return {
      start: applyTransformToPoint(inverse, [0, 0.5]),
      end: applyTransformToPoint(inverse, [1, 0.5])
    };
  }

  if (paint.type === 'GRADIENT_RADIAL') {
    return {
      center: applyTransformToPoint(inverse, [0.5, 0.5]),
      radiusX: applyTransformToPoint(inverse, [1, 0.5]),
      radiusY: applyTransformToPoint(inverse, [0.5, 1])
    };
  }

  return null;
}

function getGradientPoints(paint, node) {
  let start;
  let end;
  let highlightLength = 0;
  let highlightAngle = 0;

  if (paint.type === 'GRADIENT_LINEAR') {
    const linearHandles = getGradientHandlePoints(paint);
    start = normalizedGradientPointToLottie(linearHandles.start, node);
    end = normalizedGradientPointToLottie(linearHandles.end, node);
  } else if (paint.type === 'GRADIENT_RADIAL') {
    const radialHandles = getGradientHandlePoints(paint);
    start = normalizedGradientPointToLottie(radialHandles.center, node);
    end = normalizedGradientPointToLottie(radialHandles.radiusX, node);
    highlightLength = 0;
    highlightAngle = 0;
  } else {
    const transform = paint.gradientTransform || [[1, 0, 0], [0, 1, 0]];
    start = normalizedGradientPointToLottie(applyTransformToPoint(transform, [0, 0]), node);
    end = normalizedGradientPointToLottie(applyTransformToPoint(transform, [1, 0]), node);
  }

  return {
    start: start,
    end: end,
    highlightLength: highlightLength,
    highlightAngle: highlightAngle
  };
}

function createGradientData(paint) {
  let stops = Array.isArray(paint.gradientStops) ? paint.gradientStops : [];
  const values = [];
  const expandedStops = [];
  let hasAlpha = false;

  if (stops.length === 0) {
    stops = [
      { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }
    ];
  }

  for (let i = 0; i < stops.length; i++) {
    expandedStops.push(stops[i]);
    hasAlpha = hasAlpha || (stops[i].color.a != null && Math.abs(stops[i].color.a - 1) > 0.001);
    if (i < stops.length - 1) {
      const current = stops[i];
      const next = stops[i + 1];
      expandedStops.push({
        position: (current.position + next.position) / 2,
        color: {
          r: (current.color.r + next.color.r) / 2,
          g: (current.color.g + next.color.g) / 2,
          b: (current.color.b + next.color.b) / 2,
          a: ((current.color.a != null ? current.color.a : 1) + (next.color.a != null ? next.color.a : 1)) / 2
        }
      });
    }
  }

  for (const stop of expandedStops) {
    values.push(stop.position, stop.color.r, stop.color.g, stop.color.b);
  }

  if (hasAlpha) {
    for (const stop of expandedStops) {
      values.push(stop.position, stop.color.a != null ? stop.color.a : 1);
    }
  }

  return {
    p: expandedStops.length,
    k: {
      a: 0,
      k: values
    }
  };
}

function createFillShape(fill) {
  const color = fill.color || { r: 1, g: 1, b: 1 };
  const opacity = clamp(clampNumber(fill.opacity, 100), 0, 100);

  return {
    ty: 'fl',
    c: { a: 0, k: [color.r, color.g, color.b, 1] },
    o: { a: 0, k: opacity },
    r: 1,
    nm: 'Fill'
  };
}

function animatedShapeProperty(animationsForNode, property, transform) {
  const frames = [];
  for (const animation of animationsForNode || []) {
    if (normalizeAnimationProperty(animation.property) === property && Array.isArray(animation.keyframes)) {
      frames.push.apply(frames, animation.keyframes);
    }
  }
  return buildAnimatedProperty(frames, transform);
}

function applyShapeAnimations(shapeItems, animationsForNode) {
  if (!animationsForNode || animationsForNode.length === 0) {
    return;
  }

  const fillColor = animatedShapeProperty(animationsForNode, 'fillColor', (value) => {
    const color = asColor(value, [1, 1, 1]);
    return [color[0], color[1], color[2], 1];
  });
  const fillOpacity = animatedShapeProperty(animationsForNode, 'fillOpacity', (value) => clamp(value, 0, 100));
  const strokeColor = animatedShapeProperty(animationsForNode, 'strokeColor', (value) => {
    const color = asColor(value, [0, 0, 0]);
    return [color[0], color[1], color[2], 1];
  });
  const strokeOpacity = animatedShapeProperty(animationsForNode, 'strokeOpacity', (value) => clamp(value, 0, 100));
  const strokeWidth = animatedShapeProperty(animationsForNode, 'strokeWidth', (value) => Math.max(0, value));
  const trimStart = animatedShapeProperty(animationsForNode, 'trimStart', (value) => clamp(value, 0, 100));
  const trimEnd = animatedShapeProperty(animationsForNode, 'trimEnd', (value) => clamp(value, 0, 100));
  const trimOffset = animatedShapeProperty(animationsForNode, 'trimOffset', (value) => value);
  const needsTrim = trimStart || trimEnd || trimOffset;

  for (const item of shapeItems) {
    if ((item.ty === 'fl' || item.ty === 'gf') && fillOpacity) {
      item.o = fillOpacity;
    }
    if (item.ty === 'fl' && fillColor) {
      item.c = fillColor;
    }
    if ((item.ty === 'st' || item.ty === 'gs') && strokeOpacity) {
      item.o = strokeOpacity;
    }
    if ((item.ty === 'st' || item.ty === 'gs') && strokeWidth) {
      item.w = strokeWidth;
    }
    if (item.ty === 'st' && strokeColor) {
      item.c = strokeColor;
    }
  }

  if (needsTrim) {
    shapeItems.push({
      ty: 'tm',
      s: trimStart || { a: 0, k: 0 },
      e: trimEnd || { a: 0, k: 100 },
      o: trimOffset || { a: 0, k: 0 },
      m: 1,
      nm: 'Trim Paths'
    });
  }
}

function createStrokeShape(stroke) {
  const color = stroke.color || { r: 0, g: 0, b: 0 };
  const opacity = clamp(clampNumber(stroke.opacity, 100), 0, 100);

  return {
    ty: 'st',
    c: { a: 0, k: [color.r, color.g, color.b, 1] },
    o: { a: 0, k: opacity },
    w: { a: 0, k: clampNumber(stroke.weight, 1) },
    lc: mapStrokeCapToLottie(stroke.cap),
    lj: mapStrokeJoinToLottie(stroke.join),
    ml: clampNumber(stroke.miterLimit, 4),
    nm: 'Stroke'
  };
}

function createGradientFillShape(fill, node) {
  const points = getGradientPoints(fill, node);
  const gradient = {
    ty: 'gf',
    o: { a: 0, k: clamp(clampNumber(fill.opacity, 100), 0, 100) },
    r: 1,
    g: createGradientData(fill),
    s: { a: 0, k: points.start },
    e: { a: 0, k: points.end },
    t: fill.type === 'GRADIENT_RADIAL' ? 2 : 1,
    nm: 'Gradient Fill'
  };

  if (fill.type === 'GRADIENT_RADIAL') {
    gradient.h = { a: 0, k: points.highlightLength || 0 };
    gradient.a = { a: 0, k: points.highlightAngle || 0 };
  }

  return gradient;
}

function createGradientStrokeShape(stroke, node) {
  const points = getGradientPoints(stroke, node);
  const gradient = {
    ty: 'gs',
    o: { a: 0, k: clamp(clampNumber(stroke.opacity, 100), 0, 100) },
    w: { a: 0, k: clampNumber(stroke.weight, 1) },
    lc: mapStrokeCapToLottie(stroke.cap),
    lj: mapStrokeJoinToLottie(stroke.join),
    ml: clampNumber(stroke.miterLimit, 4),
    g: createGradientData(stroke),
    s: { a: 0, k: points.start },
    e: { a: 0, k: points.end },
    t: stroke.type === 'GRADIENT_RADIAL' ? 2 : 1,
    nm: 'Gradient Stroke'
  };

  if (stroke.type === 'GRADIENT_RADIAL') {
    gradient.h = { a: 0, k: points.highlightLength || 0 };
    gradient.a = { a: 0, k: points.highlightAngle || 0 };
  }

  return gradient;
}

function collectFillStrokeShapes(node) {
  const fillShapes = [];
  const strokeShapes = [];
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const strokes = Array.isArray(node.strokes) ? node.strokes : [];

  for (const fill of fills) {
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID' && fill.color) {
      fillShapes.push(createFillShape(fill));
    } else if (
      fill.type === 'GRADIENT_LINEAR' ||
      fill.type === 'GRADIENT_RADIAL' ||
      fill.type === 'GRADIENT_ANGULAR' ||
      fill.type === 'GRADIENT_DIAMOND'
    ) {
      fillShapes.push(createGradientFillShape(fill, node));
    }
  }

  for (const stroke of strokes) {
    if (!stroke || stroke.visible === false) continue;
    if (stroke.type === 'SOLID' && stroke.color) {
      strokeShapes.push(createStrokeShape(stroke));
    } else if (
      stroke.type === 'GRADIENT_LINEAR' ||
      stroke.type === 'GRADIENT_RADIAL' ||
      stroke.type === 'GRADIENT_ANGULAR' ||
      stroke.type === 'GRADIENT_DIAMOND'
    ) {
      strokeShapes.push(createGradientStrokeShape(stroke, node));
    }
  }

  return strokeShapes.concat(fillShapes);
}

function hasImageAsset(node) {
  return !!(node && node.imageAsset && node.imageAsset.id && node.imageAsset.p);
}

function getCornerRadius(node) {
  if (typeof node.cornerRadius === 'number') {
    return node.cornerRadius;
  }
  if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.length > 0) {
    return Math.max.apply(null, node.rectangleCornerRadii);
  }
  return 0;
}

function getFirstTextFillColor(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  for (const fill of fills) {
    if (fill && fill.type === 'SOLID' && fill.visible !== false && fill.color) {
      return [fill.color.r, fill.color.g, fill.color.b];
    }
  }
  return [0, 0, 0];
}

function getFirstTextStrokeColor(node) {
  const strokes = Array.isArray(node.strokes) ? node.strokes : [];
  for (const stroke of strokes) {
    if (stroke && stroke.type === 'SOLID' && stroke.visible !== false && stroke.color) {
      return [stroke.color.r, stroke.color.g, stroke.color.b];
    }
  }
  return null;
}

function getFirstTextStrokeWidth(node) {
  const strokes = Array.isArray(node.strokes) ? node.strokes : [];
  for (const stroke of strokes) {
    if (stroke && stroke.visible !== false) {
      return clampNumber(stroke.weight, 0);
    }
  }
  return 0;
}

function buildTextDocument(node) {
  const text = node.text || {};
  const fontSize = clampNumber(text.fontSize, 16);
  const family = text.fontName && text.fontName.family ? text.fontName.family : 'Arial';
  const style = text.fontName && text.fontName.style ? text.fontName.style : 'Regular';
  const fillColor = getFirstTextFillColor(node);
  const strokeColor = getFirstTextStrokeColor(node);
  const strokeWidth = getFirstTextStrokeWidth(node);
  let lineHeightPx = fontSize * 1.2;
  let letterSpacingPx = 0;

  if (text.lineHeight) {
    if (text.lineHeight.unit === 'PIXELS') {
      lineHeightPx = text.lineHeight.value;
    } else if (text.lineHeight.unit === 'PERCENT') {
      lineHeightPx = (text.lineHeight.value / 100) * fontSize;
    }
  }

  if (text.letterSpacing) {
    if (text.letterSpacing.unit === 'PIXELS') {
      letterSpacingPx = text.letterSpacing.value;
    } else if (text.letterSpacing.unit === 'PERCENT') {
      letterSpacingPx = (text.letterSpacing.value / 100) * fontSize;
    }
  }

  const styleObj = {
    s: fontSize,
    f: `${family}-${style}`,
    t: text.characters || '',
    j: 0,
    tr: round(letterSpacingPx * 10) / 10,
    lh: round(lineHeightPx),
    ls: 0,
    ca: 0,
    fc: fillColor,
    sz: [Math.round(clampNumber(node.width, 0)), Math.round(clampNumber(node.height, 0))],
    ps: [0, 0]
  };

  if (strokeColor) {
    styleObj.sc = strokeColor;
    styleObj.sw = strokeWidth;
  }

  return {
    d: {
      k: [
        {
          s: styleObj,
          t: 0
        }
      ]
    },
    p: {},
    m: {
      g: 1,
      a: { a: 0, k: [0, 0] }
    },
    a: []
  };
}

function rectToPath(width, height, offsetX, offsetY) {
  const hw = width / 2;
  const hh = height / 2;
  return {
    i: [[0, 0], [0, 0], [0, 0], [0, 0]],
    o: [[0, 0], [0, 0], [0, 0], [0, 0]],
    v: [
      [offsetX - hw, offsetY - hh],
      [offsetX + hw, offsetY - hh],
      [offsetX + hw, offsetY + hh],
      [offsetX - hw, offsetY + hh]
    ],
    c: true
  };
}

function roundedRectToPath(width, height, radius, offsetX, offsetY) {
  const hw = width / 2;
  const hh = height / 2;
  const safeRadius = Math.max(0, Math.min(clampNumber(radius, 0), hw, hh));
  const k = 0.5522847498;
  const control = safeRadius * k;

  if (safeRadius <= 0) {
    return rectToPath(width, height, offsetX, offsetY);
  }

  return {
    i: [
      [0, 0],
      [-control, 0],
      [0, 0],
      [0, -control],
      [0, 0],
      [control, 0],
      [0, 0],
      [0, control]
    ],
    o: [
      [control, 0],
      [0, 0],
      [0, control],
      [0, 0],
      [-control, 0],
      [0, 0],
      [0, -control],
      [0, 0]
    ],
    v: [
      [offsetX - hw + safeRadius, offsetY - hh],
      [offsetX + hw - safeRadius, offsetY - hh],
      [offsetX + hw, offsetY - hh + safeRadius],
      [offsetX + hw, offsetY + hh - safeRadius],
      [offsetX + hw - safeRadius, offsetY + hh],
      [offsetX - hw + safeRadius, offsetY + hh],
      [offsetX - hw, offsetY + hh - safeRadius],
      [offsetX - hw, offsetY - hh + safeRadius]
    ],
    c: true
  };
}

function ellipseToPath(width, height, offsetX, offsetY) {
  const rx = width / 2;
  const ry = height / 2;
  const k = 0.5522847498;
  return {
    i: [[0, -ry * k], [rx * k, 0], [0, ry * k], [-rx * k, 0]],
    o: [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]],
    v: [
      [offsetX, offsetY - ry],
      [offsetX + rx, offsetY],
      [offsetX, offsetY + ry],
      [offsetX - rx, offsetY]
    ],
    c: true
  };
}

function createMaskFromNode(node) {
  const nodeKind = getNodeKind(node);
  let shapes = [];

  if (nodeKind === 'path') {
    shapes = createGeometryPathShapes(node, true);
  } else if (nodeKind === 'ellipse') {
    shapes = [createEllipseShape(node.width, node.height)];
  } else if (nodeKind === 'star') {
    shapes = [createPathShape(
      createRadialPoints(node.pointCount || 5, (node.width || 0) / 2, (node.height || 0) / 2, true, node.innerRadius || 0.5),
      'Star'
    )];
  } else if (nodeKind === 'polygon') {
    shapes = [createPathShape(
      createRadialPoints(node.pointCount || 3, (node.width || 0) / 2, (node.height || 0) / 2, false, 1),
      'Polygon'
    )];
  } else {
    shapes = [createRectShape(node.width, node.height, getCornerRadius(node))];
  }

  return {
    mode: node.maskType === 'INVERTED_ALPHA' || node.maskType === 'INVERTED_LUMINANCE' ? 's' : 'a',
    shapes: shapes,
    x: node.x || 0,
    y: node.y || 0,
    width: node.width || 0,
    height: node.height || 0
  };
}

function offsetMaskPath(shape, mask, layerX, layerY) {
  const offsetX = mask.x + mask.width / 2 - layerX;
  const offsetY = mask.y + mask.height / 2 - layerY;

  if (shape.ty === 'gr') {
    for (const item of shape.it) {
      if (item.ty === 'sh' || item.ty === 'el' || item.ty === 'rc') {
        shape = item;
        break;
      }
    }
  }

  if (shape.ty === 'sh') {
    return {
      i: shape.ks.k.i,
      o: shape.ks.k.o,
      v: shape.ks.k.v.map(function (point) {
        return [point[0] + offsetX, point[1] + offsetY];
      }),
      c: shape.ks.k.c
    };
  }

  if (shape.ty === 'el') {
    return ellipseToPath(mask.width, mask.height, offsetX, offsetY);
  }

  if (shape.ty === 'rc') {
    const radius = shape.r && shape.r.a === 0 ? shape.r.k : 0;
    return roundedRectToPath(mask.width, mask.height, radius, offsetX, offsetY);
  }

  return rectToPath(mask.width, mask.height, offsetX, offsetY);
}

function applyMasks(layer, masks) {
  const layerX = layer.ks.p.k[0] - layer.ks.a.k[0];
  const layerY = layer.ks.p.k[1] - layer.ks.a.k[1];

  layer.hasMask = true;
  layer.masksProperties = [];

  for (const mask of masks) {
    for (const shape of mask.shapes) {
      layer.masksProperties.push({
        inv: mask.mode === 's',
        mode: mask.mode,
        pt: {
          a: 0,
          k: offsetMaskPath(shape, mask, layerX, layerY)
        },
        o: { a: 0, k: 100 },
        x: { a: 0, k: 0 },
        nm: 'Mask'
      });
    }
  }
}

function createBaseLayer(node, index, animationsForNode, durationFrames, positionMode, parentNode) {
  return {
    ddd: 0,
    ind: index,
    ty: 3,
    nm: node.name || '',
    sr: 1,
    ks: buildTransform(node, animationsForNode, positionMode, parentNode),
    ao: 0,
    ip: 0,
    op: durationFrames,
    st: 0,
    bm: 0
  };
}

function createContainerLayer(node, index, animationsForNode, durationFrames, parentNode) {
  return createBaseLayer(node, index, animationsForNode, durationFrames, 'center', parentNode);
}

function createImageLayer(node, index, animationsForNode, durationFrames, parentNode) {
  const layer = createBaseLayer(node, index, animationsForNode, durationFrames, 'center', parentNode);
  layer.ty = 2;
  layer.refId = node.imageAsset.id;
  layer.ks.a = {
    a: 0,
    k: [clampNumber(node.width, 0) / 2, clampNumber(node.height, 0) / 2, 0]
  };
  return layer;
}

function createTextLayer(node, index, animationsForNode, durationFrames, parentNode) {
  const layer = createBaseLayer(node, index, animationsForNode, durationFrames, 'topLeft', parentNode);
  layer.ty = 5;
  layer.t = buildTextDocument(node);
  return layer;
}

function createShapeLayer(node, index, animationsForNode, durationFrames, parentNode) {
  const layer = createBaseLayer(node, index, animationsForNode, durationFrames, 'center', parentNode);
  const shapeItems = [];
  const nodeKind = getNodeKind(node);

  if (nodeKind === 'ellipse') {
    shapeItems.push(createEllipseShape(node.width, node.height));
  } else if (nodeKind === 'star') {
    shapeItems.push(createPathShape(
      createRadialPoints(node.pointCount || 5, (node.width || 0) / 2, (node.height || 0) / 2, true, node.innerRadius || 0.5),
      'Star'
    ));
  } else if (nodeKind === 'polygon') {
    shapeItems.push(createPathShape(
      createRadialPoints(node.pointCount || 3, (node.width || 0) / 2, (node.height || 0) / 2, false, 1),
      'Polygon'
    ));
  } else if (nodeKind === 'path') {
    const paths = createGeometryPathShapes(node, node.booleanOperation != null);
    for (const path of paths) {
      shapeItems.push(path);
    }
    if (node.booleanOperation && shapeItems.length > 1) {
      shapeItems.push(createMergeShape(node.booleanOperation));
    }
  } else {
    shapeItems.push(createRectShape(node.width, node.height, getCornerRadius(node)));
  }

  const paintItems = collectFillStrokeShapes(node);
  for (const paintItem of paintItems) {
    shapeItems.push(paintItem);
  }

  if (shapeItems.length === 0) {
    shapeItems.push(createRectShape(node.width, node.height, 0));
  }

  applyShapeAnimations(shapeItems, animationsForNode);

  layer.ty = 4;
  layer.shapes = [createShapeGroup(shapeItems, node.name)];
  return layer;
}

function createLayerForNode(node, index, animationsByTarget, durationFrames, parentNode) {
  const animationsForNode = getAnimationsForNode(node, animationsByTarget);
  const nodeKind = getNodeKind(node);

  if (hasImageAsset(node)) {
    return createImageLayer(node, index, animationsForNode, durationFrames, parentNode);
  }

  if (isContainerNode(node)) {
    return createContainerLayer(node, index, animationsForNode, durationFrames, parentNode);
  }

  if (nodeKind === 'text') {
    return createTextLayer(node, index, animationsForNode, durationFrames, parentNode);
  }

  return createShapeLayer(node, index, animationsForNode, durationFrames, parentNode);
}

function buildLayerList(root, animationsByTarget, durationFrames) {
  const layers = [];
  const state = { nextIndex: 1 };
  const nodeToIndex = new Map();

  function walk(node, parentIndex, parentNode, inheritedMasks) {
    if (!node || node.visible === false) {
      return inheritedMasks || [];
    }

    const masks = inheritedMasks || [];
    if (node.role === 'root') {
      let rootMasks = [];
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) {
        rootMasks = walk(child, null, null, rootMasks);
      }
      return rootMasks;
    }

    const layer = createLayerForNode(node, state.nextIndex++, animationsByTarget, durationFrames, parentNode);
    nodeToIndex.set(node.id, layer.ind);

    if (parentIndex != null) {
      layer.parent = parentIndex;
    }

    let nextMasks = masks;
    if (masks.length > 0 && !node.isMask) {
      applyMasks(layer, masks);
    }

    if (node.isMask) {
      nextMasks = masks.concat(createMaskFromNode(node));
    } else {
      layers.push(layer);
    }

    if (Array.isArray(node.children) && node.children.length > 0 && !hasImageAsset(node)) {
      const childMasks = node.isMask ? [] : nextMasks;
      let rollingMasks = childMasks;
      for (const child of node.children) {
        rollingMasks = walk(
          child,
          node.isMask ? parentIndex : (nodeToIndex.get(node.id) || null),
          node.isMask ? parentNode : node,
          rollingMasks
        );
      }
    }

    return nextMasks;
  }

  walk(root, null, null, []);
  layers.reverse();
  return layers;
}

function buildLottie(scene, spec) {
  const meta = scene.meta || {};
  const root = scene.root;

  if (!root) {
    throw new Error('scene.json 缺少 root 节点');
  }

  const animationsByTarget = getAnimationsByTarget(spec);
  const durationFrames = clampNumber(spec.meta && spec.meta.durationFrames, clampNumber(meta.durationFrames, 60));
  const layers = buildLayerList(root, animationsByTarget, durationFrames);
  const fonts = collectFonts(root);
  const assets = [];
  collectImageAssets(root, assets);

  const lottie = {
    v: '5.12.2',
    fr: clampNumber(meta.fps, 30),
    ip: 0,
    op: durationFrames,
    w: clampNumber(meta.width, clampNumber(root.width, 390)),
    h: clampNumber(meta.height, clampNumber(root.height, 844)),
    nm: spec.meta && spec.meta.name ? spec.meta.name : (meta.name || 'Scene Motion'),
    ddd: 0,
    assets: assets,
    layers: layers
  };

  if (fonts.length > 0) {
    lottie.fonts = { list: fonts };
  }

  return lottie;
}

module.exports = {
  buildLottie
};
