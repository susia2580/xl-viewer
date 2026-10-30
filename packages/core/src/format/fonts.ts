const KO_SANS = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

const FALLBACKS: Record<string, string> = {
  "malgun gothic": '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "맑은 고딕": '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  gulim: 'Gulim, Dotum, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  굴림: 'Gulim, Dotum, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  dotum: 'Dotum, Gulim, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  돋움: 'Dotum, Gulim, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  batang: 'Batang, AppleMyungjo, "Noto Serif KR", serif',
  바탕: 'Batang, AppleMyungjo, "Noto Serif KR", serif',
  gungsuh: 'Gungsuh, Batang, AppleMyungjo, "Noto Serif KR", serif',
  궁서: 'Gungsuh, Batang, AppleMyungjo, "Noto Serif KR", serif',
  calibri: 'Calibri, Carlito, "Segoe UI", ' + KO_SANS,
  cambria: 'Cambria, Caladea, Georgia, "Noto Serif KR", serif',
  arial: 'Arial, "Liberation Sans", Helvetica, ' + KO_SANS,
  "helvetica neue": '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", ' + KO_SANS,
  helvetica: 'Helvetica, Arial, "Liberation Sans", ' + KO_SANS,
  "times new roman": '"Times New Roman", "Liberation Serif", Times, "Noto Serif KR", serif',
  "courier new": '"Courier New", "Liberation Mono", Courier, monospace',
  aptos: 'Aptos, Calibri, Carlito, "Segoe UI", ' + KO_SANS,
};

/** Keeps letters, digits, spaces and a few separators; file content must not reach CSS as syntax. */
function safeName(name: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N} ._-]/gu, "")
      .slice(0, 64)
      .trim() || "sans-serif"
  );
}

/** A file-supplied font name as one safe quoted CSS family. */
export function quoteFontName(name: string): string {
  return '"' + safeName(name) + '"';
}

/** Excel font name -> CSS font-family list. */
export function fontFamily(name: string, extraFallback?: string): string {
  const known = FALLBACKS[name.toLowerCase()];
  if (known) return extraFallback ? known.replace(/(sans-serif|serif|monospace)$/, extraFallback + ", $1") : known;
  return quoteFontName(name) + ", " + (extraFallback ? extraFallback + ", " : "") + KO_SANS;
}
