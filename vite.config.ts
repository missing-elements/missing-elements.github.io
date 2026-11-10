import { readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeBundles } from '@missing-elements/h5p-author'
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
 * - `/h5p/bundles/`, for a chat that reaches no npm registry (see `bundles()`).
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
 * `/h5p/bundles/`, for a chat that runs Node and can fetch a file but reaches no npm registry, as
 * in ChatGPT's sandbox. The h5p-author skill builds there from two files fetched from here: the
 * command line, and the bundle of the source's content type.
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

export default defineConfig({
  publicDir: false,
  plugins: [emptyOwnFolders(), licenceFiles(), typeFiles(), bundles()],
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
