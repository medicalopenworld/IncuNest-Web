import fs from "fs/promises";
import path from "path";
import Head from "next/head";
import { useEffect } from "react";
import { applyOverrides } from "../lib/overrides.mjs";
import { getContentRoot } from "../lib/content-root.mjs";
import { prefixPathsInHtml, prefixLinkAttrs, prefixScriptAttrs } from "../lib/base-path.mjs";

export default function Page({ data }) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const applyAttrs = (element, attrs = {}) => {
      const classValue = attrs.className ?? attrs.class;
      if ("className" in attrs || "class" in attrs) {
        element.className = classValue || "";
      }

      if ("id" in attrs) {
        if (attrs.id) {
          element.id = attrs.id;
        } else {
          element.removeAttribute("id");
        }
      }

      for (const [key, value] of Object.entries(attrs)) {
        if (key === "className" || key === "class" || key === "id") {
          continue;
        }
        if (value === true) {
          element.setAttribute(key, "");
        } else if (value === false || value == null) {
          element.removeAttribute(key);
        } else {
          element.setAttribute(key, String(value));
        }
      }

      return () => {
        for (const key of Object.keys(attrs)) {
          if (key === "className" || key === "class") {
            element.className = "";
            continue;
          }
          element.removeAttribute(key);
        }
      };
    };

    const cleanupBody = data?.bodyAttrs
      ? applyAttrs(document.body, data.bodyAttrs)
      : null;
    const cleanupHtml = data?.htmlAttrs
      ? applyAttrs(document.documentElement, data.htmlAttrs)
      : null;

    return () => {
      cleanupBody?.();
      cleanupHtml?.();
    };
  }, [data?.bodyAttrs, data?.htmlAttrs]);

  if (!data) {
    return null;
  }

  const meta = data.meta || [];

  return (
    <>
      <Head>
        {data.title ? <title>{data.title}</title> : null}
        {meta.map((attrs, index) => (
          <meta key={`meta-${index}`} {...attrs} />
        ))}
      </Head>
      <div
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: data.bodyHtml || "" }}
      />
    </>
  );
}

export async function getStaticPaths() {
  const routesPath = path.join(getContentRoot(), "routes.json");
  const rawRoutes = await fs.readFile(routesPath, "utf8");
  const routes = JSON.parse(rawRoutes);

  const paths = routes.map((route) => {
    const trimmed = route.replace(/^\//, "").replace(/\/$/, "");
    const slug = trimmed ? trimmed.split("/") : [];

    return { params: { slug } };
  });

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const slugParts = params?.slug || [];
  const contentRoot = getContentRoot();
  const dataPath = slugParts.length
    ? path.join(contentRoot, ...slugParts, "index.json")
    : path.join(contentRoot, "index.json");

  const rawData = await fs.readFile(dataPath, "utf8");
  const data = JSON.parse(rawData);
  const route = data.route || (slugParts.length ? `/${slugParts.join("/")}/` : "/");

  const overrideResult = await applyOverrides({ route, bodyHtml: data.bodyHtml });
  if (typeof overrideResult === "string") {
    data.bodyHtml = overrideResult;
  } else {
    data.bodyHtml = overrideResult.bodyHtml;
    if (overrideResult.extraStyles?.length) {
      data.styles = Array.isArray(data.styles)
        ? [...data.styles, ...overrideResult.extraStyles]
        : [...overrideResult.extraStyles];
    }
  }

  // Prefix paths with basePath for GitHub Pages deployment
  data.bodyHtml = prefixPathsInHtml(data.bodyHtml);
  if (Array.isArray(data.links)) {
    data.links = data.links.map(prefixLinkAttrs);
  }
  if (Array.isArray(data.scripts)) {
    data.scripts = data.scripts.map(prefixScriptAttrs);
  }

  return { props: { data } };
}
