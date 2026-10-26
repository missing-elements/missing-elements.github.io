# missing-elements.github.io

Docs for the [missing-elements](https://github.com/missing-elements) web components, published at <https://missing-elements.github.io>.

| Path | Source |
| --- | --- |
| `/` | [src/index.njk](src/index.njk), project list in [src/_data/site.js](src/_data/site.js) |
| `/pdfjs-viewer/` | [src/pdfjs-viewer/index.md](src/pdfjs-viewer/index.md) |

Built with [Eleventy](https://www.11ty.dev/). The pages ship no framework: the only client-side JavaScript is the theme toggle, code-block buttons and the live preview.

## Develop

```bash
pnpm install
pnpm dev     # http://localhost:8080
pnpm build   # writes _site/
```

Pushes to `main` deploy through [.github/workflows/pages.yml](.github/workflows/pages.yml). Pull requests get a build check from [.github/workflows/build.yml](.github/workflows/build.yml).

## Editing the pdfjs-viewer docs

- **Prose:** [src/pdfjs-viewer/index.md](src/pdfjs-viewer/index.md). Headings `##` and `###` make up the table of contents.
- **Attribute tables and playground controls:** [src/_data/pdfjsAttributes.js](src/_data/pdfjsAttributes.js).
- **Version numbers:** read at build time from the installed `@missing-elements/pdfjs-viewer`. The docs serve that package's `dist/` as the live preview, so bumping the dependency updates both.

### Try buttons

Add `try` after the language of a code fence to give it a **▶ Try** button that applies the snippet to the preview:

````md
```html try
<pdfjs-viewer-element src="/file.pdf" zoom="page-width"></pdfjs-viewer-element>
```
````

- **HTML snippets** copy the attributes of their `<pdfjs-viewer-element>` onto the preview. `style`, `id`, `class` and the placeholder `src="/file.pdf"` are skipped.
- **JavaScript snippets** run exactly as written. `document.querySelector('pdfjs-viewer-element')` returns the preview element.
- Every Try button comes with a **Reset** button that puts the preview back to its defaults.
- **`try=fresh`** replaces the preview with a new element first. Use it for settings that only apply when the viewer is built, such as `setViewerOptions` and the "before connect" attributes.
