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

function normalizeAssetPath(pathname) {
  if (!isLocalPath(pathname)) {
    return pathname;
  }
  if (pathname.startsWith("/remote-assets/")) {
    return pathname;
  }
  if (pathname.startsWith("/wp-content/") || pathname.startsWith("/wp-includes/")) {
    return `/remote-assets${pathname}`;
  }
  return pathname;
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
  const normalized = html
    .replace(/(href|src|srcset)=(["'])\/wp-(content|includes)\//g, "$1=$2/remote-assets/wp-$3/")
    .replace(/(url\\()(['"]?)\\/wp-(content|includes)\\//g, "$1$2/remote-assets/wp-$3/")
    .replace(/(,\\s*)\\/wp-(content|includes)\\//g, "$1/remote-assets/wp-$2/");
  // Escape special regex characters in BASE_PATH
  const escapedBasePath = BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use negative lookahead to avoid double-prefixing paths that already have the base path
  const hrefSrcPattern = new RegExp(`(href|src|srcset)=(["'])/(?!${escapedBasePath.slice(1)}/)(?!/)`, "g");
  const urlPattern = new RegExp(`(url\\()(['"]?)/(?!${escapedBasePath.slice(1)}/)(?!/)`, "g");
  // Pattern for additional paths in srcset (paths after commas with optional space)
  const srcsetPathPattern = new RegExp(`(,\\s*)/(?!${escapedBasePath.slice(1)}/)(?!/)`, "g");
  return normalized
    .replace(hrefSrcPattern, `$1=$2${BASE_PATH}/`)
    .replace(srcsetPathPattern, `$1${BASE_PATH}/`)
    .replace(urlPattern, `$1$2${BASE_PATH}/`);
}

export function prefixLinkAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return attrs;
  }
  const result = { ...attrs };
  const normalized = normalizeAssetPath(result.href);
  if (isLocalPath(normalized)) {
    result.href = withBasePath(normalized);
  }
  return result;
}

export function prefixScriptAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return attrs;
  }
  const result = { ...attrs };
  const normalized = normalizeAssetPath(result.src);
  if (isLocalPath(normalized)) {
    result.src = withBasePath(normalized);
  }
  return result;
}
