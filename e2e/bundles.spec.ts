import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type APIRequestContext } from '@playwright/test'

/*
 * /h5p/bundles/ as a chat's sandbox uses it, following the h5p-author skill's steps: the command
 * line and one content type's bundle fetched into an empty folder outside this project, so nothing
 * installed here is found, unzipped and built with Node alone; and an addon the text calls for,
 * fetched as its own part once the build has named it.
 */

const exec = promisify(execFile)

type Listing = {
  author: string, pack: string, tool: string, parts: string, licences: string,
  bundles: Array<{ type: string, version: string, file: string, size: number, parts: number }>
}

const META = { language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }

/** A file of the site saved into the folder, as a chat's download tool saves it. */
async function fetchTo(request: APIRequestContext, path: string, file: string): Promise<void> {
  const response = await request.get(path)
  expect(response.ok(), path).toBe(true)
  await writeFile(file, await response.body())
}

/** The command line run in the folder, with the Node running the tests. */
const tool = (cwd: string, ...args: string[]) => exec(process.execPath, ['h5p-author.mjs', ...args], { cwd })

test('lists a bundle per content type, and serves each, every part on its own, the tool and the licences', async ({ request }) => {
  const listing = await (await request.get('/h5p/bundles/index.json')).json() as Listing
  expect(listing).toMatchObject({ author: expect.stringMatching(/^\d+\.\d+\.\d+$/), pack: expect.stringMatching(/^\d+\.\d+\.\d+$/), tool: 'h5p-author.mjs' })
  expect(listing.bundles.length).toBeGreaterThan(40)
  expect(listing.bundles.map(({ type }) => type)).toEqual(expect.arrayContaining(['H5P.QuestionSet', 'H5P.Blanks', 'H5P.CoursePresentation']))
  for (const { file, size } of listing.bundles) {
    const response = await request.head(`/h5p/bundles/${file}`)
    expect(response.ok(), file).toBe(true)
    expect(Number(response.headers()['content-length']), file).toBe(size)
  }

  const index = await (await request.get(`/h5p/bundles/${listing.parts}index.json`)).json() as { libraries: Array<{ folder: string }> }
  expect(index.libraries.length).toBeGreaterThan(100)
  for (const { folder } of index.libraries) expect((await request.head(`/h5p/bundles/${listing.parts}${folder}.h5p`)).ok(), folder).toBe(true)
  expect(await (await request.get(`/h5p/bundles/${listing.licences}`)).text()).toContain('H5P.QuestionSet-')
  expect(await (await request.get(`/h5p/bundles/${listing.tool}`)).text()).toMatch(/^#!\/usr\/bin\/env node\n/)
})

test('builds a quiz in an empty folder from the tool and its bundle, and takes an addon as its own part', async ({ request }) => {
  const dir = await mkdtemp(join(tmpdir(), 'embed-my-bundles-'))
  try {
    await fetchTo(request, '/h5p/bundles/h5p-author.mjs', join(dir, 'h5p-author.mjs'))
    await fetchTo(request, '/h5p/bundles/H5P.QuestionSet.zip', join(dir, 'H5P.QuestionSet.zip'))
    await exec('unzip', ['-q', 'H5P.QuestionSet.zip'], { cwd: dir })

    const quiz = {
      ...META,
      type: 'H5P.QuestionSet',
      title: 'Rivers',
      params: {
        questions: [
          { library: 'H5P.MultiChoice', params: { question: 'Which river is the longest in Europe?', answers: [{ text: 'Volga', correct: true }, { text: 'Danube', correct: false }] } },
          { library: 'H5P.TrueFalse', params: { question: 'The Rhine flows into the North Sea.', correct: 'true' } }
        ]
      }
    }
    await writeFile(join(dir, 'quiz.json'), JSON.stringify(quiz))
    const { stdout } = await tool(dir, 'build', 'quiz.json', 'quiz.h5p', '--libraries', 'parts')
    expect(stdout).toContain('Built ')
    const manifest = JSON.parse((await exec('unzip', ['-p', 'quiz.h5p', 'h5p.json'], { cwd: dir })).stdout) as { mainLibrary: string }
    expect(manifest.mainLibrary).toBe('H5P.QuestionSet')

    // Math in the text calls for H5P.MathDisplay, which no bundle holds: the build names its part.
    const squares = { ...quiz, title: 'Squares', params: { questions: [{ library: 'H5P.Blanks', params: { questions: ['The square of 3, $$3^2$$, is *9*.'] } }] } }
    await writeFile(join(dir, 'squares.json'), JSON.stringify(squares))
    const failed = await tool(dir, 'build', 'squares.json', 'squares.h5p', '--libraries', 'parts').then(() => null, (error: { code?: number, stderr?: string }) => error)
    expect(failed?.code).toBe(1)
    const part = /has no (\S+\.h5p)/.exec(failed?.stderr ?? '')?.[1]
    expect(part, failed?.stderr).toMatch(/^H5P\.MathDisplay-\d+\.\d+\.h5p$/)
    await fetchTo(request, `/h5p/bundles/parts/${part}`, join(dir, 'parts', part!))
    expect((await tool(dir, 'build', 'squares.json', 'squares.h5p', '--libraries', 'parts')).stdout).toContain('Built ')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
