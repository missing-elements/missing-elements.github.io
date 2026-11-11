import { expect, test } from '@playwright/test'
import { jsonError, lineColumn, locate } from '../src/h5p/build/json-scan'

/*
 * The reading of JSON text behind the build page's editor, with no browser: where a text stops being
 * JSON and what is wrong there, and where a problem's path points. The page's own tests (build.spec.ts)
 * show both in the editor.
 */

test('JSON, and text with nothing in it, has no mistake', () => {
  for (const text of ['{}', '[]', ' { "a": [1, -2.5e+3, 0, true, false, null, "x\\n\\u00e9\\"", {}] } \n', '"text"', '0', '', '   \n']) {
    expect(jsonError(text), JSON.stringify(text)).toBeNull()
  }
})

test('a mistake is found where it is, and said in words for someone who does not write JSON', () => {
  /** The text with a marker, `¦`, at the offset the mistake is expected at, taken out. */
  const cases: [string, RegExp][] = [
    ['{ "a": 1 ¦"b": 2 }', /comma is missing/],
    ['{ "a": [1, 2 ¦}', /Expected "," or "\]"/],
    ['{ "a": 1¦, }', /comma right before a closing bracket/],
    ['[1, 2¦,]', /comma right before a closing bracket/],
    ['{ "a": 1¦', /text ends before the JSON is complete/],
    ['{ ¦\'a\': 1 }', /not in 'single quotes'/],
    ['{ "a": ¦True }', /"True" is not JSON/],
    ['{ "a": ¦nope }', /"nope" is not JSON/],
    ['{ "a": "line¦\nbreak" }', /line break inside text in quotes/],
    ['{ "a": ¦01 }', /not a valid number/],
    ['{ "a": ¦1.5.2 }', /not a valid number/],
    ['{ "a": 1 } ¦extra', /more text after the end/],
    ['{ "a": ¦// note\n 1 }', /no comments/],
    ['{ "a" ¦1 }', /Expected ":" after the name/],
    ['{ "a": ¦}', /Expected a value here/],
    ['{ "a": ¦"x', /not closed/],
    ['{ "a": "x¦\\q" }', /A backslash starts an escape/],
    ['{ "a": "x¦\\u12" }', /four hexadecimal digits/],
    ['{ ¦a: 1 }', /Expected a name in "double quotes" here, but found "a"/],
    ['{ "a": 1, ¦, "b": 2 }', /Expected a name in "double quotes" here, but found ","/]
  ]
  for (const [marked, message] of cases) {
    const offset = marked.indexOf('¦')
    const text = marked.replace('¦', '')
    const error = jsonError(text)
    expect(error, text).not.toBeNull()
    expect(error!.offset, text).toBe(offset)
    expect(error!.message, text).toMatch(message)
  }
})

test('what is not JSON for JSON.parse is not for this reading either', () => {
  for (const text of ['{ "a": 1 "b": 2 }', '{ "a": [1, 2 }', "{ 'a': 1 }", '{ "a": True }', '{ "a": 01 }', '{ "a": 1 } x', '{ "a": 1, }', '[1,]', '{"a" 1}', '{', '[', '"x', '{"a":"\n"}']) {
    expect(() => JSON.parse(text), text).toThrow()
    expect(jsonError(text), text).not.toBeNull()
  }
  for (const text of ['{"a":[1,2,{"b":null}]}', '[]', '{"a":"\\u00e9\\n"}', '-0.5E-3', '" "']) {
    expect(() => JSON.parse(text), text).not.toThrow()
    expect(jsonError(text), text).toBeNull()
  }
})

test('a text nested too deeply is a mistake, not a crash', () => {
  const error = jsonError('['.repeat(1000))
  expect(error?.message).toMatch(/nested too deeply/)
})

test('an offset is a line and a column, each from 1', () => {
  const text = '{\n  "a": 1\n  "b": 2\n}'
  const error = jsonError(text)
  expect(lineColumn(text, error!.offset)).toEqual({ line: 3, column: 3 })
  expect(lineColumn('', 0)).toEqual({ line: 1, column: 1 })
  expect(lineColumn('abc', 3)).toEqual({ line: 1, column: 4 })
})

test('a problem’s path points at its name and value, or at what it is missing from', () => {
  const source = JSON.stringify({ type: 'H5P.Blanks', title: 'Rivers', authors: [], params: { questions: ['a', 'b'] } }, null, 2)
  const at = (path: string): { text: string; exact: boolean } | null => {
    const found = locate(source, path)
    return found && { text: source.slice(found.from, found.to), exact: found.exact }
  }
  // A scalar whole, with its name; an object or an array by its name and its opening bracket.
  expect(at('title')).toEqual({ text: '"title": "Rivers"', exact: true })
  expect(at('params.questions[1]')).toEqual({ text: '"b"', exact: true })
  expect(at('params')).toEqual({ text: '"params": {', exact: true })
  expect(at('authors')).toEqual({ text: '"authors": [', exact: true })
  // What the source has none of is looked for in what it is missing from.
  expect(at('colour')).toEqual({ text: '{', exact: false })
  expect(at('params.questions[5]')).toEqual({ text: '"questions": [', exact: false })
  expect(at('params.missing.deep')).toEqual({ text: '"params": {', exact: false })
  expect(at('title.inside')).toEqual({ text: '"title": "Rivers"', exact: false })
  // A path that cannot be read, and a text that is not JSON, have no place.
  expect(at('nope[')).toBeNull()
  expect(at('')).toBeNull()
  expect(at('a..b')).toBeNull()
  expect(locate('{ "title": ', 'title')).toBeNull()
})

test('a name with an escape in it is found by what it says', () => {
  const text = '{ "caf\\u00e9": { "x": 1 } }'
  const found = locate(text, 'café.x')
  expect(found && text.slice(found.from, found.to)).toBe('"x": 1')
})
