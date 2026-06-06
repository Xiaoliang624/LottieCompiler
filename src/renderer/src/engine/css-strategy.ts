export function shouldPreferBrowserSampler(code: string): boolean {
  const patterns = [
    /\bdisplay\s*:\s*(flex|grid)/i,
    /\bposition\s*:\s*(absolute|fixed|sticky)/i,
    /\b(left|right|top|bottom)\s*:\s*[-\d.]+%/i,
    /\btransform-origin\s*:/i,
    /\bfilter\s*:/i,
    /\bbackdrop-filter\s*:/i,
    /\bbox-shadow\s*:/i,
    /\bvar\(/i,
    /@media\b/i,
    /:hover|:active|:focus|\.active|\.open|\.selected|\.is-active|\.show/i,
    /styled\.\w+|className\s*=|from\s+['"]react['"]|from\s+['"]framer-motion['"]|<motion\./i,
  ];

  return patterns.some((pattern) => pattern.test(code));
}
