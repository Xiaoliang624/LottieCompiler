export type AIEndpointKind = 'chat' | 'responses';

export function normalizeAIEndpoint(input: string): { kind: AIEndpointKind; url: string } {
  let raw = input.trim();
  if (!raw) throw new Error('请填写 Base URL 或接口地址。');
  if (!raw.includes('://')) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('接口地址格式不正确。');
  }

  let path = url.pathname.replace(/\/+$/, '');
  const lowerPath = path.toLowerCase();
  if (!path || lowerPath === '/') {
    path = '/v1/chat/completions';
  } else if (lowerPath === '/v1') {
    path = `${path}/chat/completions`;
  } else if (lowerPath.endsWith('/v1')) {
    path = `${path}/chat/completions`;
  } else if (lowerPath.endsWith('/chat')) {
    path = `${path}/completions`;
  }

  url.pathname = path;
  return {
    kind: url.pathname.toLowerCase().includes('/responses') ? 'responses' : 'chat',
    url: url.toString(),
  };
}

export function modelsUrlFromEndpoint(input: string): string {
  const endpoint = normalizeAIEndpoint(input);
  const url = new URL(endpoint.url);
  const lowerPath = url.pathname.toLowerCase();
  if (lowerPath.endsWith('/chat/completions')) {
    url.pathname = url.pathname.slice(0, -'/chat/completions'.length) || '/';
  } else if (lowerPath.endsWith('/responses')) {
    url.pathname = url.pathname.slice(0, -'/responses'.length) || '/';
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
  return url.toString();
}
