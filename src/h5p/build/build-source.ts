/**
 * What the build page does with a source before and after `@missing-elements/h5p-author` sees it,
 * with no DOM: the source a link carries, the files a source names, the content types it is
 * written in, and the text a chat is given back.
 */

import { sourceType } from '@missing-elements/h5p-author/browser'
import { jsonProblem, unfence } from './json-scan'

/**
 * A problem or a note, as the author package reports them: where in the source, and what. A
 * problem with the text itself, which is not JSON, has no path in the source, and says where in
 * the text it is: `at`, an offset.
 */
export interface Problem {
  path: string
  message: string
  at?: number
}

/** A content type's file of the h5p-author skill: its notes, an example and its fields. */
export interface TypeFile {
  type: string
  text: string
}

/**
 * The source a link carries in its fragment, `#source=`, which the browser never sends to a
 * server, in either of two forms:
 *
 * - `#source=<base64url>`: the source's JSON, as UTF-8, or that JSON compressed with raw deflate,
 *   which a chat's sandbox writes with Node's `zlib.deflateRawSync` or Python's
 *   `zlib.compressobj(wbits=-15)` to keep the link short.
 * - `#source={…}`: the JSON itself, which a chat with no code tool writes into the link, since a
 *   model can write its own JSON but cannot compress it (h5p-toolkit#206). The value runs to
 *   the end of the fragment, since JSON text holds `&` and `+`, and it is percent-decoded as far as
 *   it can be (`percentDecoded`). Base64url never holds `{` or `%`, so the forms cannot be mistaken.
 *   Up to three braces or brackets left open at its end are closed (`withClosers`). Its text is
 *   returned even where it is still not JSON: a weak model's JSON slips, and text that can
 *   be read goes in the box, where the build lists where the JSON breaks, for the chat to fix, as
 *   for a source pasted in. Only a compressed source that cannot be read is a damaged link.
 *
 * Returns `null` for a fragment that carries none, and throws for one that carries something else.
 */
export async function sourceFromFragment(hash: string): Promise<string | null> {
  const fragment = hash.replace(/^#/, '')
  const readable = /(?:^|&)source=(?=\{|%7B)/i.exec(fragment)
  if (readable) {
    const text = percentDecoded(fragment.slice(readable.index + readable[0].length))
    if (isJson(text)) return text
    // A link set in a sentence may end in what follows it, as `}.`: the JSON is up to its last brace.
    const upToBrace = text.slice(0, text.lastIndexOf('}') + 1)
    if (isJson(upToBrace)) return upToBrace
    const closed = withClosers(text)
    return closed !== null && isJson(closed) ? closed : text
  }
  const value = new URLSearchParams(fragment).get('source')
  if (!value) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    // URLSearchParams reads a "+" as a space: in base64 that space was a "+" (#130).
    const base64 = value.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
    bytes = Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0))
  } catch {
    throw new Error('The link’s #source= is not base64url')
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (isJson(text)) return text
  try {
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const inflatedText = await new Response(inflated).text()
    if (isJson(inflatedText)) return inflatedText
  } catch {
    // Not deflate either; said below.
  }
  throw new Error('The link’s #source= is neither JSON nor deflated JSON in base64url')
}

/**
 * The JSON with the braces and brackets still open at its end closed, up to three of them, or
 * `null` where it ends inside a string or has more open. A model that writes a source on one line
 * loses count of its closers: Haiku left one `}` out of a True/False's 600 characters
 * (h5p-toolkit#206). What is closed at the end is only where the source ends, and the
 * build still checks every field of it.
 */
function withClosers(text: string): string | null {
  const open: string[] = []
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{') open.push('}')
    else if (char === '[') open.push(']')
    else if (char === '}' || char === ']') {
      if (open.pop() !== char) return null
    }
  }
  if (inString || !open.length || open.length > 3) return null
  return text.trimEnd() + open.reverse().join('')
}

/**
 * Percent-decodes JSON a model wrote into a link, as far as it can: each run of escapes is decoded
 * where it is UTF-8 and kept as written where it is not, and a `%` that starts no escape is a `%`.
 * The browser escapes some characters itself as it opens the link (a space, `"`, `<`, `>`, and any
 * letter outside ASCII), and the model escapes the few a Markdown link cannot hold.
 */
function percentDecoded(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run
    }
  })
}

function isJson(text: string): boolean {
  if (!/^\s*\{/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** A text as base64url, and back; `null` for what is not one. */
const toBase64Url = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (value: string): string | null => {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    return new TextDecoder().decode(Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
}

/**
 * What a play link may carry beside its source, for a tab that saves the package with no press:
 * `&links=`, the addresses of the person's files by name, as JSON in base64url, and `&save=1`.
 * `rest` is the fragment without them, which is what stays in the address bar: an address of a
 * person's file is not left in the history. A source written as readable JSON takes the whole
 * fragment, so such a link carries neither.
 */
export function linksFromFragment(hash: string): { links: Record<string, unknown>, save: boolean, rest: string } {
  const fragment = hash.replace(/^#/, '')
  const none = { links: {}, save: false, rest: hash }
  if (/(?:^|&)source=(?=\{|%7B)/i.test(fragment)) return none
  const params = new URLSearchParams(fragment)
  if (!params.has('links') && !params.has('save')) return none
  let links: Record<string, unknown> = {}
  try {
    const given: unknown = JSON.parse(fromBase64Url(params.get('links') ?? '') ?? '')
    if (given && typeof given === 'object' && !Array.isArray(given)) links = given as Record<string, unknown>
  } catch {
    // Not addresses: none.
  }
  const rest = fragment.split('&').filter((part) => !/^(links|save)(=|$)/.test(part)).join('&')
  return { links, save: params.get('save') === '1', rest: rest ? `#${rest}` : '' }
}

/**
 * A fragment from `fragmentFromSource` with addresses beside it, and the wish to save unless `save`
 * is false, as `linksFromFragment` reads them.
 */
export const fragmentWithLinks = (fragment: string, links: Record<string, string>, save = true): string => `${fragment}&links=${toBase64Url(JSON.stringify(links))}${save ? '&save=1' : ''}`

/** Whether a fragment has a `source=` at all, whatever it carries: a link of this page's kind. */
export const linksSource = (hash: string): boolean => new URLSearchParams(hash.replace(/^#/, '')).has('source')

/**
 * The source as a link carries it, with its layout taken out: the JSON of an object, out of the code
 * fence a chat may have put it in, on one line; `''` for no text. `null` for text a link cannot
 * carry, which is not JSON or not an object. Two texts that are one source have one of these, so it
 * tells a change of the source from a change of its layout.
 */
export function compactSource(text: string): string | null {
  if (!text.trim()) return ''
  const json = unfence(text).text
  return isJson(json) ? JSON.stringify(JSON.parse(json)) : null
}

/**
 * The fragment that carries a source, the other way from `sourceFromFragment`: `#source=` and the
 * source's JSON, as UTF-8 or compressed with raw deflate, whichever is shorter, and the JSON as it
 * is where the browser has no `CompressionStream`. Takes what `compactSource` gives; no source is a
 * `#source=` with nothing after it, which `sourceFromFragment` reads as none.
 */
export async function fragmentFromSource(compact: string): Promise<string> {
  let bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(compact)
  if (bytes.length) {
    try {
      const deflated = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const smaller = new Uint8Array(await new Response(deflated).arrayBuffer())
      if (smaller.length < bytes.length) bytes = smaller
    } catch {
      // Nothing here compresses: the JSON as it is.
    }
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `#source=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/**
 * Reads the text as a source, or says where it is not JSON, as a problem the chat can fix.
 */
export function parseSource(text: string): { source: unknown } | { problem: Problem } {
  if (!text.trim()) return { problem: { path: 'source', message: 'is empty: paste the JSON the chat wrote' } }
  const problem = jsonProblem(text)
  if (problem) return { problem: { path: 'source', message: `is not valid JSON ${problem.message}`, at: problem.at } }
  // A chat often hands the source inside a Markdown code fence; take what is inside it.
  return { source: JSON.parse(unfence(text).text) }
}

/** Whether a file's `path` is a web address, which the build fetches itself, rather than a file to choose. */
const isAddress = (path: string): boolean => /^(?:https?|data):/i.test(path.trim())

/**
 * The files a source names by name rather than by web address: every `{ "path": … }` in it, in
 * the order they come. The author package looks each one up by the path as written.
 */
export function namedFiles(source: unknown): string[] {
  const found = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      const path = (value as { path?: unknown }).path
      if (typeof path === 'string' && path.trim() && !isAddress(path)) found.add(path)
      Object.values(value).forEach(walk)
    }
  }
  walk(source)
  return [...found]
}

/** A path's last part, which is what a file chosen from a computer is called. */
export const baseName = (path: string): string => path.slice(path.replace(/\\/g, '/').lastIndexOf('/') + 1)

/** A file's kind, by the ending of its name. */
export const kindOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

/**
 * Each path the source names, matched to one of the things given for it under a name: a file
 * chosen, or an address a chat holds. By name first. A chat writes a file's name its own way, and
 * the person's file is called what their camera or the chat called it: so where one path of a kind
 * is left without its match, and one given thing of that kind without a path, that is its match.
 * More of a kind on either side are left, since nothing says which is which. `unused` are the
 * given things no path took.
 */
export function matchNamed<T>(paths: string[], given: (readonly [name: string, thing: T])[]): { matched: Record<string, T>, missing: string[], unused: T[] } {
  const byName = new Map(given)
  const matched: Record<string, T> = {}
  const unnamed: string[] = []
  const taken = new Set<string>()
  for (const path of paths) {
    const name = baseName(path)
    if (byName.has(name)) {
      matched[path] = byName.get(name)!
      taken.add(name)
    } else unnamed.push(path)
  }
  const left = [...byName.keys()].filter((name) => !taken.has(name))
  const missing: string[] = []
  for (const path of unnamed) {
    const fits = left.filter((name) => kindOf(name) === kindOf(path))
    const [name] = fits
    if (name !== undefined && fits.length === 1 && unnamed.filter((other) => kindOf(other) === kindOf(path)).length === 1) {
      matched[path] = byName.get(name)!
      taken.add(name)
    } else missing.push(path)
  }
  return { matched, missing, unused: [...byName].filter(([name]) => !taken.has(name)).map(([, thing]) => thing) }
}

/** The files to build with, keyed by the path as the source writes it: `matchNamed`, of the chosen files. */
export function matchFiles(paths: string[], chosen: File[]): { files: Record<string, File>, missing: string[], unused: File[] } {
  const { matched, missing, unused } = matchNamed(paths, chosen.map((file) => [file.name, file] as const))
  return { files: matched, missing, unused }
}

/**
 * The content types a source is written in, of those listed, by machine name: its own as the build
 * reads it, then every one named below it as it is, under any key, in the order they come, each
 * once. Their type files are what the chat that wrote the source lacked.
 *
 * The source's own type is h5p-author's reading of it, `sourceType`: its `type` as it is or as it is
 * spoken of, "interactive-book", or with none the one under `contentType` or `library`. A chat with
 * no skill text writes it so, and a rule of the page's own, `type` as written, gave its first copy
 * no file (h5p-toolkit#176). Below it a name counts only as it is, a listed machine name with
 * or without a major and minor: what reads like one, a slide's element `{ "type": "text" }`, is no
 * H5P.Text.
 */
export function typesNamed(source: unknown, listed: Iterable<string>): string[] {
  const names = new Set(listed)
  const found = new Set<string>()
  const own = sourceType(source, names)
  if (own) found.add(own)
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      // A name is short: a sentence that happens to hold one is not it.
      const name = value.length <= 64 ? /^\s*(\S+)(?:\s+\d+\.\d+)?\s*$/.exec(value)?.[1] : undefined
      if (name && names.has(name)) found.add(name)
    } else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(source)
  return [...found]
}

/**
 * The problems, as the text a person pastes back into the chat that wrote the source, and after
 * them the type files of the content types the source is written in. A chat in a browser has the
 * skill's text and none of its files, so it guesses a type's fields, and a problem tells it one
 * level's names a round. With the files beside the first problems, the weakest model tried wrote
 * 42 of 46 sources right by its second reply, and 29 without them (h5p-toolkit#172). The
 * wording is the one measured.
 */
export function forTheChat(problems: Problem[], typeFiles: TypeFile[] = []): string {
  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`
  const lines = [
    `The build page found ${count} in the source. Fix them all and write the whole source again:`,
    ...problems.map(({ path, message }) => `- ${path}: ${message}`)
  ]
  if (typeFiles.length) {
    lines.push('', "How these content types are written, from the h5p-author skill's type files:", '', typeFiles.map(({ text }) => text.trim()).join('\n\n---\n\n'))
  }
  return lines.join('\n')
}

/**
 * A file name for the package, from its title: its letters, marks and digits in any script, lower
 * case, joined by hyphens, at most 60 of them. "Die größten Ereignisse" is
 * `die-größten-ereignisse.h5p`, and a Cyrillic or Greek title keeps its letters, where a slug of
 * ASCII alone turned ß into a hyphen and such a title into `activity.h5p`.
 */
export function packageName(title: unknown): string {
  const words = String(title ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const short = Array.from(words).slice(0, 60).join('').replace(/-+$/, '')
  return `${short || 'activity'}.h5p`
}

/** A size in kilobytes below a megabyte, in megabytes above. */
export const sized = (bytes: number): string => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`)
