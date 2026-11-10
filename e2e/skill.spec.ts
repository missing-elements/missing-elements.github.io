import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/*
 * /h5p/skill/ as a chat that cannot install the h5p-author skill reads it: a page that writes out
 * the full address of every file, and of the build tool and every bundle in /h5p/bundles/, since a
 * chat's fetch tool may open only addresses it has seen whole; each file there as the pinned author
 * package carries it; and every address SKILL.md gives, relative to itself or written out, served
 * by this site.
 */

const SITE = 'https://missing-elements.github.io'
const author = fileURLToPath(new URL('../node_modules/@missing-elements/h5p-author/', import.meta.url))

/** Every file of the skill in the pinned package, by its path in the skill: SKILL.md, the licence, all of references/. */
async function carried(): Promise<string[]> {
  const entries = await readdir(join(author, 'references'), { recursive: true, withFileTypes: true })
  const references = entries.filter((entry) => entry.isFile()).map((entry) => relative(author, join(entry.parentPath, entry.name)).split(sep).join('/'))
  return ['SKILL.md', 'LICENSE', ...references].sort()
}

test('the page writes out the full address of every file of the skill, as its link and its text', async ({ page, request }) => {
  const files = await carried()
  expect(files).toEqual(expect.arrayContaining(['references/authoring.md', 'references/types/H5P.QuestionSet.md']))
  await page.goto('/h5p/skill/')
  const links = await page.locator(`main a[href^="${SITE}/h5p/skill/"]`).evaluateAll((anchors) =>
    anchors.map((anchor) => ({ href: anchor.getAttribute('href'), text: anchor.textContent?.trim() })))
  expect(links[0].href).toBe(`${SITE}/h5p/skill/SKILL.md`)
  expect(links.map(({ href }) => href).sort()).toEqual(files.map((file) => `${SITE}/h5p/skill/${file}`))
  for (const { href, text } of links) expect(text).toBe(href)

  const { version } = JSON.parse(await readFile(join(author, 'package.json'), 'utf8')) as { version: string }
  await expect(page.locator('main')).toContainText(`h5p-author ${version}`)
  const listing = await (await request.get('/h5p/skill/index.json')).json() as { author: string, files: string[] }
  expect(listing.author).toBe(version)
  expect(listing.files[0]).toBe('SKILL.md')
  expect([...listing.files].sort()).toEqual(files)
})

test('writes out the full address of the build tool and of every bundle the site serves, as its link and its text', async ({ page, request }) => {
  // The page names the bundles before Vite writes them; the listing is what Vite wrote.
  const listing = await (await request.get('/h5p/bundles/index.json')).json() as { tool: string, bundles: Array<{ file: string }> }
  expect(listing.bundles.length).toBeGreaterThan(40)
  await page.goto('/h5p/skill/')
  const links = await page.locator(`main a[href^="${SITE}/h5p/bundles/"]`).evaluateAll((anchors) =>
    anchors.map((anchor) => ({ href: anchor.getAttribute('href'), text: anchor.textContent?.trim() })))
  expect(links.map(({ href }) => href)).toEqual([listing.tool, ...listing.bundles.map(({ file }) => file)].map((file) => `${SITE}/h5p/bundles/${file}`))
  for (const { href, text } of links) expect(text).toBe(href)
})

test('serves each file at its address as the pinned author package carries it', async ({ request }) => {
  for (const file of await carried()) {
    const response = await request.get(`/h5p/skill/${file}`)
    expect(response.ok(), file).toBe(true)
    expect((await response.body()).equals(await readFile(join(author, file))), file).toBe(true)
  }
})

test('serves every address SKILL.md gives, relative to itself or on this site', async ({ request }) => {
  const skill = await (await request.get('/h5p/skill/SKILL.md')).text()
  const here = new URL(`${SITE}/h5p/skill/SKILL.md`)
  const relativeLinks = [...skill.matchAll(/\]\((?![a-z]+:|#)([^)\s]+)\)/g)].map(([, link]) => new URL(link, here).pathname)
  expect(relativeLinks).toEqual(expect.arrayContaining(['/h5p/skill/LICENSE', '/h5p/skill/references/authoring.md']))
  // Its addresses on this site, with a content type for the name it leaves to fill in, and no fragment.
  // Which they are moves with the release: since h5p-author 0.9.1 it names this page for a type's
  // file, where 0.9.0 named /h5p/build/types/<Type>.md (h5p-offline-player#180).
  const filled = skill.replace(/<type>/gi, 'H5P.QuestionSet')
  const onSite = [...new Set([...filled.matchAll(/https:\/\/missing-elements\.github\.io(\/[^\s`)>"'#]*)/g)].map(([, path]) => path))]
  expect(onSite).toEqual(expect.arrayContaining(['/h5p/bundles/H5P.QuestionSet.zip', '/h5p/build/']))
  for (const path of [...relativeLinks, ...onSite]) expect((await request.get(path)).ok(), path).toBe(true)
})
