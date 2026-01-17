import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";

const BASE_URL = process.env.SCRAPE_BASE_URL || "https://incunest.org";
const RAW_BASE_PATH = process.env.BASE_PATH || "";
const BASE_PATH = RAW_BASE_PATH && !RAW_BASE_PATH.startsWith("/")
  ? `/${RAW_BASE_PATH}`
  : RAW_BASE_PATH;
const MAX_PAGES = Number.parseInt(process.env.SCRAPE_MAX_PAGES || "0", 10);
const AUTO_EN_VARIANTS = process.env.SCRAPE_AUTO_EN_VARIANTS !== "false";
const DEFAULT_SITEMAP_PATHS = ["/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml"];
const DEFAULT_EXTRA_PATHS = [];
const DEFAULT_EXCLUDE_PATHS = [];
const EXTRA_PATHS = [
  ...DEFAULT_EXTRA_PATHS,
  ...(process.env.SCRAPE_EXTRA_PATHS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
];
const EXCLUDE_PATHS = [
  ...DEFAULT_EXCLUDE_PATHS,
  ...(process.env.SCRAPE_EXCLUDE_PATHS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
];
const EXTRA_URLS = (process.env.SCRAPE_EXTRA_URLS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(MIGRATION_DIR, "..");
const CONTENT_DIR = process.env.CONTENT_ROOT
  ? path.resolve(process.env.CONTENT_ROOT)
  : path.join(MIGRATION_DIR, "content");
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.join(REPO_ROOT, "site", "public", "remote-assets");
const ROUTES_PATH = path.join(CONTENT_DIR, "routes.json");
const parser = new XMLParser({ ignoreAttributes: false });
const baseOrigin = new URL(BASE_URL).origin;

const downloaded = new Map();
const rewritingCss = new Set();

const assetExtensions = new Set([
  ".css",
  ".js",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".zip",
  ".rar",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".xml",
  ".json"
]);

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isSkippableUrl(url) {
  return (
    url.startsWith("data:") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("javascript:") ||
    url.startsWith("#")
  );
}

function isInternal(url) {
  try {
    return new URL(url).origin === baseOrigin;
  } catch {
    return false;
  }
}

function prefixBasePath(urlPath) {
  if (!BASE_PATH) {
    return urlPath;
  }
  if (urlPath === "/") {
    return `${BASE_PATH}/`;
  }
  return `${BASE_PATH}${urlPath}`;
}

async function urlExists(url) {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (head.ok) {
      return true;
    }
    if (head.status === 403 || head.status === 405) {
      const get = await fetch(url, { redirect: "follow" });
      return get.ok;
    }
  } catch {
    return false;
  }
  return false;
}

async function addEnglishVariants(urls) {
  if (!AUTO_EN_VARIANTS) {
    return urls;
  }

  const allUrls = new Set(urls);
  const candidates = [];

  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }

    if (parsed.origin !== baseOrigin) {
      continue;
    }

    if (parsed.pathname.startsWith("/en/")) {
      continue;
    }

    if (!/^\/articulo-[^/]+\/?$/.test(parsed.pathname)) {
      continue;
    }

    const enPath = `/en${parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`}`;
    const enUrl = new URL(enPath, BASE_URL).toString();
    if (!allUrls.has(enUrl)) {
      candidates.push(enUrl);
    }
  }

  for (const candidate of candidates) {
    if (await urlExists(candidate)) {
      allUrls.add(candidate);
    }
  }

  return [...allUrls];
}

function buildAssetPaths(url) {
  const { pathname, search } = new URL(url);
  const cleanPath = pathname.replace(/^\//, "");
  let finalPath = cleanPath;

  if (search) {
    const hash = crypto.createHash("sha1").update(search).digest("hex").slice(0, 8);
    const ext = path.extname(cleanPath);
    if (ext) {
      finalPath = `${cleanPath.slice(0, -ext.length)}.${hash}${ext}`;
    } else {
      finalPath = `${cleanPath}-${hash}`;
    }
  }

  return {
    fsPath: path.join(PUBLIC_DIR, finalPath),
    publicPath: prefixBasePath(`/remote-assets/${finalPath}`)
  };
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return await response.text();
}

async function downloadAsset(url) {
  if (downloaded.has(url)) {
    return downloaded.get(url);
  }

  const { fsPath, publicPath } = buildAssetPaths(url);
  downloaded.set(url, publicPath);

  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      console.warn(`Skipping asset ${url}: ${response.status}`);
      return publicPath;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(fsPath), { recursive: true });
    await fs.writeFile(fsPath, buffer);

    if (fsPath.endsWith(".css")) {
      await rewriteCssFile(fsPath, url);
    }
  } catch (error) {
    console.warn(`Failed to download ${url}: ${error.message}`);
  }

  return publicPath;
}

async function rewriteCssFile(filePath, cssUrl) {
  if (rewritingCss.has(filePath)) {
    return;
  }

  rewritingCss.add(filePath);
  const cssText = await fs.readFile(filePath, "utf8");
  const updated = await rewriteCssText(cssText, cssUrl);

  if (updated !== cssText) {
    await fs.writeFile(filePath, updated);
  }

  rewritingCss.delete(filePath);
}

async function rewriteCssText(cssText, baseUrl) {
  let updated = cssText;
  const urlRegex = /url\(([^)]+)\)/gi;
  const matches = [...cssText.matchAll(urlRegex)];

  for (const match of matches) {
    const raw = match[1].trim();
    const cleaned = raw.replace(/^['"]|['"]$/g, "");
    if (!cleaned || isSkippableUrl(cleaned)) {
      continue;
    }

    let resolved;
    try {
      resolved = new URL(cleaned, baseUrl).toString();
    } catch {
      continue;
    }

    if (isInternal(resolved)) {
      const local = await downloadAsset(resolved);
      updated = updated.replace(match[0], `url(${local})`);
    }
  }

  const importRegex = /@import\s+(?:url\()?['"]?([^'"\)]+)['"]?\)?/gi;
  const importMatches = [...cssText.matchAll(importRegex)];
  for (const match of importMatches) {
    const raw = match[1].trim();
    if (!raw || isSkippableUrl(raw)) {
      continue;
    }

    let resolved;
    try {
      resolved = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }

    if (isInternal(resolved)) {
      const local = await downloadAsset(resolved);
      updated = updated.replace(match[0], `@import url(${local})`);
    }
  }

  return updated;
}

function getAttrs(element) {
  const attrs = element?.attribs || {};
  const normalized = {};

  for (const [key, value] of Object.entries(attrs)) {
    const normalizedKey = normalizeAttrKey(key);
    if (value === "" || value === key) {
      normalized[normalizedKey] = true;
    } else {
      normalized[normalizedKey] = value;
    }
  }

  return normalized;
}

function normalizeAttrKey(key) {
  const lower = key.toLowerCase();
  switch (lower) {
    case "class":
      return "className";
    case "http-equiv":
      return "httpEquiv";
    case "accept-charset":
      return "acceptCharset";
    case "charset":
      return "charSet";
    case "crossorigin":
      return "crossOrigin";
    case "referrerpolicy":
      return "referrerPolicy";
    case "hreflang":
      return "hrefLang";
    case "srcset":
      return "srcSet";
    case "content-security-policy":
      return "contentSecurityPolicy";
    case "tabindex":
      return "tabIndex";
    case "readonly":
      return "readOnly";
    case "maxlength":
      return "maxLength";
    case "minlength":
      return "minLength";
    default:
      return key;
  }
}

function looksLikeAsset(url) {
  try {
    const pathname = new URL(url).pathname;
    if (pathname.includes("/wp-content/") || pathname.includes("/wp-includes/")) {
      return true;
    }
    const ext = path.extname(pathname).toLowerCase();
    return ext ? assetExtensions.has(ext) : false;
  } catch {
    return false;
  }
}

function resolveUrl(rawUrl, pageUrl) {
  try {
    return new URL(rawUrl, pageUrl).toString();
  } catch {
    return null;
  }
}

async function rewriteDomAssets($, pageUrl) {
  const elementsWithSrc = $("[src]");
  for (const element of elementsWithSrc.toArray()) {
    const $el = $(element);
    const raw = $el.attr("src");
    if (!raw || isSkippableUrl(raw)) {
      continue;
    }
    const resolved = resolveUrl(raw, pageUrl);
    if (!resolved) {
      continue;
    }
    if (isInternal(resolved)) {
      const local = await downloadAsset(resolved);
      $el.attr("src", local);
    }
  }

  const elementsWithHref = $("[href]");
  for (const element of elementsWithHref.toArray()) {
    const $el = $(element);
    const raw = $el.attr("href");
    if (!raw || isSkippableUrl(raw)) {
      continue;
    }

    const resolved = resolveUrl(raw, pageUrl);
    if (!resolved) {
      continue;
    }

    if (!isInternal(resolved)) {
      continue;
    }

    const tagName = element.tagName?.toLowerCase();
    if (tagName === "a") {
      if (looksLikeAsset(resolved)) {
        const local = await downloadAsset(resolved);
        $el.attr("href", local);
        continue;
      }

      const target = new URL(resolved);
      const pathname = target.pathname.endsWith("/")
        ? target.pathname
        : `${target.pathname}/`;
      const newHref = `${prefixBasePath(pathname)}${target.search}${target.hash}`;
      $el.attr("href", newHref);
      continue;
    }

    if (looksLikeAsset(resolved)) {
      const local = await downloadAsset(resolved);
      $el.attr("href", local);
    }
  }

  const elementsWithSrcset = $("[srcset]");
  for (const element of elementsWithSrcset.toArray()) {
    const $el = $(element);
    const raw = $el.attr("srcset");
    if (!raw) {
      continue;
    }

    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    const rewritten = [];

    for (const part of parts) {
      const [urlPart, descriptor] = part.split(/\s+/, 2);
      if (!urlPart || isSkippableUrl(urlPart)) {
        rewritten.push(part);
        continue;
      }

      const resolved = resolveUrl(urlPart, pageUrl);
      if (!resolved || !isInternal(resolved)) {
        rewritten.push(part);
        continue;
      }

      const local = await downloadAsset(resolved);
      rewritten.push(descriptor ? `${local} ${descriptor}` : local);
    }

    if (rewritten.length) {
      $el.attr("srcset", rewritten.join(", "));
    }
  }

  const styleTags = $("style");
  for (const element of styleTags.toArray()) {
    const $el = $(element);
    const cssText = $el.html() || "";
    if (!cssText.trim()) {
      continue;
    }

    const updated = await rewriteCssText(cssText, pageUrl);
    if (updated !== cssText) {
      $el.text(updated);
    }
  }
}

async function scrapePage(url) {
  const html = await fetchText(url);
  const $ = load(html, { decodeEntities: false });

  await rewriteDomAssets($, url);

  const head = $("head");
  const body = $("body");
  const htmlTag = $("html");

  const title = head.find("title").first().text().trim();

  const meta = head.find("meta").toArray().map((el) => getAttrs(el));
  const links = head.find("link").toArray().map((el) => getAttrs(el));
  const styles = head.find("style").toArray().map((el) => $(el).html() || "");
  const scripts = head.find("script").toArray().map((el) => {
    const attrs = getAttrs(el);
    const inline = $(el).html()?.trim();
    return inline ? { ...attrs, inline } : { ...attrs };
  });

  const bodyHtml = body.html() || "";
  const bodyAttrs = getAttrs(body.get(0));
  const htmlAttrs = getAttrs(htmlTag.get(0));

  return {
    title,
    meta,
    links,
    styles,
    scripts,
    bodyHtml,
    bodyAttrs,
    htmlAttrs
  };
}

async function loadSitemapUrls() {
  const candidateUrls = process.env.SCRAPE_SITEMAP_URL
    ? [process.env.SCRAPE_SITEMAP_URL]
    : DEFAULT_SITEMAP_PATHS.map((entry) => new URL(entry, BASE_URL).toString());
  let sitemapIndexXml = null;
  let sitemapIndexUrl = null;

  for (const candidate of candidateUrls) {
    try {
      sitemapIndexXml = await fetchText(candidate);
      sitemapIndexUrl = candidate;
      break;
    } catch (error) {
      console.warn(`Skipping sitemap ${candidate}: ${error.message}`);
    }
  }

  if (!sitemapIndexXml) {
    throw new Error(`Failed to load sitemap index from ${candidateUrls.join(", ")}`);
  }

  const index = parser.parse(sitemapIndexXml);
  const urlsetUrls = toArray(index.urlset?.url)
    .map((entry) => entry.loc)
    .filter(Boolean);

  if (urlsetUrls.length) {
    return urlsetUrls;
  }

  const sitemapEntries = toArray(index.sitemapindex?.sitemap);
  const sitemapUrls = sitemapEntries
    .map((entry) => entry.loc)
    .filter(Boolean)
    .filter((loc) => !loc.includes("wp-sitemap-users"));

  if (!sitemapUrls.length) {
    throw new Error(`No sitemap URLs found in ${sitemapIndexUrl}`);
  }

  const pageUrls = [];

  for (const sitemapUrl of sitemapUrls) {
    const sitemapXml = await fetchText(sitemapUrl);
    const sitemap = parser.parse(sitemapXml);
    const urls = toArray(sitemap.urlset?.url)
      .map((entry) => entry.loc)
      .filter(Boolean);

    for (const url of urls) {
      if (!pageUrls.includes(url)) {
        pageUrls.push(url);
      }
    }
  }

  return pageUrls;
}

function addExtraUrls(urls) {
  const allUrls = new Set(urls);

  for (const extra of EXTRA_URLS) {
    try {
      allUrls.add(new URL(extra).toString());
    } catch {
      console.warn(`Skipping invalid SCRAPE_EXTRA_URLS entry: ${extra}`);
    }
  }

  for (const extraPath of EXTRA_PATHS) {
    try {
      const normalized = extraPath.startsWith("/")
        ? extraPath
        : `/${extraPath}`;
      allUrls.add(new URL(normalized, BASE_URL).toString());
    } catch {
      console.warn(`Skipping invalid SCRAPE_EXTRA_PATHS entry: ${extraPath}`);
    }
  }

  return [...allUrls];
}

function normalizePathname(pathname) {
  if (!pathname) {
    return "/";
  }
  const withLeading = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function filterExcludedUrls(urls) {
  if (!EXCLUDE_PATHS.length) {
    return urls;
  }

  const excluded = new Set(EXCLUDE_PATHS.map(normalizePathname));
  return urls.filter((url) => {
    try {
      const parsed = new URL(url);
      return !excluded.has(normalizePathname(parsed.pathname));
    } catch {
      return true;
    }
  });
}

async function main() {
  await fs.mkdir(CONTENT_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const urls = filterExcludedUrls(
    await addEnglishVariants(addExtraUrls(await loadSitemapUrls()))
  );
  const limitedUrls = MAX_PAGES > 0 ? urls.slice(0, MAX_PAGES) : urls;
  const routes = [];

  for (const url of limitedUrls) {
    const target = new URL(url);
    const routePath = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
    const cleanedRoute = routePath === "//" ? "/" : routePath;
    const outputDir = cleanedRoute === "/"
      ? CONTENT_DIR
      : path.join(CONTENT_DIR, cleanedRoute.replace(/^\//, ""));

    console.log(`Scraping ${url}`);
    const data = await scrapePage(url);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "index.json"),
      JSON.stringify({ route: cleanedRoute, ...data }, null, 2)
    );

    routes.push(cleanedRoute);
  }

  await fs.writeFile(ROUTES_PATH, JSON.stringify(routes, null, 2));
  console.log(`Done. Saved ${routes.length} routes.`);
}

await main();
