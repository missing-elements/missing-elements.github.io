import { readdir, readFile } from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
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

/**
 * Fills the source. It is edited in an editor, which loads apart and takes the textarea's place;
 * the textarea stays under it holding the same text, which is how the page reads the source. The
 * text is typed over a selection of all of it, made by the editor's own key: a page selection that
 * a test makes itself can be taken back by the editor, which keeps its own.
 */
async function fillSource(page: Page, text: string): Promise<void> {
  await page.locator('.source-editor .cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
  await expect(page.locator('#source')).toHaveValue(text)
}

/** Pastes text through the clipboard into what has the focus, as a person does: the browser's own paste. */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text)
  await page.keyboard.press('ControlOrMeta+v')
}

const playerState = (page: Page) => page.locator('h5p-player').evaluate((element: HTMLElement & { state?: string }) => element.state)

async function expectPlays(page: Page): Promise<void> {
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 40_000 })
  await expect.poll(() => playerState(page)).toBe('ready')
  await expect(page.frameLocator('h5p-player iframe').first().locator('.h5p-content, .h5p-container').first()).toBeVisible()
}

/** What a step's marker shows, as site.css draws it from what the step says of itself: its number, a check or a warning. */
const marker = (page: Page, heading: string) => page.locator(`.step[aria-labelledby="${heading}"]`).evaluate((step) => {
  const style = getComputedStyle(step)
  const icon = style.getPropertyValue('--step-icon')
  if (!icon) return 'number'
  return icon === style.getPropertyValue('--icon-check') ? 'check' : icon === style.getPropertyValue('--icon-alert') ? 'warning' : icon
})

test('a pasted source builds, plays and downloads', async ({ page, baseURL }) => {
  const { problems, elsewhere } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  // The site's own layout: its theme switch, which site.js shows once it runs under the page's policy.
  await expect(page.locator('[data-theme-toggle]')).toBeVisible()
  await expect(page.locator('#files-step')).toBeHidden()
  // A chat hands the source in a code fence; the page takes what is inside it.
  await fillSource(page, '```json\n' + JSON.stringify(RIVERS, null, 2) + '\n```')
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

test('before anything is built the page gives a prompt to try, and says where a package plays and where to say how it went', async ({ page, context, baseURL }) => {
  const { problems, elsewhere } = watch(page, baseURL)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/h5p/build/')
  // The prompt carries the skill's page at its whole address, which a chat's fetch tool needs, and its button copies it.
  const prompt = page.locator('pre.prompt')
  await expect(prompt).toHaveText('Read https://missing-elements.github.io/h5p/skill/ and follow it to make an H5P quiz with five questions about the rivers of Europe.')
  await page.locator('.docs-header').getByRole('button', { name: 'Copy' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await prompt.textContent())

  // With no H5P site: the player this page plays it in, in two links in a paragraph, to how to set it
  // up on a site of one's own and to its app, offline.
  const plays = page.getByRole('region', { name: 'Play it without an H5P site' })
  await expect(plays.locator('p a')).toHaveCount(2)
  await expect(plays.getByRole('link', { name: 'on a site of your own' })).toHaveAttribute('href', 'https://github.com/missing-elements/h5p-offline-player/blob/main/docs/setup.md')
  await expect(plays.getByRole('link', { name: 'offline, in its app' })).toHaveAttribute('href', 'https://h5p-offline-player.vercel.app/app/')

  // Feedback asks for no account: an email, with a subject and two questions to start from.
  const feedback = page.getByRole('region', { name: 'How did it go?' })
  const email = feedback.getByRole('link', { name: 'Email feedback' })
  await expect(email).toBeVisible()
  const letter = new URL((await email.getAttribute('href'))!)
  expect(letter.protocol).toBe('mailto:')
  expect(letter.pathname).toMatch(/^[^@\s]+@[^@\s]+$/)
  expect(letter.searchParams.get('subject')).toBe('Feedback on the H5P build page')
  expect(letter.searchParams.get('body')).toBe('What I made (the content type, and the chat that wrote the source):\r\n\r\n\r\nWhat went well, or wrong:\r\n\r\n')
  // And for someone with a GitHub account, a new discussion where the author is made, which starts the same.
  const discussion = new URL((await feedback.getByRole('link', { name: 'Discuss on GitHub' }).getAttribute('href'))!)
  expect(discussion.origin + discussion.pathname).toBe('https://github.com/missing-elements/h5p-offline-player/discussions/new')
  expect(discussion.searchParams.get('category')).toBe('general')
  expect(discussion.searchParams.get('title')).toBe('Feedback on the H5P build page')
  expect(discussion.searchParams.get('body')).toBe(letter.searchParams.get('body')!.replaceAll('\r\n', '\n'))

  // They are links: the page still fetches nothing from another site.
  expect(elsewhere, 'nothing was fetched from another site').toEqual([])
  expect(problems, problems.join('\n')).toEqual([])
})

test('a source with problems gets them all listed, ready for the chat', async ({ page, context, request, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/h5p/build/')
  const { title: _title, ...untitled } = RIVERS
  await fillSource(page, JSON.stringify({ ...untitled, colour: 'blue' }))
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
  await fillSource(page, '{ "type": "H5P.Blanks", ')
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
  await fillSource(page, JSON.stringify(book))
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
  await fillSource(page, JSON.stringify({ ...book, type: 'H5P.ImageChoice', params: {} }))
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
    await fillSource(page, JSON.stringify(source))
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
  await fillSource(page, JSON.stringify(untitled))
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
  await fillSource(page, JSON.stringify(untitled))
  await page.locator('#build').click()
  await expect(page.locator('#problems li code')).toHaveText('title')
  // Its type file is on its way when the next source's problems replace these: text that names no type.
  await fillSource(page, '{ "type": ')
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
  // It arrives laid out, a field to a line, where the link carried it on one.
  await expect(page.locator('#source')).toHaveValue(JSON.stringify(RIVERS, null, 2))

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
  expect(await marker(page, 'files-heading')).toBe('number')

  await page.locator('#files').setInputFiles({ name: 'delta.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.locator('#file-list li')).toHaveAttribute('data-chosen', 'true')
  // Every file it names is chosen: the step is done.
  expect(await marker(page, 'files-heading')).toBe('check')
  await page.locator('#build').click()
  await expectPlays(page)
  await expect(page.locator('#status')).toContainText('1 media file')
  // The picture reaches the content and decodes: 2×2, as chosen.
  await expect.poll(() => page.frameLocator('h5p-player iframe').first().locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2)
  expect(problems, problems.join('\n')).toEqual([])
})

test('each step’s marker says how the step stands: its number, a check once it is done, a warning where it went wrong', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  expect(await marker(page, 'source-heading')).toBe('number')
  expect(await marker(page, 'build-heading')).toBe('number')
  // The source is done once it is JSON, and wrong while it is not.
  await fillSource(page, '{ "type": ')
  await expect.poll(() => marker(page, 'source-heading')).toBe('warning')
  const { title: _title, ...untitled } = RIVERS
  await fillSource(page, JSON.stringify(untitled))
  await expect.poll(() => marker(page, 'source-heading')).toBe('check')
  // A build with problems went wrong; one that plays is done, and the play is the step at hand.
  await page.locator('#build').click()
  await expect.poll(() => marker(page, 'build-heading')).toBe('warning')
  await fillSource(page, JSON.stringify(RIVERS))
  await page.locator('#build').click()
  await expectPlays(page)
  expect(await marker(page, 'build-heading')).toBe('check')
  expect(await marker(page, 'play-heading')).toBe('number')
  expect(problems, problems.join('\n')).toEqual([])
})

// The source's editor: CodeMirror, loaded apart, in place of the textarea, which stays under it.

test('a mistake in the JSON is marked as it is typed, with its line and column, and goes when it is put right', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  const state = page.locator('#source-state')
  await expect(state).toHaveText('')
  await fillSource(page, '{\n  "type": "H5P.Blanks"\n  "title": "Rivers"\n}')
  // Said in words, with where, in the line under the source and in the editor itself.
  await expect(state).toContainText('Not valid JSON at line 3, column 3: A comma is missing here')
  await expect(page.locator('.source-editor .cm-lintRange-error')).toHaveCount(1)
  // The button goes where the mistake is.
  await state.getByRole('button', { name: 'Show where' }).click()
  await expect(page.locator('.source-editor .cm-activeLine')).toContainText('"title": "Rivers"')
  // Put right, it goes.
  await fillSource(page, JSON.stringify(RIVERS))
  await expect(state).toHaveText('')
  await expect(page.locator('.source-editor .cm-lintRange-error')).toHaveCount(0)
  expect(problems, problems.join('\n')).toEqual([])
})

test('a source pasted whole arrives laid out, out of its code fence; any other paste goes in as it is', async ({ page, context, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/h5p/build/')
  const field = page.locator('#source')
  const lakes = { ...RIVERS, title: 'Lakes' }
  await page.locator('.source-editor .cm-content').click()
  // Into the empty editor, on one line in a code fence, as a chat may hand it over.
  await paste(page, '```json\n' + JSON.stringify(RIVERS) + '\n```')
  await expect(field).toHaveValue(JSON.stringify(RIVERS, null, 2))
  await expect(page.locator('.source-editor .cm-line').first()).toHaveText('{')
  // Over all of the text, too.
  await page.keyboard.press('ControlOrMeta+a')
  await paste(page, JSON.stringify(lakes))
  await expect(field).toHaveValue(JSON.stringify(lakes, null, 2))
  // Into the text it is the person's own to lay out: it goes in as it is.
  await page.keyboard.press('ControlOrMeta+End')
  await paste(page, '{"a":1}')
  await expect(field).toHaveValue(JSON.stringify(lakes, null, 2) + '{"a":1}')
  // Text that is not JSON is left as it is, and the line under the source says where.
  await page.keyboard.press('ControlOrMeta+a')
  await paste(page, '{ "type": ')
  await expect(field).toHaveValue('{ "type": ')
  await expect(page.locator('#source-state')).toContainText('The text ends before the JSON is complete')
  expect(problems, problems.join('\n')).toEqual([])
})

test('a source opened from a file arrives laid out, and there is no button to lay it out', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  await expect(page.getByRole('button', { name: 'Format' })).toHaveCount(0)
  await page.locator('#source-file').setInputFiles({ name: 'rivers.json', mimeType: 'application/json', buffer: Buffer.from('```json\n' + JSON.stringify(RIVERS) + '\n```') })
  await expect(page.locator('#source')).toHaveValue(JSON.stringify(RIVERS, null, 2))
  await expect(page.locator('.source-editor .cm-line').first()).toHaveText('{')
  // A file that is not JSON is as it is, with the mistake marked.
  await page.locator('#source-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('{ "type": ') })
  await expect(page.locator('#source')).toHaveValue('{ "type": ')
  await expect(page.locator('#source-state')).toContainText('The text ends before the JSON is complete')
  expect(problems, problems.join('\n')).toEqual([])
})

/** The source an address carries, as the text of its bytes, plain or deflated: `''` for an empty one, `null` for none or for bytes that are neither. */
function carriedBy(page: Page): string | null {
  const value = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('source')
  if (value === null) return null
  const bytes = Buffer.from(value, 'base64url')
  if (!bytes.length) return ''
  const text = bytes.toString('utf8')
  try {
    JSON.parse(text)
    return text
  } catch {
    try {
      return inflateRawSync(bytes).toString('utf8')
    } catch {
      return null
    }
  }
}

/** Counts the page's writes to its address, from before the page's own scripts run. */
const countAddressWrites = (page: Page) => page.addInitScript(() => {
  const counter = window as unknown as { addressWrites: number }
  counter.addressWrites = 0
  const replaceState = history.replaceState.bind(history)
  history.replaceState = (...args: Parameters<History['replaceState']>) => {
    counter.addressWrites++
    return replaceState(...args)
  }
})
const addressWrites = (page: Page) => page.evaluate(() => (window as unknown as { addressWrites: number }).addressWrites)

test('a link that carried the source follows it as it is changed', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await countAddressWrites(page)
  await page.goto(`/h5p/build/#source=${deflateRawSync(Buffer.from(JSON.stringify(RIVERS))).toString('base64url')}`)
  await expectPlays(page)
  // Arriving writes nothing: the address already carries the source that is shown.
  await page.waitForTimeout(900)
  expect(await addressWrites(page)).toBe(0)
  const entries = await page.evaluate(() => history.length)

  // Another source: the address carries it, on one line, and the history has no new entry.
  const lakes = { ...RIVERS, title: 'Lakes' }
  await fillSource(page, JSON.stringify(lakes, null, 2))
  await expect.poll(() => carriedBy(page)).toBe(JSON.stringify(lakes))
  expect(await addressWrites(page)).toBe(1)
  expect(await page.evaluate(() => history.length), 'replaced, not added').toBe(entries)

  // A change of layout is not a change of the source, and text that is not JSON leaves the address as it was.
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  expect(await addressWrites(page)).toBe(1)
  await page.keyboard.type('x')
  await expect(page.locator('#source-state')).toContainText('Not valid JSON')
  await page.waitForTimeout(900)
  expect(await addressWrites(page)).toBe(1)
  expect(carriedBy(page)).toBe(JSON.stringify(lakes))
  await page.keyboard.press('Backspace')

  // A reload builds what the address carries now.
  await page.reload()
  await expectPlays(page)
  await expect(page.locator('#source')).toHaveValue(JSON.stringify(lakes, null, 2))
  await expect(page.locator('#status')).toContainText('Built “Lakes”')

  // Emptied, it carries none, and the address is still the link of a page that follows: the next source is written.
  await page.locator('.source-editor .cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await expect.poll(() => carriedBy(page)).toBe('')
  const seas = { ...RIVERS, title: 'Seas' }
  await fillSource(page, JSON.stringify(seas))
  await expect.poll(() => carriedBy(page)).toBe(JSON.stringify(seas))
  expect(problems, problems.join('\n')).toEqual([])
})

test('a page opened with no source in its address leaves the address alone', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await countAddressWrites(page)
  await page.goto('/h5p/build/')
  await fillSource(page, JSON.stringify(RIVERS))
  await page.waitForTimeout(900)
  expect(await addressWrites(page)).toBe(0)
  expect(new URL(page.url()).hash).toBe('')
  expect(problems, problems.join('\n')).toEqual([])
})

test('a link that cannot be read gives way to the source the person writes', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.goto('/h5p/build/#source=not-a-source')
  await expect(page.locator('#status')).toContainText('neither JSON nor deflated JSON')
  await fillSource(page, JSON.stringify(RIVERS))
  await expect.poll(() => carriedBy(page)).toBe(JSON.stringify(RIVERS))
  expect(problems, problems.join('\n')).toEqual([])
})

test('where the browser cannot compress, the address carries the JSON as it is', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'CompressionStream') })
  await page.goto(`/h5p/build/#source=${Buffer.from(JSON.stringify(RIVERS)).toString('base64url')}`)
  await expectPlays(page)
  const lakes = { ...RIVERS, title: 'Lakes' }
  await fillSource(page, JSON.stringify(lakes, null, 2))
  await expect.poll(() => carriedBy(page)).toBe(JSON.stringify(lakes))
  const value = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('source')!
  expect(Buffer.from(value, 'base64url').toString('utf8')).toBe(JSON.stringify(lakes))
  expect(problems, problems.join('\n')).toEqual([])
})

test('a problem the build finds is marked where it is in the source, and its name goes there', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  const { title: _title, ...untitled } = RIVERS
  await fillSource(page, JSON.stringify({ ...untitled, colour: 'blue' }, null, 2))
  await page.locator('#build').click()
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error')
  // The field that is not a field of a source, name and value; the one that is missing, in the object it is missing from.
  const marks = page.locator('.source-editor .cm-lintRange-error')
  await expect(marks).toHaveCount(2)
  await expect(marks.filter({ hasText: '"colour": "blue"' })).toHaveCount(1)
  // Each problem's name goes to its place.
  await page.locator('#problems button.jump', { hasText: /^colour$/ }).click()
  await expect(page.locator('.source-editor .cm-activeLine')).toContainText('"colour": "blue"')
  await page.locator('#problems button.jump', { hasText: /^title$/ }).click()
  await expect(page.locator('.source-editor .cm-activeLine')).toHaveText('{')
  // The marks are of the text as it was built: a change to it clears them.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' ')
  await expect(marks).toHaveCount(0)
  // Text that is not JSON is a problem at a place of its own.
  await fillSource(page, '{ "type": "H5P.Blanks" "title": 1 }')
  await page.locator('#build').click()
  await expect(page.locator('#problems li')).toContainText('is not valid JSON at line 1, column 24: A comma is missing here')
  await page.locator('#problems button.jump').click()
  await expect(page.locator('.source-editor .cm-activeLine')).toContainText('"title": 1')
  expect(problems, problems.join('\n')).toEqual([])
})

test('the editor has a name, its label goes to it, and Tab leaves it', async ({ page }) => {
  await page.goto('/h5p/build/')
  const editor = page.getByRole('textbox', { name: 'The source, as JSON' })
  await expect(editor).toBeVisible()
  await page.getByText('The source, as JSON', { exact: true }).click()
  await expect(editor).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('#source-file')).toBeFocused()
})

test('text typed over a selection is the editor’s own, so a bracket wraps it and the policy is not asked', async ({ page, baseURL }) => {
  const { problems } = watch(page, baseURL)
  await page.goto('/h5p/build/')
  await fillSource(page, JSON.stringify(RIVERS, null, 2))
  await page.locator('.source-editor .cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('[')
  await expect(page.locator('#source')).toHaveValue(`[${JSON.stringify(RIVERS, null, 2)}]`)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('x')
  await expect(page.locator('#source')).toHaveValue('x')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('#source')).toHaveValue(`[${JSON.stringify(RIVERS, null, 2)}]`)
  expect(problems, problems.join('\n')).toEqual([])
})

test('where the editor cannot load, the textarea lays a whole paste out too, and the address follows it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/h5p/assets/editor-*.js', (route) => route.abort())
  await page.goto('/h5p/build/')
  const field = page.locator('#source')
  await field.click()
  await paste(page, '```json\n' + JSON.stringify(RIVERS) + '\n```')
  await expect(field).toHaveValue(JSON.stringify(RIVERS, null, 2))
  // Into the text, as it is.
  await field.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(area.value.length, area.value.length))
  await paste(page, '{"a":1}')
  await expect(field).toHaveValue(JSON.stringify(RIVERS, null, 2) + '{"a":1}')
  // A link that carried the source follows the textarea as it does the editor.
  await page.goto(`/h5p/build/#source=${Buffer.from(JSON.stringify(RIVERS)).toString('base64url')}`)
  await expectPlays(page)
  await expect(field).toHaveValue(JSON.stringify(RIVERS, null, 2))
  const lakes = { ...RIVERS, title: 'Lakes' }
  await field.fill(JSON.stringify(lakes))
  await expect.poll(() => carriedBy(page)).toBe(JSON.stringify(lakes))
})

test('where the editor cannot load, the source is the textarea, and the page works', async ({ page, baseURL }) => {
  const { elsewhere } = watch(page, baseURL)
  await page.route('**/h5p/assets/editor-*.js', (route) => route.abort())
  await page.goto('/h5p/build/')
  const field = page.locator('#source')
  await expect(field).toBeVisible()
  await field.fill(JSON.stringify({ ...RIVERS, authors: [] }))
  await page.locator('#build').click()
  await expect(page.locator('#problems li code')).toHaveText('authors')
  // Its name selects where it is, in the textarea.
  await page.locator('#problems button.jump').click()
  expect(await field.evaluate((area: HTMLTextAreaElement) => area.value.slice(area.selectionStart, area.selectionEnd))).toBe('"authors":[')
  await expect(page.locator('.source-editor')).toHaveCount(0)
  expect(elsewhere).toEqual([])
})
