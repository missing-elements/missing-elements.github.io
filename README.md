# missing-elements.github.io

The site of the [missing-elements](https://github.com/missing-elements) web components, at <https://missing-elements.github.io>: the docs of the PDF viewer, and the pages that make H5P content with an AI chat and the [h5p-author skill](https://github.com/missing-elements/h5p-toolkit/tree/main/skills/h5p-author).

## What it serves

| Path | What it is | Source |
| --- | --- | --- |
| `/` | The project list, the tools (the build page first, with its how-to), and a footer of links | [src/index.njk](src/index.njk); the lists are in [src/_data/site.js](src/_data/site.js) |
| `/pdfjs-viewer/` | The docs of `<pdfjs-viewer-element>`, with a live preview | [src/pdfjs-viewer/](src/pdfjs-viewer/) |
| `/h5p/build/` | The build page, for people: what it makes, a sample that plays, and the build of a chat's source into a `.h5p`, in the visitor's browser | [src/h5p/build/](src/h5p/build/) |
| `/h5p/play/` | The play page, for a chat app to show in its reply (h5p-toolkit#210); no page links to it. It builds the activity in a link's `#source=` in the visitor's browser, as the build page does, and plays it with nothing beside it but its download and a link to the build page. A file of the visitor's own that the source names is chosen there or given by the page that frames it. A video or a recording can be given as its address: it plays from there at once and is fetched whole only for the download. A framing page that saves files itself is handed the download. A package bigger than that page saves stays behind the Download link, and the page says how to save it from such a frame. A framing page that opens links itself is handed the link to the build page. A link to the page may also carry the files' addresses and a wish to save (`&links=`, `&save=1`): the page then fetches them itself and tries to save the package with no press, saying to press Download where the browser saved nothing. That is how a framing page that opens links gets a package saved that it cannot save itself. | [src/h5p/play/](src/h5p/play/) |
| `/h5p/create-with-ai/` | The how-to, for people: installing the skill, asking a chat, the prompts to start from, the types, and what to do when something goes wrong | [src/h5p/create-with-ai/](src/h5p/create-with-ai/) |
| `/h5p/skill/` | The skill as zips to install: `h5p-author.zip`, installed once in a chat's place for skills, or attached to the message in each new chat where it has none, and `h5p-author-chatgpt.zip`, the same skill laid out as a plugin; and a page that lists them and the bundles' addresses, each in full, which no page links to | [src/h5p/skill/](src/h5p/skill/); the zips written by [vite.config.ts](vite.config.ts) |
| `/h5p/bundles/` | The skill's build tool and a library bundle per content type, for a chat that runs Node but cannot reach npm; and `h5p-author-build.tar.gz`, the tool and every library in one archive, for a person to attach to a chat whose code can download nothing | written by [vite.config.ts](vite.config.ts) |
| `/h5p/build/types/` | The skill's type files, which the build page copies for the chat | written by [vite.config.ts](vite.config.ts) |

The pages go by what a chat has, not by its name (the owner, 2026-11-20): what one chat does changes within weeks, so no page says what a product does or lacks, and the chats in their titles are examples. What was seen is kept here and in the pages' comments, with its date.

A chat with a place for skills or plugins installs the skill from a zip, once (Claude's Skills and ChatGPT's Plugins, 2026-11-13). A chat with neither reads it from the zip attached to the message, in each new chat (Grok, 2026-11-15). An agent with a terminal takes it with `npx skills add`. `/h5p/create-with-ai/` says each. Where the skill cannot reach npm, it builds from the tool and a bundle in `/h5p/bundles/`, at the addresses `/h5p/skill/` lists, if it can run Node and fetch a file: Grok did, on 2026-11-13. Where its code runs Node but can fetch nothing (ChatGPT's, 2026-11-13), it builds from `h5p-author-build.tar.gz` once the person attaches it or keeps it in a project of the chat's (a ChatGPT Project on the owner's free account, 2026-11-14), and otherwise hands them the source for `/h5p/build/`, which builds in their browser. The tool is a Node.js program, so a chat whose code runs no Node, as most chat apps for local models, hands over the source; an agent with a terminal and a local model builds offline from the archive.

Until 2026-11-13 the site's prompts sent a chat to read the skill at `/h5p/skill/` instead. That worked only in chats that now take the zip, so the prompts name the installed skill, and no page links to `/h5p/skill/`. Its page stays, for the skill's route 3 and the copies already installed, which take the bundles' addresses from it. The skill's text files were served there one by one too until h5p-author 0.10.0: the zips carry them, so the site serves them only as zips. A copy of 0.9.7 or older, in a chat that has its text alone, and a prompt copied before 2026-11-13 find no files there now.

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
- **Vite** then writes `/h5p/` into the same `_site/`: the build page's and the play page's scripts, bundled with the H5P player, its runtime and the library pack; the build page's sample; the type files; and the bundles. That is build output: git holds none of it, and the bundles alone are over 100 MB.
- A push to `main` deploys through [pages.yml](.github/workflows/pages.yml). A pull request is built by [build.yml](.github/workflows/build.yml).

## What the site pins

The pages run published releases, pinned exactly in [package.json](package.json), and a release moves what the site serves:

| Package | What it moves |
| --- | --- |
| `@missing-elements/pdfjs-viewer` | The docs' version numbers, and the viewer in the live preview |
| `@missing-elements/h5p-author` | The build the build page runs, its sample, the type files, the skill's zips at `/h5p/skill/`, and the tool in `/h5p/bundles/` |
| `@missing-elements/h5p-libraries` | The library pack: the build page's libraries, and the bundles |
| `@missing-elements/h5p-offline-player`, `@missing-elements/h5p-runtime` | The player on the build page, and its runtime |

To move a pin, change its version in `package.json`, run `pnpm install`, then `pnpm build`, and commit the lockfile with it. Dependabot opens the pull requests for the pins as their own, apart from its group for everything else, and takes a new `@missing-elements` release the day it comes out where it holds other packages back for three days: [.github/dependabot.yml](.github/dependabot.yml) and [pnpm-workspace.yaml](pnpm-workspace.yaml) say why.

The rules behind the H5P pages, and what was measured to reach them, are in [design/author.md](https://github.com/missing-elements/h5p-toolkit/blob/main/design/author.md) of h5p-toolkit, where the skill and its packages live.
