import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(MIGRATION_DIR, "..");
const CONTENT_ROOT = process.env.CONTENT_ROOT
  ? path.resolve(process.env.CONTENT_ROOT)
  : path.join(MIGRATION_DIR, "content");
const OVERRIDES_ROOT = process.env.OVERRIDES_ROOT
  ? path.resolve(process.env.OVERRIDES_ROOT)
  : path.join(REPO_ROOT, "site", "content");
const overridesPath = path.join(OVERRIDES_ROOT, "overrides.json");
const force = process.argv.includes("--force");
const writtenFiles = new Set();

function normalizeRoute(route) {
  if (!route) {
    return "/";
  }
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function routeToContentPath(route) {
  const normalized = normalizeRoute(route);
  if (normalized === "/") {
    return path.join(CONTENT_ROOT, "index.json");
  }

  const parts = normalized.replace(/^\//, "").replace(/\/$/, "").split("/");
  return path.join(CONTENT_ROOT, ...parts, "index.json");
}

async function loadOverrides() {
  const raw = await fs.readFile(overridesPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed.overrides || [];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function extractOverride(override) {
  const entries = Object.entries(override.markdown || {});

  for (const [lang, markdownPath] of entries) {
    if (!markdownPath) {
      continue;
    }

    const route = override.routeByLang?.[lang] || override.routes?.[0];
    if (!route) {
      console.warn(`Override ${override.name || "unknown"}: missing route for ${lang}`);
      continue;
    }

    const contentPath = routeToContentPath(route);
    let data;
    try {
      const rawData = await fs.readFile(contentPath, "utf8");
      data = JSON.parse(rawData);
    } catch (error) {
      console.warn(
        `Override ${override.name || "unknown"}: failed to read ${contentPath}: ${error.message}`
      );
      continue;
    }

    const wrapperId = "override-root";
    const $ = load(`<div id=\"${wrapperId}\">${data.bodyHtml || ""}</div>`, {
      decodeEntities: false
    });
    const root = $(`#${wrapperId}`);
    const target = root.find(override.selector).first();

    if (!target.length) {
      console.warn(
        `Override ${override.name || "unknown"}: selector ${override.selector} not found on ${route}`
      );
      continue;
    }

    const innerHtml = target.html() || "";
    const resolvedMarkdownPath = path.isAbsolute(markdownPath)
      ? markdownPath
      : path.join(OVERRIDES_ROOT, markdownPath);

    if (writtenFiles.has(resolvedMarkdownPath)) {
      continue;
    }

    if (!force && (await fileExists(resolvedMarkdownPath))) {
      writtenFiles.add(resolvedMarkdownPath);
      continue;
    }

    await fs.mkdir(path.dirname(resolvedMarkdownPath), { recursive: true });
    await fs.writeFile(resolvedMarkdownPath, innerHtml.trim() + "\n");
    writtenFiles.add(resolvedMarkdownPath);
  }
}

async function main() {
  const overrides = await loadOverrides();
  for (const override of overrides) {
    await extractOverride(override);
  }
}

await main();
