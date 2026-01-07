import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parseHTML } from "linkedom";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(MODULE_DIR, "..");
const RAW_BASE_PATH = process.env.BASE_PATH || "";
const BASE_PATH = RAW_BASE_PATH && !RAW_BASE_PATH.startsWith("/")
  ? `/${RAW_BASE_PATH}`
  : RAW_BASE_PATH;

function getOverridesRoot() {
  if (process.env.OVERRIDES_ROOT) {
    return path.resolve(process.env.OVERRIDES_ROOT);
  }
  return path.join(SITE_DIR, "content");
}

const OVERRIDES_PATH = path.join(getOverridesRoot(), "overrides.json");
const markdownCache = new Map();
const styleCache = new Map();
let overridesCache = null;

function isHtmlOverride(markdown) {
  const trimmed = markdown.trimStart();
  return trimmed.startsWith("<");
}

function normalizeRoute(route) {
  if (!route) {
    return "/";
  }
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function routeLanguage(route) {
  const normalized = normalizeRoute(route);
  return normalized.startsWith("/en/") ? "en" : "es";
}

function isInternalPath(pathname) {
  return pathname.startsWith("/") && !pathname.startsWith("//");
}

function shouldSkipLocalization(pathname) {
  return (
    pathname.startsWith("/remote-assets/") ||
    pathname.startsWith("/wp-content/") ||
    pathname.startsWith("/wp-includes/") ||
    pathname.startsWith("/wp-")
  );
}

function localizePath(pathname, lang) {
  if (!isInternalPath(pathname) || shouldSkipLocalization(pathname)) {
    return pathname;
  }

  const withoutBase = stripBasePath(pathname);

  if (lang === "en") {
    if (withoutBase === "/en" || withoutBase.startsWith("/en/")) {
      return withBasePath(withoutBase === "/en" ? "/en/" : withoutBase);
    }
    if (withoutBase === "/") {
      return withBasePath("/en/");
    }
    return withBasePath(`/en${withoutBase}`);
  }

  if (withoutBase === "/en" || withoutBase.startsWith("/en/")) {
    const stripped = withoutBase.replace(/^\/en(?=\/|$)/, "");
    return withBasePath(stripped || "/");
  }

  return withBasePath(withoutBase);
}

function stripBasePath(pathname) {
  if (!BASE_PATH) {
    return pathname;
  }
  if (pathname === BASE_PATH) {
    return "/";
  }
  if (pathname.startsWith(BASE_PATH + "/")) {
    return pathname.slice(BASE_PATH.length) || "/";
  }
  return pathname;
}

function withBasePath(pathname) {
  if (!BASE_PATH) {
    return pathname;
  }
  if (pathname === "/") {
    return `${BASE_PATH}/`;
  }
  return `${BASE_PATH}${pathname}`;
}

function rewriteLinks(html, { lang, localizeLinks }) {
  if (!html || !localizeLinks) {
    return html;
  }

  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const body = document.body;

  if (localizeLinks) {
    const anchors = body.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      if (anchor.hasAttribute("data-no-localize")) {
        continue;
      }
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) {
        continue;
      }

      let parsed;
      try {
        parsed = new URL(href, "http://local");
      } catch {
        continue;
      }

      const localizedPath = localizePath(parsed.pathname, lang);
      const nextHref = `${localizedPath}${parsed.search}${parsed.hash}`;
      anchor.setAttribute("href", nextHref);
    }
  }

  return body.innerHTML || html;
}

function findClosestTag(element, tagName) {
  let current = element?.parentElement || null;
  const target = tagName.toLowerCase();
  while (current) {
    if (current.tagName?.toLowerCase() === target) {
      return current;
    }
    current = current.parentElement || null;
  }
  return null;
}

function toggleClass(element, className, enabled) {
  if (!element) {
    return;
  }
  if (element.classList?.[enabled ? "add" : "remove"]) {
    element.classList[enabled ? "add" : "remove"](className);
    return;
  }

  const existing = (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  const has = existing.includes(className);
  if (enabled && !has) {
    existing.push(className);
  } else if (!enabled && has) {
    const index = existing.indexOf(className);
    existing.splice(index, 1);
  }
  element.setAttribute("class", existing.join(" "));
}

function updateActiveNav(html, { route }) {
  if (!html) {
    return html;
  }

  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const body = document.body;
  const normalizedRoute = normalizeRoute(route);

  const anchors = body.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    let matches = false;
    if (href && href.startsWith("/")) {
      try {
        const parsed = new URL(href, "http://local");
        matches = normalizeRoute(stripBasePath(parsed.pathname)) === normalizedRoute;
      } catch {
        matches = false;
      }
    }

    toggleClass(anchor, "elementor-item-active", matches);
    if (matches) {
      anchor.setAttribute("aria-current", "page");
    } else {
      anchor.removeAttribute("aria-current");
    }

    const listItem = findClosestTag(anchor, "li");
    toggleClass(listItem, "current-menu-item", matches);
    toggleClass(listItem, "current_page_item", matches);
  }

  return body.innerHTML || html;
}

async function renderMarkdown(markdown) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return String(file);
}

async function renderMarkdownFile(filePath) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(getOverridesRoot(), filePath);

  if (markdownCache.has(resolvedPath)) {
    return markdownCache.get(resolvedPath);
  }

  const markdown = await fs.readFile(resolvedPath, "utf8");
  const html = isHtmlOverride(markdown) ? markdown : await renderMarkdown(markdown);
  markdownCache.set(resolvedPath, html);
  return html;
}

async function loadStyleFile(filePath) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(getOverridesRoot(), filePath);

  if (styleCache.has(resolvedPath)) {
    return styleCache.get(resolvedPath);
  }

  const css = await fs.readFile(resolvedPath, "utf8");
  styleCache.set(resolvedPath, css);
  return css;
}

async function loadOverrides() {
  if (overridesCache) {
    return overridesCache;
  }

  try {
    const raw = await fs.readFile(OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    overridesCache = parsed.overrides || [];
  } catch {
    overridesCache = [];
  }

  return overridesCache;
}

export async function applyOverrides({ route, bodyHtml }) {
  if (!bodyHtml) {
    return { bodyHtml, extraStyles: [] };
  }

  const overrides = await loadOverrides();
  if (!overrides.length) {
    return { bodyHtml, extraStyles: [] };
  }

  const normalizedRoute = normalizeRoute(route || "/");
  const lang = routeLanguage(normalizedRoute);
  const { document } = parseHTML(`<html><body>${bodyHtml}</body></html>`);
  const body = document.body;
  let changed = false;
  const extraStyles = new Set();

  for (const override of overrides) {
    const routes = Array.isArray(override?.routes) ? override.routes : [];
    const appliesToAll = override?.applyToAll === true || routes.includes("*");
    const appliesToRoute = appliesToAll || routes.includes(normalizedRoute);

    if (!override?.selector || !appliesToRoute) {
      continue;
    }

    const markdownPath =
      override?.markdown?.[lang] || override?.markdown?.default || null;
    if (!markdownPath) {
      continue;
    }

    let rendered;
    try {
      rendered = await renderMarkdownFile(markdownPath);
    } catch (error) {
      console.warn(
        `Override ${override.name || "unknown"}: failed to load ${markdownPath}: ${error.message}`
      );
      continue;
    }

    const targets = body.querySelectorAll(override.selector);
    if (!targets.length) {
      console.warn(
        `Override ${override.name || "unknown"}: selector ${override.selector} not found on ${normalizedRoute}`
      );
      continue;
    }

    let updated = rewriteLinks(rendered, {
      lang,
      localizeLinks: override?.localizeLinks === true
    });

    if (override?.highlightActiveLinks) {
      updated = updateActiveNav(updated, { route: normalizedRoute });
    }

    for (const element of targets) {
      element.innerHTML = updated;
    }
    changed = true;

    const styleEntries = Array.isArray(override.styles)
      ? override.styles
      : override.style
        ? [override.style]
        : [];

    for (const stylePath of styleEntries) {
      try {
        const css = await loadStyleFile(stylePath);
        if (css.trim()) {
          extraStyles.add(css);
        }
      } catch (error) {
        console.warn(
          `Override ${override.name || "unknown"}: failed to load style ${stylePath}: ${error.message}`
        );
      }
    }
  }

  return {
    bodyHtml: changed ? body.innerHTML || bodyHtml : bodyHtml,
    extraStyles: [...extraStyles]
  };
}
