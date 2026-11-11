/**
 * What the build page does with a source before and after `@missing-elements/h5p-author` sees it,
 * with no DOM: the source a link carries, the files a source names, the content types it is
 * written in, and the text a chat is given back. The browser tests reach it through the page.
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
 * The source a link carries in its fragment, `#source=<base64url>`, which the browser never
 * sends to a server. The bytes are the source's JSON, as UTF-8, or that JSON compressed with
 * raw deflate, which a chat's sandbox writes with Node's `zlib.deflateRawSync` or Python's
 * `zlib.compressobj(wbits=-15)` to keep the link short. Returns `null` for a fragment that
 * carries none, and throws for one that carries something else.
 */
export async function sourceFromFragment(hash: string): Promise<string | null> {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('source')
  if (!value) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
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

function isJson(text: string): boolean {
  if (!/^\s*\{/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
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

/**
 * The source laid out, one field to a line, and out of the code fence a chat may have put it in:
 * the same JSON, as the text of an editor that tidies it, or `null` where it is not JSON.
 */
export function formatSource(text: string): string | null {
  if (!text.trim() || jsonProblem(text)) return null
  return JSON.stringify(JSON.parse(unfence(text).text), null, 2)
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

/**
 * The files to build with: each path the source names, matched to a chosen file by its name,
 * keyed by the path as the source writes it.
 */
export function matchFiles(paths: string[], chosen: File[]): { files: Record<string, File>, missing: string[] } {
  const byName = new Map(chosen.map((file) => [file.name, file]))
  const files: Record<string, File> = {}
  const missing: string[] = []
  for (const path of paths) {
    const file = byName.get(baseName(path))
    if (file) files[path] = file
    else missing.push(path)
  }
  return { files, missing }
}

/**
 * The content types a source is written in, of those listed, by machine name: its own as the build
 * reads it, then every one named below it as it is, under any key, in the order they come, each
 * once. Their type files are what the chat that wrote the source lacked.
 *
 * The source's own type is h5p-author's reading of it, `sourceType`: its `type` as it is or as it is
 * spoken of, "interactive-book", or with none the one under `contentType` or `library`. A chat with
 * no skill text writes it so, and a rule of the page's own, `type` as written, gave its first copy
 * no file (h5p-offline-player#176). Below it a name counts only as it is, a listed machine name with
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
 * 42 of 46 sources right by its second reply, and 29 without them (h5p-offline-player#172). The
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
