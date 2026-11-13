import { readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage, writeBundles } from '@missing-elements/h5p-author'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { build, defineConfig, type Plugin } from 'vite'

/*
 * The site's H5P part, `/h5p/`, which Vite builds into `_site/` once Eleventy has written the pages
 * there (`pnpm build`):
 *
 * - `/h5p/build/build-page.js`, the build page's script, which `src/h5p/build/index.njk` loads. The
 *   player, its runtime and the library pack name their files relative to their own modules, and
 *   Vite emits them into `/h5p/assets/` with everything else. The player's Service Worker lands
 *   there too, so its scope is `/h5p/assets/h5p/`: no other page of the site is under it.
 * - `/h5p/build/types/`, the h5p-author skill's type files, which the page copies for the chat
 *   with a source's problems (see `typeFiles()`).
 * - `/h5p/build/sample.h5p` and `sample.json`, the sample the page plays where it is opened with no
 *   source, and its source (see `sample()`).
 * - `/h5p/bundles/`, for a chat that reaches no npm registry (see `bundles()`).
 *
 * `/h5p/skill/`, the h5p-author skill's files and a page of their addresses, is Eleventy's
 * (`eleventy.config.js`, `src/h5p/skill/`). The page lists the bundles too, written before them:
 * it names them from the author package's `contentTypes`, the list `writeBundles` writes from.
 *
 * Moved here from embed-my.github.io's `/build` and `/bundles/` (#7).
 */

/** Where the files a package's licence asks to travel with it are emitted, beside them. */
const ASSETS = 'h5p/assets'
/** Where the skill's type files are emitted, beside the build page that copies them. */
const TYPES = 'h5p/build/types'

/**
 * Vite writes into Eleventy's `_site/`, so it cannot empty its output folder: the folders only it
 * writes are emptied instead, before it writes them again.
 */
function emptyOwnFolders(): Plugin {
  let outDir = ''
  return {
    name: 'missing-elements:empty-own-folders',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async buildStart() {
      for (const folder of [ASSETS, TYPES, 'h5p/bundles']) await rm(join(outDir, folder), { recursive: true, force: true })
    }
  }
}

/**
 * The text files that travel with the code: the runtime's licence and notice, which it asks to go
 * with copies of it (GPL-3.0), and the library pack's licence list, which asks the same of its
 * libraries. Vite emits the scripts, fonts and parts as hashed assets and would leave them behind.
 */
function licenceFiles(): Plugin {
  const runtime = new URL('./node_modules/@missing-elements/h5p-runtime/dist/', import.meta.url)
  const libraries = new URL('./node_modules/@missing-elements/h5p-libraries/', import.meta.url)
  return {
    name: 'missing-elements:licence-files',
    apply: 'build',
    generateBundle() {
      for (const file of ['LICENSE.txt', 'NOTICE.txt']) {
        this.emitFile({ type: 'asset', fileName: `${ASSETS}/runtime-${file}`, source: readFileSync(new URL(file, runtime)) })
      }
      this.emitFile({ type: 'asset', fileName: `${ASSETS}/libraries-LICENSES.txt`, source: readFileSync(new URL('libraries.txt', libraries)) })
    }
  }
}

/**
 * `/h5p/build/types/`, the h5p-author skill's type files, as the pinned author package carries
 * them since 0.7.0: `<Type>.md`, a content type's notes, an example and its fields, and
 * `index.json`, the author's version and the types there is a file for.
 *
 * A chat in a browser has the skill's text and none of its files, so it guesses how a content type
 * is written, and learns one level's names from each round of problems. The build page copies the
 * files of a source's own type, and of the libraries it names, for the chat along with the
 * source's problems (h5p-offline-player#172). They are the release's, so they describe the fields
 * of the build this page runs.
 */
function typeFiles(): Plugin {
  const author = new URL('./node_modules/@missing-elements/h5p-author/', import.meta.url)
  const folder = new URL('references/types/', author)
  return {
    name: 'missing-elements:type-files',
    apply: 'build',
    generateBundle() {
      const names = readdirSync(folder).filter((name) => name.endsWith('.md')).sort()
      if (!names.length) throw new Error(`@missing-elements/h5p-author has no type files in ${fileURLToPath(folder)}`)
      for (const name of names) this.emitFile({ type: 'asset', fileName: `${TYPES}/${name}`, source: readFileSync(new URL(name, folder)) })
      const { version } = JSON.parse(readFileSync(new URL('package.json', author), 'utf8')) as { version: string }
      const listing = { author: version, types: names.map((name) => name.slice(0, -'.md'.length)) }
      this.emitFile({ type: 'asset', fileName: `${TYPES}/index.json`, source: `${JSON.stringify(listing, null, 2)}\n` })
    }
  }
}

/**
 * `/h5p/build/sample.h5p`, the sample the build page plays for a visitor who came with no source,
 * and `/h5p/build/sample.json`, its source, which the page puts in its editor when asked.
 *
 * The source is `src/h5p/build/sample.json`, written as the h5p-author skill has a chat write one.
 * The package is built from it here by the pinned author package, as the command builds it, so it
 * is what the page itself would build from that source, with the editor libraries an H5P site's
 * upload check asks for: a visitor can download it and try it in their own Moodle. A source the
 * pinned build refuses stops the site's build, with its problems.
 *
 * It is built here and not in the visitor's browser because the player reads a package from its
 * address in ranges: of this one's 4.9 MB it takes the ten libraries that play, where a build in
 * the page would fetch every part.
 */
function sample(): Plugin {
  const source = new URL('./src/h5p/build/sample.json', import.meta.url)
  let outDir = ''
  return {
    name: 'missing-elements:sample',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      const folder = join(outDir, 'h5p', 'build')
      const text = await readFile(source, 'utf8')
      // The build never writes over a file, and `_site/` may hold the last build's.
      const output = join(folder, 'sample.h5p')
      await rm(output, { force: true })
      await buildPackage(JSON.parse(text), output)
      await writeFile(join(folder, 'sample.json'), text)
    }
  }
}

/**
 * `/h5p/bundles/`, for a chat that runs Node and can fetch a file but reaches no npm registry. The
 * h5p-author skill builds there from two files fetched from here: the command line, and the
 * bundle of the source's content type. Grok built that way on 2026-11-13, its `npx` having timed
 * out. In ChatGPT's sandbox, which the bundles were first made for, the skill has not been seen
 * to fetch either.
 *
 * - `<type>.zip`, one per content type in the pack (`h5p-author bundle --all`): `parts/`, the
 *   pack's whole index with the parts a build of that type can read, and `libraries.txt`.
 * - `parts/`: every part of the pack under its own name, and its index. A bundle holds no addon,
 *   so a build whose text calls for one stops and names its part, which the chat fetches from here.
 * - `h5p-author.mjs`: the command line as one file, everything it imports bundled in by Vite, so it
 *   runs with nothing installed. It takes `--libraries`: the npm package's pinned pack is not with
 *   it, nor the package.json `--version` reads, so `index.json` says the versions.
 * - `index.json`: the author's and the pack's versions, and each bundle's file, size and parts.
 * - `libraries.txt`: the pack's licence list, which asks to travel with its libraries.
 *
 * Written after the page, from the packages the lockfile pins: `_site/` holds them, git does not.
 */
function bundles(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const author = new URL('./node_modules/@missing-elements/h5p-author/', import.meta.url)
  const libraries = new URL('./node_modules/@missing-elements/h5p-libraries/', import.meta.url)
  const version = async (from: URL) => (JSON.parse(await readFile(new URL('package.json', from), 'utf8')) as { version: string }).version
  let outDir = ''
  return {
    name: 'missing-elements:bundles',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      const folder = join(outDir, 'h5p', 'bundles')
      const written = await writeBundles(folder)
      const parts = join(folder, 'parts')
      await mkdir(parts)
      const index = JSON.parse(await readFile(new URL('parts/index.json', libraries), 'utf8')) as { libraries: Array<{ folder: string }> }
      for (const { folder: part } of index.libraries) await copyFile(new URL(`parts/${part}.h5p`, libraries), join(parts, `${part}.h5p`))
      await copyFile(new URL('parts/index.json', libraries), join(parts, 'index.json'))
      await copyFile(new URL('libraries.txt', libraries), join(folder, 'libraries.txt'))
      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        publicDir: false,
        build: {
          ssr: fileURLToPath(new URL('bin/h5p-author.mjs', author)),
          outDir: folder,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          reportCompressedSize: false,
          rolldownOptions: { output: { entryFileNames: 'h5p-author.mjs', format: 'es', codeSplitting: false } }
        },
        ssr: { noExternal: true, target: 'node' }
      })
      const listing = {
        author: await version(author),
        pack: await version(libraries),
        tool: 'h5p-author.mjs',
        parts: 'parts/',
        licences: 'libraries.txt',
        bundles: written.map(({ output, type, parts, size }) => {
          const [machineName, typeVersion] = type.split(' ')
          return { type: machineName, version: typeVersion, file: basename(output), size, parts: parts.length }
        })
      }
      await writeFile(join(folder, 'index.json'), `${JSON.stringify(listing, null, 2)}\n`)
    }
  }
}

/** One date for every entry, as `h5p-author bundle` writes its zips: the same pin writes the same bytes. */
const ZIP_DATE = new Date(2000, 0, 1, 2)

/**
 * The h5p-author skill as zips to install, beside the files `/h5p/skill/` serves, from the same
 * pinned author package:
 *
 * - `h5p-author.zip`: the skill's folder at the zip's root, `h5p-author/SKILL.md`, which Claude's
 *   app takes under Customize, Skills, and Grok's under Skills, Import (as does Open WebUI's
 *   import).
 * - `h5p-author-chatgpt.zip`: the same files as a plugin, under `skills/h5p-author/`, with its
 *   `plugin.json` at the root, which ChatGPT's Plugins take. A zip with the folder at its root is
 *   refused there ("Plugin archive must contain … `skills/*\/SKILL.md`"). The manifest is the Agent
 *   Plugins one, which allows no field but its own ten, with ChatGPT's name for the plugin under
 *   `extensions`; a name that leads with "H5P" says who made it.
 *
 * Both were uploaded as they are written here, by the owner on 2026-11-13, the first into Claude
 * and into Grok. ChatGPT's code cannot read a plugin's files, so neither carries the build tool:
 * where a chat's code cannot reach it, the build page builds.
 */
function skillZips(): Plugin {
  const author = new URL('./node_modules/@missing-elements/h5p-author/', import.meta.url)
  const guide = 'https://missing-elements.github.io/h5p/create-with-ai/'
  let outDir = ''
  return {
    name: 'missing-elements:skill-zips',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      const { version } = JSON.parse(await readFile(new URL('package.json', author), 'utf8')) as { version: string }
      // The files eleventy.config.js copies to /h5p/skill/: SKILL.md, the licence and references/.
      const references = readdirSync(new URL('references/', author), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(fileURLToPath(author).length).split('\\').join('/'))
      const files = ['SKILL.md', 'LICENSE', ...references].sort()
      const skill = await Promise.all(files.map(async (path) => [path, await readFile(new URL(path, author))] as const))
      const manifest = {
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        name: 'h5p-author',
        version,
        description: 'Create H5P content from a prompt, a lesson or supplied material, as a playable .h5p: quizzes, flash cards, presentations, interactive books and more.',
        author: { name: 'Missing Elements', url: 'https://github.com/missing-elements' },
        homepage: guide,
        repository: 'https://github.com/missing-elements/h5p-offline-player',
        license: 'MIT',
        keywords: ['h5p', 'quiz', 'e-learning', 'authoring'],
        extensions: {
          'com.openai': {
            interface: {
              displayName: 'H5P Author by Missing Elements',
              shortDescription: 'Make a playable H5P activity from a prompt or your material',
              developerName: 'Missing Elements',
              websiteURL: guide
            }
          }
        }
      }
      const folder = join(outDir, 'h5p', 'skill')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'h5p-author.zip'), await zipOf('h5p-author/', skill))
      await writeFile(join(folder, 'h5p-author-chatgpt.zip'), await zipOf('skills/h5p-author/', skill, [['plugin.json', new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)]]))
    }
  }
}

/**
 * A zip of the files under `prefix`, after the files at its root, with an entry for each folder
 * before what is in it, as `git archive` writes one: the shape of the zips first uploaded.
 */
async function zipOf(prefix: string, files: ReadonlyArray<readonly [string, Uint8Array]>, atRoot: ReadonlyArray<readonly [string, Uint8Array]> = []): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, lastModDate: ZIP_DATE, extendedTimestamp: false })
  for (const [path, bytes] of atRoot) await writer.add(path, new Uint8ArrayReader(bytes))
  const folders = new Set<string>()
  for (const [path, bytes] of files) {
    const parts = `${prefix}${path}`.split('/')
    for (let depth = 1; depth < parts.length; depth++) {
      const name = `${parts.slice(0, depth).join('/')}/`
      if (folders.has(name)) continue
      folders.add(name)
      await writer.add(name, undefined, { directory: true })
    }
    await writer.add(`${prefix}${path}`, new Uint8ArrayReader(bytes))
  }
  return writer.close()
}

export default defineConfig({
  publicDir: false,
  // A missing file is a 404, as on GitHub Pages, not the home page: `pnpm preview` answers as the
  // site does, where an SPA's fallback would answer every address with a page.
  appType: 'mpa',
  plugins: [emptyOwnFolders(), licenceFiles(), typeFiles(), sample(), bundles(), skillZips()],
  build: {
    outDir: '_site',
    emptyOutDir: false,
    assetsDir: ASSETS,
    rolldownOptions: {
      input: { 'build-page': 'src/h5p/build/build-page.ts' },
      output: { entryFileNames: 'h5p/build/[name].js' }
    }
  }
})
