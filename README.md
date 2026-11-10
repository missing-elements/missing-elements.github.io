# missing-elements.github.io

Docs and tools for the [missing-elements](https://github.com/missing-elements) web components, published at <https://missing-elements.github.io>.

| Path | Source |
| --- | --- |
| `/` | [src/index.njk](src/index.njk), project list in [src/_data/site.js](src/_data/site.js) |
| `/pdfjs-viewer/` | [src/pdfjs-viewer/index.md](src/pdfjs-viewer/index.md) |
| `/h5p/build/` | The H5P build page, [src/h5p/build/](src/h5p/build/): see [The H5P build page](#the-h5p-build-page) |
| `/h5p/bundles/` | The build tool and a library bundle per content type, written by [vite.config.ts](vite.config.ts): see [The bundles](#the-bundles) |

Built with [Eleventy](https://www.11ty.dev/). The pages ship no framework: the only client-side JavaScript is the theme toggle, code-block buttons, the live preview and the build page, which [Vite](https://vite.dev/) bundles with the H5P player.

## Develop

Needs Node 22.12 or later.

```bash
pnpm install
pnpm dev       # http://localhost:8080
pnpm build     # type-checks, then writes _site/: the pages with Eleventy, then /h5p/ with Vite
pnpm preview   # serves _site/ as GitHub Pages does, http://localhost:4173
pnpm e2e       # the build page and the bundles in a browser, against _site/: build first, and once
               # per machine: pnpm exec playwright install chromium
```

`pnpm dev` serves the pages as Eleventy writes them; the build page's script is there only after a `pnpm build`.

Pushes to `main` deploy through [.github/workflows/pages.yml](.github/workflows/pages.yml). Pull requests get a build check from [.github/workflows/build.yml](.github/workflows/build.yml), which runs the browser tests too.

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

## The H5P build page

`/h5p/build/` is for an AI chat that wrote a source with the [h5p-author skill](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author) but cannot build it. ChatGPT's sandbox reaches npm only through OpenAI's own mirror, which was reported refusing every install from July 2026, so `npx @missing-elements/h5p-author` does not run there, and the skill hands over the source and this page's address instead. The page builds with `@missing-elements/h5p-author/browser`, the same build as the command's, and lists every problem at once by its path, ready to copy back into the chat. Its libraries are `@missing-elements/h5p-libraries/install`'s pack, one part per library, so a build fetches only the parts its package needs and carries the editor libraries an H5P site's upload check asks for. The package then plays in the player on the page, and downloads from it.

Nothing leaves the browser. A link can carry the source in its fragment, which no server sees: `/h5p/build/#source=<base64url>`, the bytes being the source's JSON as UTF-8, or that JSON compressed with raw deflate (Node's `zlib.deflateRawSync`, Python's `zlib.compressobj(wbits=-15)`) to keep the link short. A linked source is built at once, unless it names files of its own, which only the person can choose. A source that names a picture by web address gets it only where that host allows CORS.

| File | What it holds |
| --- | --- |
| `src/h5p/build/index.njk` | The page's markup, in the site's layout, and its Content-Security-Policy: GitHub Pages sends no headers, so a `<meta>` tag is the only policy it gets |
| `src/h5p/build/build-page.ts` | The page's wiring: the build, the player, the download, a link's source |
| `src/h5p/build/build-source.ts` | What it does with a source with no DOM: the link's fragment, the files a source names, the text for the chat |
| `src/assets/site.css` | Its styles, under *H5P build page* |
| `vite.config.ts` | The page's script, `/h5p/build/build-page.js`, with the player, its runtime, the pack and their licence files in `/h5p/assets/` |
| `e2e/`, `playwright.config.ts` | The browser tests: a pasted source, one from a link and one with a file of its own build, play and download; a source's problems are listed for the chat; `/h5p/bundles/` serves every bundle and part, and its tool and a bundle build a quiz in an empty folder |

The player's Service Worker is in `/h5p/assets/` too, so its scope is `/h5p/assets/h5p/`: no other page of the site is under it. The address names who runs the page, as H5P Group's trademark policy asks of a name with "H5P" in it, and the page uses the word descriptively.

The page and the bundles were embed-my.github.io's `/build` and `/bundles/` until 2026-11-10. `/build` there now redirects here with its fragment, so the links chats wrote before still build.

## The bundles

`/h5p/bundles/` is for a chat that runs Node and can fetch a file but reaches no npm registry, as ChatGPT's sandbox can: its download tool takes a file the browsing tool has opened. There the h5p-author skill fetches two files, the build tool and the bundle of the source's content type, unzips the bundle and builds with `node h5p-author.mjs build source.json course.h5p --libraries parts`. The chat then sees every problem itself, fixes its source and hands over the package; the build page stays for a chat that can fetch nothing.

| Path | What it holds |
| --- | --- |
| `/h5p/bundles/<type>.zip` | One per content type in the pack, `H5P.QuestionSet.zip`: `parts/`, the pack's whole index with the parts a build of that type can read, and `libraries.txt`. Written by `h5p-author bundle --all` |
| `/h5p/bundles/parts/<part>.h5p` | Every part of the pack under its own name, and `parts/index.json`. No bundle holds an addon: a source whose text calls for one, H5P.MathDisplay for math, stops the build, which names the part to fetch from here |
| `/h5p/bundles/h5p-author.mjs` | The author package's command line as one file, everything it imports bundled in, so it runs with nothing installed. It needs `--libraries`, and has no `--version`: the npm package's own files are not with it |
| `/h5p/bundles/index.json` | The author package's and the pack's versions, and each bundle's file, size and number of parts |
| `/h5p/bundles/libraries.txt` | The pack's licence list, which asks to travel with its libraries |

`vite.config.ts` writes them at build from the packages the lockfile pins, so a Dependabot update of `@missing-elements/h5p-author` or `@missing-elements/h5p-libraries` moves them, and they live in `_site/` only, not in git: 113 MB with pack 1.1.0, well within GitHub Pages' 1 GB. A question type's bundle is about 1 MB, a Question Set's 2.6 MB, a container's up to 8.4 MB. embed-my.github.io keeps serving its own `/bundles/` until the next pack release, for copies of the skill installed before the move.
