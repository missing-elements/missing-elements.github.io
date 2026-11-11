# The bundles

`/h5p/bundles/` is for a chat that runs Node and can fetch a file but reaches no npm registry, as ChatGPT's sandbox can: its download tool takes a file the browsing tool has opened. There the h5p-author skill fetches two files, the build tool and the bundle of the source's content type, unzips the bundle and builds with `node h5p-author.mjs build source.json course.h5p --libraries parts`. The chat then sees every problem itself, fixes its source and hands over the package; the build page stays for a chat that can fetch nothing. [The skill page](h5p-skill.md) lists the tool and every bundle at its full address.

| Path | What it holds |
| --- | --- |
| `/h5p/bundles/<type>.zip` | One per content type in the pack, `H5P.QuestionSet.zip`: `parts/`, the pack's whole index with the parts a build of that type can read, and `libraries.txt`. Written by `h5p-author bundle --all` |
| `/h5p/bundles/parts/<part>.h5p` | Every part of the pack under its own name, and `parts/index.json`. No bundle holds an addon: a source whose text calls for one, H5P.MathDisplay for math, stops the build, which names the part to fetch from here |
| `/h5p/bundles/h5p-author.mjs` | The author package's command line as one file, everything it imports bundled in, so it runs with nothing installed. It needs `--libraries`, and has no `--version`: the npm package's own files are not with it |
| `/h5p/bundles/index.json` | The author package's and the pack's versions, and each bundle's file, size and number of parts |
| `/h5p/bundles/libraries.txt` | The pack's licence list, which asks to travel with its libraries |

[vite.config.ts](../vite.config.ts) writes them at build from the packages the lockfile pins, so a Dependabot update of `@missing-elements/h5p-author` or `@missing-elements/h5p-libraries` moves them, and they live in `_site/` only, not in git: 113 MB with pack 1.1.0, well within GitHub Pages' 1 GB. A question type's bundle is about 1 MB (the median is 1.1 MB), a Question Set's 2.6 MB, and the largest, H5P.KewArCode's, 8.4 MB. embed-my.github.io keeps serving its own `/bundles/` until the next pack release, for copies of the skill installed before the move.
