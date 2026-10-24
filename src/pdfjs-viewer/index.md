---
layout: pdfjs-viewer.njk
title: pdfjs-viewer · PDF viewer web component
description: Docs for @missing-elements/pdfjs-viewer, a self-hostable PDF viewer web component based on the PDF.js default viewer. Install, attributes, API, theming, hosting and framework guides.
---

The full PDF.js viewer as one HTML element. It runs in an isolated iframe and has no runtime dependencies. PDF.js and its worker ship inside the package, so nothing loads from a CDN unless you choose to. Each **Try** button applies its example to the live preview, and **Reset** puts the preview back to its defaults.

## Quick start

Install the package and import it once. Importing registers `<pdfjs-viewer-element>`.

```bash
npm install @missing-elements/pdfjs-viewer
```

```js
import '@missing-elements/pdfjs-viewer'
```

Or skip the build step and load it from a CDN:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@missing-elements/pdfjs-viewer@{{ pdfjsViewer.major }}/dist/pdfjs-viewer-element.js"></script>
```

Then add the element. It's a block element with no intrinsic height, so give it one.

```html
<pdfjs-viewer-element
  src="https://missing-elements.github.io/pdfjs-viewer/samples/sample-pdf-file.pdf"
  style="height: 100dvh">
</pdfjs-viewer-element>
```

## Attributes

Configure the viewer with attributes. Most of them apply as soon as they change, so you can drive the viewer from your own UI by setting them:

```js try
const viewer = document.querySelector('pdfjs-viewer-element')
viewer.setAttribute('page', '2')
viewer.setAttribute('zoom', 'page-fit')
```

The **Updates** column in the tables below says when a change takes effect:

- **Live**: immediately. Changing `src` opens the new file without rebuilding the viewer. `page`, `zoom`, `pagemode`, `search` and `phrase` are applied together, so changing any of them also goes to the page in `page`, or to page 1 when `page` is unset.
- **Next load**: with the next document the viewer opens.
- **Before connect**: read once, when the viewer is built. Set it before you add the element to the page.

### Playground

{% playground %}

### Document and navigation

{% attributeTable "document" %}

```html try
<pdfjs-viewer-element
  src="/file.pdf"
  page="2"
  zoom="page-width"
  pagemode="thumbs">
</pdfjs-viewer-element>
```

### Interface

{% attributeTable "interface" %}

### Runtime files

You rarely need these. See [Hosting](#hosting).

{% attributeTable "files" %}

### PDF.js resources

Data that only some PDFs need. The package doesn't include it, so see [PDF.js resources](#cmaps-fonts-and-other-resources) before you set these.

{% attributeTable "resources" %}

## Methods and properties

### `initPromise`

A promise of `{ viewerApp }`, the viewer's [`PDFViewerApplication`](https://github.com/mozilla/pdf.js/blob/v{{ pdfjsViewer.pdfjsVersion }}/web/app.js). It resolves once the viewer has initialized. Read it after the element is in the document: before that it resolves to `{}`. A rebuild (for example a `locale` change that can't be applied in place) replaces it, so read it again each time you need it.

```js
const viewer = document.querySelector('pdfjs-viewer-element')
const { viewerApp } = await viewer.initPromise

viewerApp.eventBus.on('pagechanging', ({ pageNumber }) => {
  console.log(`Page ${pageNumber} of ${viewerApp.pagesCount}`)
})
```

### `setViewerOptions(options)`

Sets PDF.js [viewer options](https://github.com/mozilla/pdf.js/blob/v{{ pdfjsViewer.pdfjsVersion }}/web/app_options.js), for example to turn on comments and the signature tool:

```js try=fresh
const viewer = document.querySelector('pdfjs-viewer-element')
await viewer.setViewerOptions({
  enableComment: true,
  enableSignatureEditor: true,
})
```

The options are applied while the viewer is being built, so call this right after you add the element. A call made after `initPromise` has resolved has no effect until the viewer rebuilds. Each call replaces the options of the previous one. It resolves to `{ viewerOptions }` once the viewer is ready.

### `injectViewerStyles(css)`

Adds a stylesheet to the viewer's document. The styles survive viewer rebuilds and can't be removed, except by replacing the element. For examples, see [Theming](#theming).

### `iframe`

The internal `<iframe>`, available once the element is connected. Use it when you need the viewer's `contentWindow` or `contentDocument` directly.

```js
const viewer = document.querySelector('pdfjs-viewer-element')
await viewer.initPromise
const viewerDocument = viewer.iframe.contentDocument
```

### TypeScript

Types ship with the package. The tag isn't added to `HTMLElementTagNameMap`, so pass the element type to `querySelector` yourself:

```ts
import '@missing-elements/pdfjs-viewer'
import type { PdfjsViewerElement } from '@missing-elements/pdfjs-viewer'

const viewer = document.querySelector<PdfjsViewerElement>('pdfjs-viewer-element')!
const { viewerApp } = await viewer.initPromise
```

## Theming

### Light and dark

The default Paper & Ink theme follows the system color scheme. To force one scheme, set `viewer-css-theme` to `LIGHT` or `DARK`. On this page, the theme button at the top sets this attribute on the preview too.

```html try
<pdfjs-viewer-element src="/file.pdf" viewer-css-theme="DARK">
</pdfjs-viewer-element>
```

### Your own colors

The viewer is styled with CSS custom properties. To restyle it, override them with `injectViewerStyles`. Paper & Ink sets its palettes on `:root`, and on `:root[data-color-scheme]` when a scheme is forced, so target both selectors. Any variable you don't override keeps the current scheme's value, so pair a custom palette with a fixed `viewer-css-theme`:

```js try
const viewer = document.querySelector('pdfjs-viewer-element')
viewer.setAttribute('viewer-css-theme', 'LIGHT')
viewer.injectViewerStyles(`
  :root, :root[data-color-scheme] {
    --main-color: #3b2bd9;
    --body-bg-color: #eeedfb;
    --toolbar-bg-color: #dcd9f8;
    --toolbar-border-color: #b9b3f0;
    --toolbar-icon-bg-color: #2a1fa3;
    --field-border-color: #8e85e8;
  }
`)
```

The full list of variables is at the top of the theme file, `dist/paper-and-ink.css`. To start from the stock PDF.js look instead, point `theme-css-src` at an empty stylesheet.

### Hide toolbar buttons

Any viewer element can be hidden with CSS. For example, this keeps only the left part of the toolbar:

```js try
const viewer = document.querySelector('pdfjs-viewer-element')
viewer.injectViewerStyles(`
  #toolbarViewerMiddle, #toolbarViewerRight { display: none; }
`)
```

Element ids come from the PDF.js viewer markup and can change when PDF.js updates. Check them after upgrading.

## Localization

The interface is in English unless you set `locale`. The locale file is downloaded from jsDelivr when the viewer starts.

```html try
<pdfjs-viewer-element src="/file.pdf" locale="uk">
</pdfjs-viewer-element>
```

Right-to-left locales such as `ar` and `he` also switch the layout direction.

> **Known issue in v{{ pdfjsViewer.version }}:** codes with a region, such as `pt-BR`, `zh-CN`, `es-ES` and `sv-SE`, don't load and the viewer stays in English. Language-only codes work.

To serve locale files yourself, which is useful under a strict CSP or when you can't rely on third parties, copy them from [mozilla-l10n/firefox-l10n](https://github.com/mozilla-l10n/firefox-l10n) (`<locale>/toolkit/toolkit/pdfviewer/viewer.ftl`) and point `locale-src-template` at them:

```html
<pdfjs-viewer-element
  src="/file.pdf"
  locale="de"
  locale-src-template="/locales/{locale}/viewer.ftl">
</pdfjs-viewer-element>
```

## Hosting

The element loads the viewer at runtime from five files next to `pdfjs-viewer-element.js` in the package's `dist` folder: `viewer.mjs`, `pdf.mjs`, `pdf.worker.min.mjs`, `viewer.css` and `paper-and-ink.css`. All of them must come from the same release as the element.

### Bundlers and `assets-base`

**Vite, Rollup and webpack 5** need no configuration. The element references its files as `new URL('./file', import.meta.url)`, so these bundlers emit them as assets and rewrite the URLs.

**esbuild and other bundlers** that don't understand that pattern move the element into your bundle without the files, and the viewer fails with 404s. Serve the package's `dist` folder as static files and point `assets-base` at it:

```html
<pdfjs-viewer-element src="/file.pdf" assets-base="/static/pdfjs-viewer/">
</pdfjs-viewer-element>
```

The same attribute can load the files from a CDN:

```html
<pdfjs-viewer-element
  src="/file.pdf"
  assets-base="https://cdn.jsdelivr.net/npm/@missing-elements/pdfjs-viewer@{{ pdfjsViewer.version }}/dist/">
</pdfjs-viewer-element>
```

`assets-base` is read when the viewer is built, so set it before the element is connected. A per-file attribute such as `worker-src` overrides it for that file.

### Static pipelines with hashed file names

If your pipeline renames files, for example with content hashes, set each runtime file URL instead of `assets-base`:

```html
<pdfjs-viewer-element
  src="/file.pdf"
  pdfjs-lib-src="/static/pdf.3f2a1c.mjs"
  viewer-src="/static/viewer.9b8e7d.mjs"
  worker-src="/static/pdf.worker.min.5c4d3e.mjs"
  viewer-css-src="/static/viewer.1a2b3c.css"
  theme-css-src="/static/paper-and-ink.4d5e6f.css"
  image-resources-path="/static/pdfjs-images/">
</pdfjs-viewer-element>
```

Annotation icons are loaded by name (`annotation-<name>.svg`), so keep the `dist/images` folder unhashed and point `image-resources-path` at it.

### Worker

By default the worker is the bundled `pdf.worker.min.mjs`, served from your own origin. That works under a strict `script-src 'self'` policy. Set `worker-src` only to serve it from somewhere else, and use the matching PDF.js version ({{ pdfjsViewer.pdfjsVersion }}). A mismatch stops the viewer with an "API version does not match Worker version" error.

```html
<pdfjs-viewer-element
  src="/file.pdf"
  worker-src="https://cdn.jsdelivr.net/npm/pdfjs-dist@{{ pdfjsViewer.pdfjsVersion }}/build/pdf.worker.min.mjs">
</pdfjs-viewer-element>
```

### CMaps, fonts and other resources

Most PDFs render with just the package. Some need extra PDF.js data: CMaps for some CJK text, standard fonts for non-embedded base fonts, WASM decoders for JPEG 2000 and JBIG2 images, and the scripting sandbox for PDFs with JavaScript. The package doesn't include these, and the defaults point at paths that usually don't exist on your site.

If your documents need them, copy the folders from `pdfjs-dist@{{ pdfjsViewer.pdfjsVersion }}` into your static files and point the attributes at them:

```html
<pdfjs-viewer-element
  src="/file.pdf"
  c-map-url="/pdfjs/cmaps/"
  standard-font-data-url="/pdfjs/standard_fonts/"
  wasm-url="/pdfjs/wasm/"
  icc-url="/pdfjs/iccs/"
  sandbox-bundle-src="/pdfjs/build/pdf.sandbox.min.mjs">
</pdfjs-viewer-element>
```

### Cross-origin PDFs

`src` can point to another origin if that server sends CORS headers (`Access-Control-Allow-Origin`). To let large files load progressively in ranges, the server also needs to expose `Accept-Ranges`, `Content-Range`, `Content-Length` and `Content-Encoding` through `Access-Control-Expose-Headers`. For PDFs behind authentication, fetch the file yourself and [open the bytes](#open-a-pdf-from-bytes).

## Frameworks

The element works anywhere HTML does. Three things to remember in every framework:

- Import the package once, on the client. It needs `window`, so in server-rendered apps (Next.js, Nuxt, SvelteKit, Astro) import it in a client-only hook or component.
- Give the element a height.
- Attributes are strings. Call methods (`setViewerOptions`, `injectViewerStyles`) through a ref.

### React

{% raw %}
```jsx
import { useEffect } from 'react'

export function PdfViewer({ src }) {
  useEffect(() => {
    import('@missing-elements/pdfjs-viewer')
  }, [])

  return <pdfjs-viewer-element src={src} style={{ height: '100dvh' }} />
}
```
{% endraw %}

With TypeScript, declare the tag once:

```ts
import type { PdfjsViewerElement } from '@missing-elements/pdfjs-viewer'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pdfjs-viewer-element': React.HTMLAttributes<PdfjsViewerElement> &
        React.RefAttributes<PdfjsViewerElement> &
        Partial<Record<'src' | 'page' | 'zoom' | 'pagemode' | 'search' | 'locale' | 'viewer-css-theme' | 'iframe-title', string>>
    }
  }
}
```

[React example on CodePen](https://codepen.io/redrobot753/pen/xbEwNrO)

### Vue

Tell the Vue compiler the tag is a custom element:

```js
// vite.config.js
import vue from '@vitejs/plugin-vue'

export default {
  plugins: [
    vue({
      template: {
        compilerOptions: { isCustomElement: (tag) => tag === 'pdfjs-viewer-element' },
      },
    }),
  ],
}
```

```html
<script setup>
import '@missing-elements/pdfjs-viewer'
defineProps({ src: String })
</script>

<template>
  <pdfjs-viewer-element :src="src" style="height: 100dvh" />
</template>
```

In Nuxt, register the import in a client-only plugin (`plugins/pdfjs-viewer.client.js`).

[Vue example on CodePen](https://codepen.io/redrobot753/pen/JoRYqwN)

### Svelte

```html
<script>
  import { onMount } from 'svelte'
  let { src } = $props()
  onMount(() => import('@missing-elements/pdfjs-viewer'))
</script>

<pdfjs-viewer-element {src} style="height: 100dvh"></pdfjs-viewer-element>
```

## Recipes

### Open a PDF from bytes

`viewerApp.open({ data })` takes a `Uint8Array`. Use it for files picked with `<input type="file">`, PDFs generated in the browser, or files you fetch with credentials.

```js try
const viewer = document.querySelector('pdfjs-viewer-element')
const { viewerApp } = await viewer.initPromise

const response = await fetch('https://missing-elements.github.io/pdfjs-viewer/samples/sample-pdf-file.pdf')
viewerApp.open({ data: new Uint8Array(await response.arrayBuffer()) })
```

The `src` attribute doesn't change when you open bytes.

### Several viewers on one page

Each element is an independent viewer with its own iframe, settings and locale. Give each one a height and a distinct `iframe-title`.

```html
<pdfjs-viewer-element src="/en.pdf" iframe-title="English contract" style="height: 50dvh">
</pdfjs-viewer-element>
<pdfjs-viewer-element src="/de.pdf" iframe-title="German contract" locale="de" style="height: 50dvh">
</pdfjs-viewer-element>
```

## Accessibility

Name every viewer with `iframe-title`. Screen readers announce it as the name of the embedded viewer, and something like "Annual report 2026" is far more useful than the default "PDF viewer window".

```html
<pdfjs-viewer-element
  src="/reports/annual-report.pdf"
  iframe-title="Annual report 2026"
  style="height: 100dvh">
</pdfjs-viewer-element>
```

- Label the viewer in the surrounding page, for example with a heading.
- Set `locale` to match your app's language.
- If you inject CSS, keep focus indicators visible and contrast sufficient.
- The viewer can't fix an inaccessible PDF. Use tagged documents with a sensible reading order and text alternatives.

More in the [accessibility guide]({{ pdfjsViewer.repo }}/blob/master/ACCESSIBILITY.md).

## Migrating from `pdfjs-viewer-element`

The package used to be published as [`pdfjs-viewer-element`](https://www.npmjs.com/package/pdfjs-viewer-element), which is now deprecated. Only the package name changed. The `<pdfjs-viewer-element>` tag, the file names and the API are the same.

```bash
npm uninstall pdfjs-viewer-element
npm install @missing-elements/pdfjs-viewer
```

Then replace `pdfjs-viewer-element` with `@missing-elements/pdfjs-viewer` in imports and CDN URLs. If you're coming from an older major version:

- **From 3.x:** remove `use-built-in-worker`. The bundled worker is now always the default, and `worker-src` overrides it.
- **From 2.x:** PDF.js is now bundled, so remove `viewer-path` and your copy of the PDF.js prebuild. Replace `initialize()` with [`initPromise`](#initpromise), and `viewer-extra-styles` / `viewer-extra-styles-urls` with [`injectViewerStyles()`](#injectviewerstyles-css). The `nameddest`, `text-layer`, `disable-*` and `verbosity` attributes are gone. Their PDF.js equivalents (`disableRange`, `textLayerMode` and so on) can be set with [`setViewerOptions()`](#setvieweroptions-options).
