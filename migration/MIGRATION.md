# Proceso de migración (WordPress -> snapshot estático)

Este documento describe el flujo para clonar el sitio WordPress y mantener una web estática basada en snapshots.

## 1) Requisitos

- Node.js 18+ (probado con Node 23).
- NPM (incluido con Node).
- Acceso a internet para descargar el sitio y dependencias.

## 2) Estructura del repo

- `site/`: la web nueva en Next.js.
  - `site/pages/[[...slug]].jsx`: renderiza las rutas desde `migration/content/`.
  - `site/content/`: Markdown editable y configuración de overrides.
  - `site/public/remote-assets/`: assets descargados del WordPress.
- `migration/`: herramientas y datos de migración.
  - `migration/scripts/scrape.mjs`: scraper del WordPress.
  - `migration/scripts/extract-overrides.mjs`: genera Markdown desde el HTML.
  - `migration/content/`: JSON por ruta (snapshots generados).

## 3) Flujo de trabajo

### 3.1 Instalar dependencias

```bash
npm install
```

### 3.2 Scrape del sitio WordPress

```bash
npm run scrape
```

Qué hace el scraper:

- Lee el sitemap en `https://incunest.org/sitemap_index.xml` (o el definido en `SCRAPE_SITEMAP_URL`).
- Descarga cada URL y su HTML.
- Copia el `<head>` (title, meta, link, style, script).
- Reescribe links internos y assets para que apunten al nuevo sitio.
- Descarga assets referenciados (css/js/img/font/pdf/etc.) a `site/public/remote-assets/`.
- Guarda un JSON por ruta en `migration/content/<ruta>/index.json`.
- Genera `migration/content/routes.json` con todas las rutas.
- Incluye rutas en inglés por defecto y añade variantes `/en/articulo-*` si existen.

### 3.3 Markdown overrides (módulos y contenido)

Los overrides permiten editar texto sin perder la estructura HTML original:

- `site/content/overrides.json` define la ruta, selector y archivo Markdown.
- Los Markdown admiten HTML. Si el archivo empieza con `<`, se trata como HTML puro.

**Módulos compartidos** (mismo contenido en varias páginas):

- Define un override y un Markdown reutilizable por idioma (por ejemplo, header/footer).
- Los overrides con `applyToAll` se aplican en todas las rutas.

Notas para cabecera/pie:

- `header-shared` y `footer-shared` usan `applyToAll` para aplicarse a todas las rutas.
- `localizeLinks` reescribe enlaces internos para que en `/en/*` lleven el prefijo `/en`.
- `highlightActiveLinks` añade clases de menú activo según la ruta actual.
- Para regenerar el HTML base usa `npm run extract-overrides` (sin `--force` si
  ya hay contenido editado).

**Contenido por página**:

- Guarda los Markdown bajo `site/content/markdown/<lang>/pages/`.
- El nombre del archivo puede seguir el slug de la ruta (por ejemplo `home.md`, `contacto.md`).

Para inicializar los Markdown desde el HTML actual:

```bash
npm run extract-overrides
```

Para regenerar y sobrescribir después de un nuevo scrape:

```bash
npm run extract-overrides -- --force
```

### 3.4 Registro de URLs externas

Para mantener un registro actualizado de enlaces externos (y su origen):

```bash
npm run external-links
```

El reporte se genera en `migration/EXTERNAL_LINKS.md`.

### 3.5 Estilos compartidos para módulos

Algunos módulos de Elementor dependen de CSS generado por página (por ejemplo
`.elementor-19`). Cuando un módulo se reutiliza en otra ruta, ese CSS no aplica
porque el prefijo cambia. Para evitarlo se añade CSS compartido por override.

Si Elementor cambia los IDs después de un nuevo scrape, actualiza el CSS y
valida con `npm run dev` o `npm run build`.

### 3.6 Generar el sitio estático

```bash
npm run build
```

El export estático se genera en `site/out/`.

### 3.7 Base path (opcional)

Si la web se publica bajo un subpath, define `BASE_PATH` antes del scrape y del build:

```bash
BASE_PATH=/mi-subpath npm run scrape
BASE_PATH=/mi-subpath npm run build
```

## 4) Variables de entorno

- `SCRAPE_BASE_URL` (default: `https://incunest.org`)
  - Cambia la URL origen del scrape.
- `SCRAPE_SITEMAP_URL` (default: intenta `/wp-sitemap.xml`, `/sitemap_index.xml`, `/sitemap.xml`)
  - Forza la URL del sitemap cuando no sigue el patrón estándar.
- `SCRAPE_MAX_PAGES` (default: 0)
  - Limita la cantidad de páginas a descargar (0 = sin límite).
- `SCRAPE_EXTRA_PATHS` (default: vacío)
  - Paths extra a incluir aunque no estén en el sitemap.
- `SCRAPE_EXCLUDE_PATHS` (default: vacío)
  - Paths a excluir aunque estén en el sitemap.
- `SCRAPE_EXTRA_URLS` (default: vacío)
  - URLs absolutas extra a incluir en el scrape.
- `SCRAPE_AUTO_EN_VARIANTS` (default: true)
  - Añade automáticamente variantes `/en/articulo-*` si existen.
- `CONTENT_ROOT` (opcional)
  - Forza la ruta base de `migration/content/` para scripts o el sitio.
- `OVERRIDES_ROOT` (opcional)
  - Forza la ruta base de `site/content/` (overrides + Markdown).
- `PUBLIC_DIR` (opcional)
  - Forza la ruta de descarga de assets (por defecto `site/public/remote-assets/`).
- `BASE_PATH` (opcional)
  - Prefijo de rutas para hosting bajo subpath.

## 5) Troubleshooting

- Si `npm run dev` o `npm run build` fallan con SWC, los scripts ya aplican
  `NEXT_IGNORE_INCORRECT_LOCKFILE=1`.
- Si faltan páginas, revisa `migration/content/routes.json` y el sitemap original.
- Si un selector cambia tras el scrape, actualiza `site/content/overrides.json`
  y vuelve a ejecutar `npm run extract-overrides -- --force`.

## 6) Limitaciones conocidas

- Funciones dinámicas de WordPress (comentarios, login, búsqueda interna) no se migran.
- Formularios que dependan del backend WordPress no funcionarán sin reemplazo.
