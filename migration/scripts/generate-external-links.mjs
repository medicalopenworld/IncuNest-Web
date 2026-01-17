import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";

const BASE_URL = process.env.SCRAPE_BASE_URL || "https://incunest.org";
const baseOrigin = new URL(BASE_URL).origin;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(MIGRATION_DIR, "..");
const CONTENT_ROOT = process.env.CONTENT_ROOT
  ? path.resolve(process.env.CONTENT_ROOT)
  : path.join(MIGRATION_DIR, "content");
const OVERRIDES_ROOT = process.env.OVERRIDES_ROOT
  ? path.resolve(process.env.OVERRIDES_ROOT)
  : path.join(REPO_ROOT, "site", "content");
const OUTPUT_PATH = process.env.EXTERNAL_LINKS_PATH
  ? path.resolve(process.env.EXTERNAL_LINKS_PATH)
  : path.join(MIGRATION_DIR, "EXTERNAL_LINKS.md");

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

function isSkippable(raw) {
  const trimmed = raw.trim();
  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:")
  );
}

function resolveUrl(raw) {
  try {
    return new URL(raw, baseOrigin);
  } catch {
    return null;
  }
}

function isExternal(raw) {
  if (isSkippable(raw)) {
    return false;
  }
  const resolved = resolveUrl(raw);
  if (!resolved) {
    return false;
  }
  if (!EXTERNAL_PROTOCOLS.has(resolved.protocol)) {
    return false;
  }
  return resolved.origin !== baseOrigin;
}

function addEntry(map, url, source, context) {
  if (!url || !source) {
    return;
  }
  const key = url.toString();
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  const entry = context ? `${source} (${context})` : source;
  map.get(key).add(entry);
}

function extractFromSrcset(raw) {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/, 2)[0])
    .filter(Boolean);
}

function extractFromHtml(html, source, map) {
  if (!html) {
    return;
  }
  const $ = load(html, { decodeEntities: false });

  $("[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (raw && isExternal(raw)) {
      addEntry(map, resolveUrl(raw), source, `${el.tagName}[href]`);
    }
  });

  $("[src]").each((_, el) => {
    const raw = $(el).attr("src");
    if (raw && isExternal(raw)) {
      addEntry(map, resolveUrl(raw), source, `${el.tagName}[src]`);
    }
  });

  $("[srcset]").each((_, el) => {
    const raw = $(el).attr("srcset");
    if (!raw) {
      return;
    }
    for (const part of extractFromSrcset(raw)) {
      if (isExternal(part)) {
        addEntry(map, resolveUrl(part), source, `${el.tagName}[srcset]`);
      }
    }
  });
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

async function listMarkdownFiles(rootDir) {
  const files = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

async function processSnapshots(map) {
  const routesPath = path.join(CONTENT_ROOT, "routes.json");
  let routes = [];
  try {
    routes = JSON.parse(await fs.readFile(routesPath, "utf8"));
  } catch {
    return;
  }

  for (const route of routes) {
    const normalized = route === "/" ? [] : route.replace(/^\/|\/$/g, "").split("/");
    const dataPath = path.join(CONTENT_ROOT, ...normalized, "index.json");
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath, "utf8"));
    } catch {
      continue;
    }

    const source = data.route || route;
    extractFromHtml(data.bodyHtml || "", source, map);

    const links = Array.isArray(data.links) ? data.links : [];
    for (const attrs of links) {
      if (attrs?.href && isExternal(attrs.href)) {
        addEntry(map, resolveUrl(attrs.href), source, "head link[href]");
      }
    }

    const scripts = Array.isArray(data.scripts) ? data.scripts : [];
    for (const attrs of scripts) {
      if (attrs?.src && isExternal(attrs.src)) {
        addEntry(map, resolveUrl(attrs.src), source, "head script[src]");
      }
    }
  }
}

async function processMarkdown(map) {
  const markdownRoot = path.join(OVERRIDES_ROOT, "markdown");
  const files = await listMarkdownFiles(markdownRoot);

  for (const filePath of files) {
    let markdown;
    try {
      markdown = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const html = markdown.trimStart().startsWith("<")
      ? markdown
      : await renderMarkdown(markdown);
    const source = path.relative(REPO_ROOT, filePath);
    extractFromHtml(html, source, map);
  }
}

function formatMarkdown(map) {
  const rows = [];
  const sortedUrls = [...map.keys()].sort((a, b) => a.localeCompare(b));

  for (const url of sortedUrls) {
    const refs = [...map.get(url)].sort();
    rows.push(`| ${url} | ${refs.join("; ")} |`);
  }

  const now = new Date().toISOString();
  const header = [
    "# External links",
    "",
    `Generated: ${now}`,
    `Base origin: ${baseOrigin}`,
    "",
    `Total URLs: ${sortedUrls.length}`,
    "",
    "## Links",
    "",
    "| URL | References |",
    "| --- | --- |"
  ];

  if (!rows.length) {
    return [
      ...header,
      "| (none) | No external links found. |",
      ""
    ].join("\n");
  }

  return [...header, ...rows, ""].join("\n");
}

async function main() {
  const map = new Map();
  await processSnapshots(map);
  await processMarkdown(map);

  const output = formatMarkdown(map);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, output);
  console.log(`External links written to ${OUTPUT_PATH}`);
}

await main();
