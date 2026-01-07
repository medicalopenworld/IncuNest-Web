import Document, { Html, Head, Main, NextScript } from "next/document";

function normalizeAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") {
    return {};
  }
  const normalized = { ...attrs };
  if ("class" in normalized && !("className" in normalized)) {
    normalized.className = normalized.class;
    delete normalized.class;
  }
  if ("hreflang" in normalized && !("hrefLang" in normalized)) {
    normalized.hrefLang = normalized.hreflang;
    delete normalized.hreflang;
  }
  return normalized;
}

function shouldSkipLink(attrs) {
  if (!attrs) {
    return false;
  }

  const href = typeof attrs.href === "string" ? attrs.href.toLowerCase() : "";
  const id = typeof attrs.id === "string" ? attrs.id.toLowerCase() : "";

  if (id.startsWith("elementor-gf-local-")) {
    return true;
  }

  if (href.includes("/elementor/google-fonts/css/")) {
    return true;
  }

  return false;
}

function getPageData(docProps) {
  return (
    docProps?.__NEXT_DATA__?.props?.pageProps?.data ||
    docProps?.__NEXT_DATA__?.props?.pageProps?.data ||
    {}
  );
}

export default class MyDocument extends Document {
  render() {
    const data = getPageData(this.props);
    const links = Array.isArray(data.links) ? data.links : [];
    const styles = Array.isArray(data.styles) ? data.styles : [];
    const scripts = Array.isArray(data.scripts) ? data.scripts : [];
    const htmlAttrs = normalizeAttrs(data.htmlAttrs);
    const bodyAttrs = normalizeAttrs(data.bodyAttrs);
    const filteredLinks = links.filter((attrs) => !shouldSkipLink(attrs));

    return (
      <Html {...htmlAttrs}>
        <Head>
          {filteredLinks.map((attrs, index) => (
            <link key={`link-${index}`} {...normalizeAttrs(attrs)} />
          ))}
          {styles.map((css, index) => (
            <style
              key={`style-${index}`}
              dangerouslySetInnerHTML={{ __html: css }}
            />
          ))}
          {scripts.map((script, index) => {
            const { inline, ...attrs } = script;
            const normalized = normalizeAttrs(attrs);
            if (inline) {
              return (
                <script
                  key={`script-${index}`}
                  {...normalized}
                  dangerouslySetInnerHTML={{ __html: inline }}
                />
              );
            }

            return <script key={`script-${index}`} {...normalized} />;
          })}
        </Head>
        <body {...bodyAttrs}>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
