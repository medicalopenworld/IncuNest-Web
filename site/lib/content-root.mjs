import fs from "fs";
import path from "path";

export function getContentRoot() {
  const envRoot = process.env.CONTENT_ROOT;
  if (envRoot) {
    return path.resolve(envRoot);
  }

  const candidates = [
    path.resolve(process.cwd(), "migration", "content"),
    path.resolve(process.cwd(), "..", "migration", "content"),
    path.resolve(process.cwd(), "content")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
