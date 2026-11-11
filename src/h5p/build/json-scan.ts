/**
 * JSON text read for where things are in it, with no DOM, for the build page's editor. `JSON.parse`
 * says where a mistake is differently in each browser (Safari says nothing) and in words for
 * programmers, and the build names the place of a problem by a path in the source,
 * `params.chapters[0].metadata.title`, not by a line. This reads the text once, as strictly as JSON
 * does, and keeps the offset of every name and value, so that both can be pointed at.
 */

/** Where a text stops being JSON, and what is wrong there, in words for someone who does not write JSON. */
export interface JsonError {
  offset: number
  message: string
}

/** A stretch of the text, as offsets. */
export interface Range {
  from: number
  to: number
}

interface Member {
  key: Range
  value: Node
}

type Node =
  | { kind: 'object'; from: number; to: number; members: Map<string, Member> }
  | { kind: 'array'; from: number; to: number; items: Node[] }
  | { kind: 'scalar'; from: number; to: number }

class Stop extends Error {
  constructor(readonly offset: number, message: string) {
    super(message)
  }
}

/** Deeper than a source goes, and a stack that a text cannot be allowed to fill. */
const MAX_DEPTH = 200
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const WORD = /[A-Za-z]+/y
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

function read(text: string): Node {
  let pos = 0

  const fail = (message: string, at = pos): Stop => new Stop(at, message)
  const skip = (): void => {
    while (pos < text.length && ' \t\n\r'.includes(text[pos])) pos++
  }
  /** What is at the position, for a message. */
  const found = (): string => {
    if (pos >= text.length) return 'the end of the text'
    const char = text[pos]
    return char === '\n' || char === '\r' ? 'a line break' : `"${char}"`
  }
  const ended = (): Stop => fail('The text ends before the JSON is complete: a closing bracket or quote is missing', text.length)

  function string(): { range: Range; value: string } {
    const from = pos
    pos++
    let value = ''
    for (;;) {
      if (pos >= text.length) throw fail('This text in quotes is not closed: a closing " is missing', from)
      const char = text[pos]
      if (char === '"') {
        pos++
        return { range: { from, to: pos }, value }
      }
      if (char === '\\') {
        const next = text[pos + 1]
        if (next === 'u') {
          const hex = text.slice(pos + 2, pos + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw fail('A \\u must be followed by four hexadecimal digits, as in \\u00e9')
          value += String.fromCharCode(parseInt(hex, 16))
          pos += 6
        } else if (next !== undefined && Object.hasOwn(ESCAPES, next)) {
          value += ESCAPES[next]
          pos += 2
        } else {
          throw fail('A backslash starts an escape: write \\\\ for a backslash, \\" for a quote or \\n for a line break')
        }
        continue
      }
      if (char < ' ') {
        throw fail(char === '\n' || char === '\r'
          ? 'A line break inside text in quotes: write \\n for one, or close the quote first'
          : 'A tab or other control character inside text in quotes: write \\t, or remove it')
      }
      value += char
      pos++
    }
  }

  function number(): Range {
    const from = pos
    NUMBER.lastIndex = pos
    const match = NUMBER.exec(text)
    if (!match) throw fail('This is not a number')
    pos += match[0].length
    if (/[0-9.eE+-]/.test(text[pos] ?? '')) throw fail('This is not a valid number: JSON has none with a leading zero, a "+" or a lone "."', from)
    return { from, to: pos }
  }

  function literal(): Range {
    const from = pos
    WORD.lastIndex = pos
    const word = WORD.exec(text)?.[0] ?? ''
    if (word !== 'true' && word !== 'false' && word !== 'null') {
      throw fail(`"${word}" is not JSON: it has true, false and null, in lower case, and other text goes in "double quotes"`)
    }
    pos += word.length
    return { from, to: pos }
  }

  function value(depth: number): Node {
    if (depth > MAX_DEPTH) throw fail('This is nested too deeply to read')
    skip()
    if (pos >= text.length) throw ended()
    const char = text[pos]
    if (char === '{') return object(depth)
    if (char === '[') return array(depth)
    if (char === '"') return { kind: 'scalar', ...string().range }
    if (char === '-' || (char >= '0' && char <= '9')) return { kind: 'scalar', ...number() }
    if (/[A-Za-z]/.test(char)) return { kind: 'scalar', ...literal() }
    if (char === "'") throw fail('Text goes in "double quotes" in JSON, not in \'single quotes\'')
    if (char === '/') throw fail('JSON has no comments: remove this')
    throw fail(`Expected a value here, but found ${found()}`)
  }

  function object(depth: number): Node {
    const from = pos
    pos++
    const members = new Map<string, Member>()
    skip()
    if (text[pos] === '}') {
      pos++
      return { kind: 'object', from, to: pos, members }
    }
    let comma = -1
    for (;;) {
      skip()
      if (pos >= text.length) throw ended()
      if (text[pos] === '}' && comma >= 0) throw fail('A comma right before a closing bracket is not allowed: remove it', comma)
      if (text[pos] !== '"') {
        throw fail(text[pos] === "'"
          ? 'Names go in "double quotes" in JSON, not in \'single quotes\''
          : `Expected a name in "double quotes" here, but found ${found()}`)
      }
      const key = string()
      skip()
      if (pos >= text.length) throw ended()
      if (text[pos] !== ':') throw fail(`Expected ":" after the name, but found ${found()}`)
      pos++
      members.set(key.value, { key: key.range, value: value(depth + 1) })
      skip()
      if (text[pos] === ',') {
        comma = pos
        pos++
        continue
      }
      if (text[pos] === '}') {
        pos++
        return { kind: 'object', from, to: pos, members }
      }
      if (pos >= text.length) throw ended()
      throw fail(text[pos] === '"' ? 'A comma is missing here, after the value before it' : `Expected "," or "}" here, but found ${found()}`)
    }
  }

  function array(depth: number): Node {
    const from = pos
    pos++
    const items: Node[] = []
    skip()
    if (text[pos] === ']') {
      pos++
      return { kind: 'array', from, to: pos, items }
    }
    let comma = -1
    for (;;) {
      skip()
      if (pos >= text.length) throw ended()
      if (text[pos] === ']' && comma >= 0) throw fail('A comma right before a closing bracket is not allowed: remove it', comma)
      items.push(value(depth + 1))
      skip()
      if (text[pos] === ',') {
        comma = pos
        pos++
        continue
      }
      if (text[pos] === ']') {
        pos++
        return { kind: 'array', from, to: pos, items }
      }
      if (pos >= text.length) throw ended()
      throw fail(/["{[\-0-9A-Za-z]/.test(text[pos]) ? 'A comma is missing here, after the value before it' : `Expected "," or "]" here, but found ${found()}`)
    }
  }

  skip()
  if (pos >= text.length) throw fail('There is no JSON here', 0)
  const root = value(0)
  skip()
  if (pos < text.length) throw fail('There is more text after the end of the JSON: remove it')
  return root
}

/** Where a text stops being JSON, or `null` for JSON, and for text with nothing in it. */
export function jsonError(text: string): JsonError | null {
  if (!text.trim()) return null
  try {
    read(text)
    return null
  } catch (error) {
    if (error instanceof Stop) return { offset: error.offset, message: error.message }
    throw error
  }
}

/** An offset as a line and a column, each counted from 1, as an editor shows them. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 }
}

/** The steps of a path as the build writes it: `params.chapters[0].metadata.title`. */
function steps(path: string): (string | number)[] | null {
  const found: (string | number)[] = []
  let at = 0
  while (at < path.length) {
    if (path[at] === '[') {
      const index = /^\[(\d+)\]/.exec(path.slice(at))
      if (!index) return null
      found.push(Number(index[1]))
      at += index[0].length
    } else {
      if (path[at] === '.') at++
      const name = /^[^.[\]]+/.exec(path.slice(at))
      if (!name) return null
      found.push(name[0])
      at += name[0].length
    }
  }
  return found.length ? found : null
}

/**
 * What to point at for a node, and for the name it is under: the name and a scalar value whole,
 * and of an object or an array its name and its opening bracket, so that a mark does not cover a
 * page of text.
 */
function around(node: Node, key: Range | null): Range {
  const from = key?.from ?? node.from
  return { from, to: node.kind === 'scalar' ? node.to : node.from + 1 }
}

/**
 * Where a problem's path points in the text: the name and value it names, or, where the source
 * has none (a field that is missing), the object it is missing from, with `exact` false. `null`
 * for a path that cannot be read, and for text that is not JSON, which has no places.
 */
export function locate(text: string, path: string): (Range & { exact: boolean }) | null {
  const wanted = steps(path)
  if (!wanted) return null
  let node: Node
  try {
    node = read(text)
  } catch (error) {
    if (error instanceof Stop) return null
    throw error
  }
  let key: Range | null = null
  for (const step of wanted) {
    if (typeof step === 'number') {
      if (node.kind !== 'array' || step >= node.items.length) return { ...around(node, key), exact: false }
      node = node.items[step]
      key = null
    } else {
      const member = node.kind === 'object' ? node.members.get(step) : undefined
      if (!member) return { ...around(node, key), exact: false }
      key = member.key
      node = member.value
    }
  }
  return { ...around(node, key), exact: true }
}

/**
 * What is inside a Markdown code fence the text may be wrapped in, as a chat often hands over a
 * source, and where it starts in the text. Text with no fence is taken as it is.
 */
export function unfence(text: string): { text: string; offset: number } {
  const fenced = /^(\s*```[\w-]*\s*\n)([\s\S]*?)\n\s*```\s*$/.exec(text)
  return fenced ? { text: fenced[2], offset: fenced[1].length } : { text, offset: 0 }
}

/**
 * What is wrong with text that is not JSON, in words for someone who does not write JSON, to
 * follow "is not valid JSON", and where, as an offset into the text it is given: `null` for JSON
 * and for nothing. `JSON.parse` is what says whether it is JSON; `jsonError` says where, which
 * `JSON.parse` does not in every browser.
 */
export function jsonProblem(text: string): { message: string; at?: number } | null {
  if (!text.trim()) return null
  const { text: body, offset } = unfence(text)
  try {
    JSON.parse(body)
    return null
  } catch (error) {
    const found = jsonError(body)
    if (!found) return { message: `(${error instanceof Error ? error.message : String(error)})` }
    const at = offset + found.offset
    const { line, column } = lineColumn(text, at)
    return { message: `at line ${line}, column ${column}: ${found.message}`, at }
  }
}

/**
 * The source laid out, two spaces and one field to a line, and out of the code fence a chat may have
 * put it in: the same JSON, as it is shown when it arrives. `null` for text that is not JSON, and
 * for none, which is left as it is.
 */
export function formatSource(text: string): string | null {
  if (!text.trim() || jsonProblem(text)) return null
  return JSON.stringify(JSON.parse(unfence(text).text), null, 2)
}

/** Where to take the person to in a source: an offset, or what a problem's path points at. */
export type Target = { at: number } | { path: string }

/** The stretch of the text a target is, in the text as it is, fence and all; `null` where it has none. */
export function place(text: string, target: Target): Range | null {
  if ('at' in target) return { from: target.at, to: Math.min(target.at + 1, text.length) }
  const { text: body, offset } = unfence(text)
  const found = locate(body, target.path)
  return found && { from: found.from + offset, to: found.to + offset }
}
