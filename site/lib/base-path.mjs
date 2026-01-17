const RAW_BASE_PATH = process.env.BASE_PATH || "";
const BASE_PATH = RAW_BASE_PATH && !RAW_BASE_PATH.startsWith("/")
  ? `/${RAW_BASE_PATH}`
  : RAW_BASE_PATH;

export function getBasePath() {
  return BASE_PATH;
}

function isLocalPath(pathname) {
  return typeof pathname === "string" && pathname.startsWith("/") && !pathname.startsWith("//");
}

export function withBasePath(pathname) {
  if (!BASE_PATH || !isLocalPath(pathname)) {
    return pathname;
  }
  return `${BASE_PATH}${pathname}`;
}

export function prefixPathsInHtml(html) {
  if (!BASE_PATH || typeof html !== "string") {
    return html;
  }
  // Escape special regex characters in BASE_PATH
  const escapedBasePath = BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use negative lookahead to avoid double-prefixing paths that already have the base path
  const hrefSrcPattern = new RegExp(`(href|src|srcset)=(["'])/(?!${escapedBasePath.slice(1)}/)(?!/)`, "g");
  const urlPattern = new RegExp(`(url\\()(['"]?)/(?!${escapedBasePath.slice(1)}/)(?!/)`, "g");
  // Pattern for additional paths in srcset (paths after commas with optional space)
  const srcsetPathPattern = new RegExp(`(,\\s*)/(?!${escapedBasePath.slice(1)}/)(?!/)`, "g");
  return html
    .replace(hrefSrcPattern, `$1=$2${BASE_PATH}/`)
    .replace(srcsetPathPattern, `$1${BASE_PATH}/`)
    .replace(urlPattern, `$1$2${BASE_PATH}/`);
}

export function prefixLinkAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return attrs;
  }
  const result = { ...attrs };
  if (isLocalPath(result.href)) {
    result.href = withBasePath(result.href);
  }
  return result;
}

export function prefixScriptAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return attrs;
  }
  const result = { ...attrs };
  if (isLocalPath(result.src)) {
    result.src = withBasePath(result.src);
  }
  return result;
}
