import { readdir, readFile } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/*
 * The build page, /h5p/build/, in a real browser against the built site: a source pasted, opened
 * from a link or naming a file of its own becomes a package that plays on the page and downloads
 * from it, and a source with problems gets them listed, all at once, for the chat that wrote it,
 * and copied with the h5p-author skill's type files, which that chat lacked. Every library comes
 * from this origin, and any Content-Security-Policy violation or page error fails the test.
 */

const RIVERS = {
  type: 'H5P.Blanks',
  title: 'Rivers',
  language: 'en',
  license: 'CC BY',
  authors: [{ name: 'Ann Author', role: 'Author' }],
  params: { questions: ['The *Danube* flows into the Black Sea.'] }
}

/** A 2×2 PNG, red. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP4z8AARAwQCgAf7gP9Y167WwAAAABJRU5ErkJggg==', 'base64')

/** Collects console errors, CSP reports, page errors and requests that leave the origin. */
function watch(page: Page, baseURL: string | undefined): { problems: string[], elsewhere: string[] } {
  const problems: string[] = []
  const elsewhere: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' || /Content.Security.Policy/i.test(text)) problems.push(text)
  })
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('request', (request) => {
    const url = request.url()
    if (/^https?:/.test(url) && !url.startsWith(baseURL ?? '')) elsewhere.push(url)
  })
  return { problems, elsewhere }
}

/** What the copy says before the type files, and a type file as this site serves it, as the copy carries it. */
const TYPES_HEADING = "How these content types are written, from the h5p-author skill's type files:"
const typeFile = async (request: APIRequestContext, type: string): Promise<string> => {
  const response = await request.get(`/h5p/build/types/${type}.md`)
  expect(response.ok(), type).toBe(true)
  return (await response.text()).trim()
}
const copied = async (page: Page): Promise<string> => {
  await page.locator('#copy-problems').click()
  await expect(page.locator('#copy-result')).toHaveText('Copied.')
  return page.evaluate(() => navigator.clipboard.readText())
}

const playerState = (page: Page) => page.locator('h5p-player').evaluate((element: HTMLElement & { state?: string }) => element.state)

async function expectPlays(page: Page): Promise<void> {
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 40_000 })
  await expect.poll(() => playerState(page)).toBe('ready')
  await expect(page.frameLocator('h5p-player iframe').first().locator('.h5p-content, .h5p-container').first()).toBeVisible()
}

test('a pasted source builds, plays and downloads', async ({ page, baseURL }) => {
  const { problems, elsewhere } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  // The site's own layout: its theme switch, which site.js shows once it runs under the page's policy.
  await expect(page.locator('[data-theme-toggle]')).toBeVisible()
  await expect(page.locator('#files-step')).toBeHidden()
  // A chat hands the source in a code fence; the page takes what is inside it.
  await page.locator('#source').fill('```json\n' + JSON.stringify(RIVERS, null, 2) + '\n```')
  await page.locator('#build').click()
  await expectPlays(page)
  await expect(page.locator('#status')).toContainText('Built “Rivers”: H5P.Blanks, ')
  await expect(page.locator('#problems-box')).toBeHidden()
  await expect(page.frameLocator('h5p-player iframe').first().locator('.h5p-blanks')).toContainText('flows into the Black Sea')
  // The player's worker is scoped to its own folder of assets: no other page of the site is under it.
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(({ scope }) => new URL(scope).pathname))
  expect(scopes).toEqual(['/h5p/assets/h5p/'])

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()])
  expect(download.suggestedFilename()).toBe('rivers.h5p')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const zip = Buffer.concat(chunks)
  expect(zip.subarray(0, 4).toString('latin1'), 'a zip').toBe('PK\x03\x04')
  // The libraries an H5P site's upload check asks for are in it, as the command's build writes them.
  expect(zip.includes(Buffer.from('H5PEditor.'))).toBe(true)

  expect(elsewhere, 'nothing was fetched from another site').toEqual([])
  expect(problems, problems.join('\n')).toEqual([])
})

test('a source with problems gets them all listed, ready for the chat', async ({ page, context, request, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/h5p/build/')
  const { title: _title, ...untitled } = RIVERS
  await page.locator('#source').fill(JSON.stringify({ ...untitled, colour: 'blue' }))
  await page.locator('#build').click()
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error')
  const listed = page.locator('#problems li')
  // Each problem by its path, every one at once.
  await expect(listed.locator('code', { hasText: /^colour$/ })).toHaveCount(1)
  await expect(listed.locator('code', { hasText: /^title$/ })).toHaveCount(1)
  await expect(page.locator('#play-step')).toBeHidden()

  // The copy is the problems, then how the source's content type is written: its type file, whole.
  await expect(page.locator('#copy-types')).toHaveText('The copy also carries the skill’s notes on H5P.Blanks, with its fields and an example, so the chat does not have to guess.')
  const text = await copied(page)
  expect(text).toMatch(/^The build page found \d+ problems in the source\. Fix them all and write the whole source again:\n- /)
  expect(text).toContain('- colour: ')
  const [list, files] = text.split(`\n\n${TYPES_HEADING}\n\n`)
  expect(list.split('\n').slice(1).every((line) => line.startsWith('- ')), list).toBe(true)
  expect(files).toBe(await typeFile(request, 'H5P.Blanks'))

  // Text that is not JSON is a problem of its own, said where it is, and names no content type.
  await page.locator('#source').fill('{ "type": "H5P.Blanks", ')
  await page.locator('#build').click()
  await expect(listed).toHaveCount(1)
  await expect(listed.first()).toContainText('is not valid JSON')
  await expect(page.locator('#copy-types')).toBeHidden()
  expect(await copied(page)).toMatch(/^The build page found 1 problem in the source\. Fix them all and write the whole source again:\n- source: is not valid JSON[^\n]*$/)
  expect(problems, problems.join('\n')).toEqual([])
})

test('the copy carries the type files of the source’s type and of the libraries it names', async ({ page, context, request, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // What a chat with the skill's text and no type file wrote (h5p-offline-player#172): a chapter
  // without the H5P.Column around it. H5P.Table has no type file, and a library named twice has one.
  const text = (words: string) => ({ library: 'H5P.AdvancedText', params: { text: words } })
  const book = {
    type: 'H5P.InteractiveBook', title: 'Rivers', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }],
    params: {
      chapters: [{
        content: [
          text('The Danube flows into the Black Sea.'),
          { library: 'H5P.MultiChoice 1.16', params: { question: 'Where does the Danube end?', answers: [{ text: 'The Black Sea', correct: true }, { text: 'The North Sea', correct: false }] } },
          { library: 'H5P.Table', params: { text: '<table><tbody><tr><td>Danube</td></tr></tbody></table>' } },
          text('The Rhine flows into the North Sea.')
        ]
      }]
    }
  }
  await page.goto('/h5p/build/')
  await page.locator('#source').fill(JSON.stringify(book))
  await page.locator('#build').click()
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error')
  // The build says what to write, as h5p-author does since 0.7.0.
  await expect(page.locator('#problems li').first()).toContainText('write params.chapters[0] as { "library": "H5P.Column", "params": { "content": … } }')
  await expect(page.locator('#copy-types')).toHaveText('The copy also carries the skill’s notes on H5P.InteractiveBook, H5P.AdvancedText and H5P.MultiChoice, with their fields and an example, so the chat does not have to guess.')
  const [list, files] = (await copied(page)).split(`\n\n${TYPES_HEADING}\n\n`)
  expect(list).toContain('- params.chapters[0]: is the params of sub-content')
  // The source's own type first, then the libraries in the order it names them.
  expect(files).toBe([await typeFile(request, 'H5P.InteractiveBook'), await typeFile(request, 'H5P.AdvancedText'), await typeFile(request, 'H5P.MultiChoice')].join('\n\n---\n\n'))

  // A type the pack does not have has no file: its problems are copied alone.
  await page.locator('#source').fill(JSON.stringify({ ...book, type: 'H5P.ImageChoice', params: {} }))
  await page.locator('#build').click()
  await expect(page.locator('#problems li')).not.toHaveCount(0)
  const alone = await copied(page)
  expect(alone).toMatch(/^The build page found \d+ problems? in the source\./)
  expect(alone).not.toContain(TYPES_HEADING)
  await expect(page.locator('#copy-types')).toBeHidden()
  expect(problems, problems.join('\n')).toEqual([])
})

test('the copy carries the type file of a type named as it is spoken of, or under contentType, as the build reads it', async ({ page, context, request, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const META = { title: 'Physics', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
  /** The type files a source's copy carries after its problems, once a problem of it is shown. */
  const filesOf = async (source: unknown, said: string): Promise<string | undefined> => {
    await page.goto('/h5p/build/')
    await page.locator('#source').fill(JSON.stringify(source))
    await page.locator('#build').click()
    await expect(page.locator('#problems')).toContainText(said)
    return (await copied(page)).split(`\n\n${TYPES_HEADING}\n\n`)[1]
  }
  const files = async (...types: string[]) => (await Promise.all(types.map((type) => typeFile(request, type)))).join('\n\n---\n\n')

  // As the weakest model wrote one with no skill text (h5p-offline-player#174): the content's
  // fields beside `type`, the type as it is spoken of, a question named by its machine name.
  const spoken = { type: 'interactive-book', title: 'Physics', chapters: [{ title: 'Newton', content: [{ type: 'H5P.MultiChoice', question: 'Which law?', answers: [{ text: 'F = ma', correct: true }] }] }] }
  expect(await filesOf(spoken, 'takes the machine name, "H5P.InteractiveBook"')).toBe(await files('H5P.InteractiveBook', 'H5P.MultiChoice'))
  await expect(page.locator('#copy-types')).toHaveText('The copy also carries the skill’s notes on H5P.InteractiveBook and H5P.MultiChoice, with their fields and an example, so the chat does not have to guess.')

  // As Gemini in Chrome wrote one from a link to the skill: the type under `contentType`, the
  // source's own fields in `metadata`, sub-content naming its library the same way.
  const gemini = {
    contentType: 'H5P.InteractiveBook',
    metadata: { title: 'Physics', license: 'CC BY', authors: META.authors },
    params: { chapters: [{ title: 'Newton', content: [{ contentType: 'H5P.AdvancedText', params: { text: '<p>F = ma</p>' } }] }] }
  }
  expect(await filesOf(gemini, 'the content type is its type: write "type": "H5P.InteractiveBook"')).toBe(await files('H5P.InteractiveBook', 'H5P.AdvancedText'))

  // A name the build does not read for the type, under another key, is none; nor below it is a
  // text that only reads like one: a slide's element `{ "type": "text" }` is no H5P.Text.
  expect(await filesOf({ ...META, contentTypeName: 'interactive book', params: {} }, 'contentTypeName')).toBeUndefined()
  await expect(page.locator('#copy-types')).toBeHidden()
  const slides = { ...META, type: 'H5P.CoursePresentation', params: { presentation: { slides: [{ elements: [{ type: 'text', x: 5, y: 5, text: 'Newton' }] }] } } }
  expect(await filesOf(slides, 'params.presentation.slides[0].elements[0]')).toBe(await files('H5P.CoursePresentation'))
  expect(problems, problems.join('\n')).toEqual([])
})

test('the problems are copied alone where the type files cannot be fetched, and with them once they can', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/h5p/build/types/**', (route) => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('/h5p/build/')
  const { title: _title, ...untitled } = RIVERS
  await page.locator('#source').fill(JSON.stringify(untitled))
  await page.locator('#build').click()
  await expect(page.locator('#problems li')).toHaveCount(1)
  expect(await copied(page)).toMatch(/^The build page found 1 problem in the source\. Fix them all and write the whole source again:\n- title: [^\n]*$/)
  await expect(page.locator('#copy-types')).toBeHidden()

  await page.unroute('**/h5p/build/types/**')
  await page.locator('#build').click()
  await expect(page.locator('#copy-types')).toContainText('H5P.Blanks')
  expect((await copied(page)).endsWith(`\n\n${TYPES_HEADING}\n\n${await typeFile(request, 'H5P.Blanks')}`)).toBe(true)
})

test('type files that arrive once newer problems are shown are not copied with those', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  let release = (): void => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/h5p/build/types/H5P.Blanks.md', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/h5p/build/')
  const { title: _title, ...untitled } = RIVERS
  await page.locator('#source').fill(JSON.stringify(untitled))
  await page.locator('#build').click()
  await expect(page.locator('#problems li code')).toHaveText('title')
  // Its type file is on its way when the next source's problems replace these: text that names no type.
  await page.locator('#source').fill('{ "type": ')
  await page.locator('#build').click()
  await expect(page.locator('#problems li')).toContainText('is not valid JSON')
  const arrived = page.waitForResponse('**/h5p/build/types/H5P.Blanks.md')
  release()
  await (await arrived).finished()
  // Long enough for the page to have taken the file, had it not dropped it.
  await page.waitForTimeout(300)
  await expect(page.locator('#copy-types')).toBeHidden()
  expect(await copied(page)).not.toContain(TYPES_HEADING)
})

test('the type files are served as the pinned author package carries them', async ({ request }) => {
  const folder = new URL('../node_modules/@missing-elements/h5p-author/references/types/', import.meta.url)
  const names = (await readdir(folder)).filter((name) => name.endsWith('.md')).sort()
  const listing = await (await request.get('/h5p/build/types/index.json')).json() as { author: string, types: string[] }
  const bundles = await (await request.get('/h5p/bundles/index.json')).json() as { author: string }
  // The same release as the build's, so the files describe the fields this page's build takes.
  expect(listing.author).toBe(bundles.author)
  expect(listing.types).toEqual(names.map((name) => name.slice(0, -'.md'.length)))
  // Every content type the skill lists, and the parts other content holds.
  expect(listing.types.length).toBeGreaterThanOrEqual(32)
  for (const type of listing.types) {
    const response = await request.get(`/h5p/build/types/${type}.md`)
    expect(response.ok(), type).toBe(true)
    expect(await response.text(), type).toBe(await readFile(new URL(`${type}.md`, folder), 'utf8'))
  }
})

test('a link carrying the source builds it at once, deflated or not', async ({ page, baseURL }) => {
  const { problems, elsewhere } = watch(page, baseURL)
  const deflated = deflateRawSync(Buffer.from(JSON.stringify(RIVERS))).toString('base64url')
  await page.goto(`/h5p/build/#source=${deflated}`)
  await expectPlays(page)
  await expect(page.locator('#source')).toHaveValue(JSON.stringify(RIVERS))

  // Plain base64url, with umlauts and ß: the bytes are UTF-8, and the file name keeps the letters.
  const plain = Buffer.from(JSON.stringify({ ...RIVERS, language: 'de', title: 'Größte Flüsse' })).toString('base64url')
  await page.goto(`/h5p/build/#source=${plain}`)
  await expect(page.locator('#status')).toContainText('Built “Größte Flüsse”')
  await expectPlays(page)
  await expect(page.locator('#download')).toHaveAttribute('download', 'größte-flüsse.h5p')

  // A title in another script keeps its letters too, rather than becoming activity.h5p.
  await page.goto(`/h5p/build/#source=${Buffer.from(JSON.stringify({ ...RIVERS, language: 'uk', title: 'Річки України' })).toString('base64url')}`)
  await expectPlays(page)
  await expect(page.locator('#download')).toHaveAttribute('download', 'річки-україни.h5p')

  expect(elsewhere, 'nothing was fetched from another site').toEqual([])
  expect(problems, problems.join('\n')).toEqual([])
})

test('a Question Set shows its cover title as written, tags and entities nowhere', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  // h5p-author 0.5.0 wrapped this plain field in <div>, which the set draws as text (h5p-offline-player#164).
  const title = "Germany's Surrender: die größten Ereignisse"
  const quiz = {
    type: 'H5P.QuestionSet', title: 'Surrender', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }],
    params: {
      introPage: { showIntroPage: true, title, introduction: 'Five questions.' },
      questions: [{ library: 'H5P.TrueFalse', params: { question: 'The war in Europe ended in 1945.', correct: 'true' } }]
    }
  }
  await page.goto(`/h5p/build/#source=${Buffer.from(JSON.stringify(quiz)).toString('base64url')}`)
  await expectPlays(page)
  await expect(page.frameLocator('h5p-player iframe').first().locator('h2').first()).toHaveText(title)
  expect(problems, problems.join('\n')).toEqual([])
})

test('a source that names a file waits for it, then builds with it', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  const delta = {
    type: 'H5P.ImageHotspots',
    title: 'Delta',
    language: 'en',
    license: 'CC BY',
    authors: [{ name: 'Ann Author', role: 'Author' }],
    params: {
      image: { path: 'pictures/delta.png' },
      backgroundImageAltText: 'A river delta seen from above',
      hotspots: [{ position: { x: 30, y: 40 }, header: 'Main channel', content: [{ library: 'H5P.Text', params: { text: 'Most of the water flows here.' } }] }]
    }
  }
  await page.goto(`/h5p/build/#source=${Buffer.from(JSON.stringify(delta)).toString('base64url')}`)
  await expect(page.locator('#files-step')).toBeVisible()
  await expect(page.locator('#build-number')).toHaveText('3')
  await expect(page.locator('#file-list li')).toHaveAttribute('data-chosen', 'false')
  await expect(page.locator('#status')).toHaveText('The source names files: choose them, then Build.')

  await page.locator('#files').setInputFiles({ name: 'delta.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.locator('#file-list li')).toHaveAttribute('data-chosen', 'true')
  await page.locator('#build').click()
  await expectPlays(page)
  await expect(page.locator('#status')).toContainText('1 media file')
  // The picture reaches the content and decodes: 2×2, as chosen.
  await expect.poll(() => page.frameLocator('h5p-player iframe').first().locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2)
  expect(problems, problems.join('\n')).toEqual([])
})
