# Editing the pdfjs-viewer docs

`/pdfjs-viewer/` is one Markdown page with a live preview of the viewer beside it.

- **Prose:** [src/pdfjs-viewer/index.md](../src/pdfjs-viewer/index.md). Headings `##` and `###` make up the table of contents.
- **Attribute tables and playground controls:** [src/_data/pdfjsAttributes.js](../src/_data/pdfjsAttributes.js).
- **Version numbers:** read at build time from the installed `@missing-elements/pdfjs-viewer`. The docs serve that package's `dist/` as the live preview, so bumping the dependency updates both.

## Try buttons

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
