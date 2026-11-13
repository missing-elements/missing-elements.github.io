# missing-elements.github.io

The site of the [missing-elements](https://github.com/missing-elements) web components, at <https://missing-elements.github.io>: the docs of the PDF viewer, and the pages that make H5P content with an AI chat and the [h5p-author skill](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author).

## What it serves

| Path | What it is | Source |
| --- | --- | --- |
| `/` | The project list, the tools (the build page, which links the skill's page), and a footer of links | [src/index.njk](src/index.njk); the lists are in [src/_data/site.js](src/_data/site.js) |
| `/pdfjs-viewer/` | The docs of `<pdfjs-viewer-element>`, with a live preview | [src/pdfjs-viewer/](src/pdfjs-viewer/) |
| `/h5p/build/` | The build page, for people: what it makes, a sample that plays, and the build of a chat's source into a `.h5p`, in the visitor's browser | [src/h5p/build/](src/h5p/build/) |
| `/h5p/skill/` | The skill's files, and a page that lists each at its full address, for a chat; and the skill as zips to install: `h5p-author.zip` for Claude, `h5p-author-chatgpt.zip` for ChatGPT's Plugins | [src/h5p/skill/](src/h5p/skill/), copied by [eleventy.config.js](eleventy.config.js); the zips written by [vite.config.ts](vite.config.ts) |
| `/h5p/bundles/` | The skill's build tool and a library bundle per content type, for a chat that runs Node but cannot reach npm | written by [vite.config.ts](vite.config.ts) |
| `/h5p/build/types/` | The skill's type files, which the build page copies for the chat | written by [vite.config.ts](vite.config.ts) |

A chat that cannot install the skill is given `/h5p/skill/`, which lists every address. If it can run Node and fetch a file, it builds from the tool and a bundle in `/h5p/bundles/`. If it cannot, it gives the user a link to `/h5p/build/`, which builds in their browser.

## Develop

Needs Node 22.12 or later and pnpm.

```bash
pnpm install
pnpm dev        # Eleventy's server, http://localhost:8080
pnpm build      # type-checks, then Eleventy writes _site/, then Vite writes /h5p/ into it
pnpm preview    # serves _site/ as GitHub Pages does, http://localhost:4173
```

`pnpm dev` shows the pages as Eleventy writes them: the build page's script and its sample are there only after a `pnpm build`.

## How it is built and deployed

- **Eleventy** writes the pages from `src/` into `_site/`. They ship no framework. Their scripts are the theme toggle and the code-block buttons ([src/assets/site.js](src/assets/site.js)), the pdfjs-viewer live preview ([src/pdfjs-viewer/docs.js](src/pdfjs-viewer/docs.js)) and the build page.
- **Vite** then writes `/h5p/` into the same `_site/`: the build page's script, bundled with the H5P player, its runtime and the library pack; the build page's sample; the type files; and the bundles. That is build output: git holds none of it, and the bundles alone are over 100 MB.
- A push to `main` deploys through [pages.yml](.github/workflows/pages.yml). A pull request is built by [build.yml](.github/workflows/build.yml).

## What the site pins

The pages run published releases, pinned exactly in [package.json](package.json), and a release moves what the site serves:

| Package | What it moves |
| --- | --- |
| `@missing-elements/pdfjs-viewer` | The docs' version numbers, and the viewer in the live preview |
| `@missing-elements/h5p-author` | The build the build page runs, its sample, the type files, the skill's files at `/h5p/skill/`, and the tool in `/h5p/bundles/` |
| `@missing-elements/h5p-libraries` | The library pack: the build page's libraries, and the bundles |
| `@missing-elements/h5p-offline-player`, `@missing-elements/h5p-runtime` | The player on the build page, and its runtime |

To move a pin, change its version in `package.json`, run `pnpm install`, then `pnpm build`, and commit the lockfile with it. Dependabot opens the pull requests for the pins as their own, apart from its group for everything else, and takes a new `@missing-elements` release the day it comes out where it holds other packages back for three days: [.github/dependabot.yml](.github/dependabot.yml) and [pnpm-workspace.yaml](pnpm-workspace.yaml) say why.

The rules behind the H5P pages, and what was measured to reach them, are in [design/author.md](https://github.com/missing-elements/h5p-offline-player/blob/main/design/author.md) of h5p-offline-player, where the skill and its packages live.
