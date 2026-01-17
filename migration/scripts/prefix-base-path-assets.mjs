import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const RAW_BASE_PATH = process.env.BASE_PATH || "";
const BASE_PATH = RAW_BASE_PATH && !RAW_BASE_PATH.startsWith("/")
  ? `/${RAW_BASE_PATH}`
  : RAW_BASE_PATH;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(MIGRATION_DIR, "..");
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.join(REPO_ROOT, "site", "public", "remote-assets");

if (!BASE_PATH || BASE_PATH === "/") {
  process.exit(0);
}

const remotePrefix = `${BASE_PATH}/remote-assets/`;
const wpContentPrefix = `${BASE_PATH}/remote-assets/wp-content/`;
const wpIncludesPrefix = `${BASE_PATH}/remote-assets/wp-includes/`;

async function listCssFiles(rootDir) {
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
      } else if (entry.isFile() && entry.name.endsWith(".css")) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

function rewriteCss(text) {
  let updated = text;

  updated = updated.replace(/url\((['"]?)\/remote-assets\//g, `url($1${remotePrefix}`);
  updated = updated.replace(/url\((['"]?)\/wp-content\//g, `url($1${wpContentPrefix}`);
  updated = updated.replace(/url\((['"]?)\/wp-includes\//g, `url($1${wpIncludesPrefix}`);

  updated = updated.replace(/@import\s+(?:url\()?['"]?\/remote-assets\//g, `@import url(${remotePrefix}`);
  updated = updated.replace(/@import\s+(?:url\()?['"]?\/wp-content\//g, `@import url(${wpContentPrefix}`);
  updated = updated.replace(/@import\s+(?:url\()?['"]?\/wp-includes\//g, `@import url(${wpIncludesPrefix}`);

  return updated;
}

async function processCss(filePath) {
  let css;
  try {
    css = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }

  const updated = rewriteCss(css);
  if (updated !== css) {
    await fs.writeFile(filePath, updated);
  }
}

async function main() {
  const cssFiles = await listCssFiles(PUBLIC_DIR);
  for (const filePath of cssFiles) {
    await processCss(filePath);
  }
}

await main();
