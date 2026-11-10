import { deflateRawSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

/*
 * The build page, /h5p/build/, in a real browser against the built site: a source pasted, opened
 * from a link or naming a file of its own becomes a package that plays on the page and downloads
 * from it, and a source with problems gets them listed, all at once, for the chat that wrote it.
 * Every library comes from this origin, and any Content-Security-Policy violation or page error
 * fails the test.
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

test('a source with problems gets them all listed, ready for the chat', async ({ page, context, baseURL }) => {
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

  await page.locator('#copy-problems').click()
  await expect(page.locator('#copy-result')).toHaveText('Copied.')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^The build page found \d+ problems in the source\. Fix them all and write the whole source again:\n- /)
  expect(copied).toContain('- colour: ')

  // Text that is not JSON is a problem of its own, said where it is.
  await page.locator('#source').fill('{ "type": "H5P.Blanks", ')
  await page.locator('#build').click()
  await expect(listed).toHaveCount(1)
  await expect(listed.first()).toContainText('is not valid JSON')
  expect(problems, problems.join('\n')).toEqual([])
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
