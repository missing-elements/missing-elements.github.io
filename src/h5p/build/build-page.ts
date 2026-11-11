import '@missing-elements/h5p-offline-player'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'
import { pack as installPack } from '@missing-elements/h5p-libraries/install'
import { runtime } from '@missing-elements/h5p-runtime'
import { compactSource, forTheChat, fragmentFromSource, linksSource, matchFiles, namedFiles, packageName, parseSource, sized, sourceFromFragment, typesNamed, type Problem, type TypeFile } from './build-source'
import type { SourceEditor } from './editor'
import { formatSource, jsonProblem, place, type Target } from './json-scan'

/**
 * The build page, `/h5p/build/`: a source an AI chat wrote with the h5p-author skill becomes a
 * `.h5p` file here, in the browser, for a chat whose sandbox cannot install the build tool
 * (ChatGPT's npm mirror was reported refusing installs). The build is
 * `@missing-elements/h5p-author/browser`, the same build as the command's; its libraries are
 * `@missing-elements/h5p-libraries/install`'s pack, which Vite emits into `/h5p/assets/` one part
 * per library, the build fetching only the parts a package needs. The package then plays in the
 * player on this page and downloads from it. Nothing leaves the browser: a link that carries a
 * source carries it in its fragment, `#source=`, which no server sees, and the page keeps that
 * fragment in step with the source as the person changes it. A source with problems gets them
 * listed, and copied for the chat with the skill's type files, which this site serves beside the
 * page (`TYPES`). The source is edited in an editor (`editor.ts`), loaded apart, in place of the
 * textarea, which stays under it as the field this page reads, and it arrives laid out. The page's
 * markup is `index.njk` beside this file, and its styles are the site's own, in `site.css`.
 */

type Opened = Awaited<ReturnType<typeof openPack>>

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`The page has no #${id}`)
  return element as T
}

const sourceField = $<HTMLTextAreaElement>('source')
const sourceLabel = $('source-label')
const sourceState = $('source-state')
const sourceFile = $<HTMLInputElement>('source-file')
const filesStep = $('files-step')
const fileList = $<HTMLUListElement>('file-list')
const filesInput = $<HTMLInputElement>('files')
const buildButton = $<HTMLButtonElement>('build')
const buildNumber = $('build-number')
const playNumber = $('play-number')
const status = $('status')
const problemsBox = $('problems-box')
const problemsList = $<HTMLUListElement>('problems')
const copyProblems = $<HTMLButtonElement>('copy-problems')
const copyResult = $('copy-result')
const copyTypes = $('copy-types')
const notesBox = $('notes-box')
const notesList = $<HTMLUListElement>('notes')
const playStep = $('play-step')
const download = $<HTMLAnchorElement>('download')
const player = $('player') as HTMLElementTagNameMap['h5p-player']

player.runtime = runtime

/** The editor the source is in, once it has loaded; until then, and where it cannot, the textarea. */
let editor: SourceEditor | null = null
/** The pack, opened at the first build and kept for the page's builds. */
let opened: Promise<Opened> | null = null
/** The files chosen so far, by name; a file chosen again under the same name replaces the first. */
const chosen = new Map<string, File>()
/** The problems last shown, for the copy button. */
let shownProblems: Problem[] = []
/** Where the site serves the h5p-author skill's type files, and the list of them (vite.config.ts). */
const TYPES = '/h5p/build/types/'
/** The type files there are, asked for once, and each one's text as it was fetched. */
let typeIndex: Promise<Set<string>> | null = null
const typeTexts = new Map<string, Promise<string>>()
/** The type files of the problems shown, once they are here, and the fetch that brings them. */
let shownTypeFiles: TypeFile[] = []
let typeFilesArriving: Promise<void> | null = null
/** Counts the lists of problems shown, so that type files fetched for an earlier one are dropped. */
let shows = 0
/** The address of the package last built, given back when the next one replaces it. */
let packageUrl: string | null = null
/** Counts builds, so that one overtaken by a newer one shows nothing. */
let builds = 0
/** Whether the address carries a source, which it then keeps in step with the source as it changes. */
let linked = false
/** The source the address carries, as `compactSource` has it: `''` for none, or none that can be read. */
let carried = ''
/** Counts the writes of the address, so that one overtaken by a newer change writes nothing. */
let linkWrites = 0

function setStatus(text: string, state: 'idle' | 'building' | 'ready' | 'error'): void {
  status.textContent = text
  status.dataset.state = state
}

/** Where a problem is in the source, for the button that goes there: its place in the text, or none. */
function target({ path, at }: Problem): Target {
  return at === undefined ? { path } : { at }
}

/** Selects where a target is in the source, in the editor or, where it has not loaded, the textarea. */
function goTo(where: Target): boolean {
  if (editor) return editor.goTo(where)
  const range = place(sourceField.value, where)
  if (!range) return false
  sourceField.focus()
  sourceField.setSelectionRange(range.from, range.to)
  return true
}

/** The list's items, each problem's path a button that goes where it is in the source, where it is anywhere. */
function fillList(list: HTMLUListElement, items: Problem[], jump = false): void {
  list.replaceChildren(...items.map((problem) => {
    const item = document.createElement('li')
    const where = document.createElement('code')
    where.textContent = problem.path
    if (jump && place(sourceField.value, target(problem))) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'jump'
      button.title = 'Show where it is in the source'
      button.append(where)
      button.addEventListener('click', () => goTo(target(problem)))
      item.append(button, ` ${problem.message}`)
    } else {
      item.append(where, ` ${problem.message}`)
    }
    return item
  }))
}

/**
 * The type files of the content types a source is written in, of those the skill has a file for:
 * what the chat that wrote it lacked. None where they cannot be fetched, and the problems are then
 * copied without them.
 */
async function typeFilesOf(source: unknown): Promise<TypeFile[]> {
  if (!source || typeof source !== 'object') return []
  const fetched = async (path: string): Promise<Response> => {
    const response = await fetch(`${TYPES}${path}`)
    if (!response.ok) throw new Error(`${path}: ${response.status}`)
    return response
  }
  try {
    typeIndex ??= fetched('index.json').then(async (response) => new Set((await response.json() as { types: string[] }).types))
    // The listed types are what a name is read against, as it is or as it is spoken of.
    const names = typesNamed(source, await typeIndex)
    return await Promise.all(names.map(async (type) => {
      let text = typeTexts.get(type)
      if (!text) typeTexts.set(type, text = fetched(`${type}.md`).then((response) => response.text()))
      return { type, text: await text }
    }))
  } catch {
    // Asked for again with the next problems.
    typeIndex = null
    typeTexts.clear()
    return []
  }
}

/**
 * Lists the problems. With the source they are of, its type files are fetched at once, so that the
 * copy button has them when it is pressed: a browser lets a page write to the clipboard only
 * within the press.
 */
function showProblems(problems: Problem[], source?: unknown): void {
  const show = ++shows
  shownProblems = problems
  shownTypeFiles = []
  fillList(problemsList, problems, true)
  editor?.mark(problems)
  problemsBox.hidden = problems.length === 0
  copyResult.textContent = ''
  copyTypes.hidden = true
  typeFilesArriving = problems.length && source !== undefined
    ? typeFilesOf(source).then((files) => {
        if (show !== shows) return
        shownTypeFiles = files
        typeFilesArriving = null
        const names = new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(files.map(({ type }) => type))
        copyTypes.textContent = `The copy also carries the skill’s notes on ${names}, with ${files.length === 1 ? 'its' : 'their'} fields and an example, so the chat does not have to guess.`
        copyTypes.hidden = files.length === 0
      })
    : null
}

function showNotes(notes: Problem[]): void {
  fillList(notesList, notes)
  notesBox.hidden = notes.length === 0
}

/** The step numbers, with the Files step shown or not. */
function number(withFiles: boolean): void {
  filesStep.hidden = !withFiles
  buildNumber.textContent = withFiles ? '3' : '2'
  playNumber.textContent = withFiles ? '4' : '3'
}

/** The source's files, each marked chosen or not; the step is shown only for a source that names some. */
function updateFiles(): string[] {
  const parsed = parseSource(sourceField.value)
  const paths = 'source' in parsed ? namedFiles(parsed.source) : []
  const { files } = matchFiles(paths, [...chosen.values()])
  fileList.replaceChildren(...paths.map((path) => {
    const item = document.createElement('li')
    const name = document.createElement('code')
    name.textContent = path
    const file = files[path]
    item.dataset.chosen = String(Boolean(file))
    item.append(name, file ? ` chosen, ${sized(file.size)}` : ' not chosen yet')
    return item
  }))
  number(paths.length > 0)
  return paths
}

/** What the build says beyond its notes: interface texts it could not translate. */
function translationNotes(language: string, translations: Awaited<ReturnType<typeof buildPackage>>['translations']): Problem[] {
  if (/^en(?:-|$)/i.test(language)) return []
  const notes: Problem[] = []
  for (const { library, translation, strings, english } of translations) {
    if (!translation) notes.push({ path: library, message: `has no translation for ${language}: its ${strings} interface texts are English.` })
    else if (english.length) notes.push({ path: library, message: `${english.length} of ${strings} interface texts are as in English, untranslated or the same word: ${english.map(({ field }) => field).join(', ')}.` })
  }
  return notes
}

async function build(): Promise<void> {
  const run = ++builds
  showProblems([])
  showNotes([])
  const parsed = parseSource(sourceField.value)
  if ('problem' in parsed) {
    setStatus('The source cannot be read.', 'error')
    showProblems([parsed.problem])
    return
  }
  const { files } = matchFiles(updateFiles(), [...chosen.values()])
  setStatus('Building…', 'building')
  buildButton.disabled = true
  try {
    opened ??= openPack(installPack)
    const libraries = await opened
    const result = await buildPackage(parsed.source, { libraries, files })
    if (run !== builds) return
    const title = String(result.manifest.title ?? '')
    const name = packageName(title)
    if (packageUrl) URL.revokeObjectURL(packageUrl)
    packageUrl = URL.createObjectURL(result.blob)
    download.href = packageUrl
    download.download = name
    download.textContent = `Download ${name}`
    showNotes([...result.notes, ...translationNotes(String(result.manifest.language ?? ''), result.translations)])
    const media = result.media.length ? `, ${result.media.length} media file${result.media.length === 1 ? '' : 's'}` : ''
    setStatus(`Built “${title}”: ${String(result.manifest.mainLibrary)}, ${result.libraries.length} libraries${media}, ${sized(result.blob.size)}. Starting it below…`, 'building')
    playStep.hidden = false
    player.file = new File([result.blob], name, { type: 'application/zip' })
  } catch (error) {
    if (run !== builds) return
    if (error instanceof SourceError) {
      const problems = (error as SourceError & { problems: Problem[] }).problems
      setStatus(`The source has ${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing was built.`, 'error')
      showProblems(problems, parsed.source)
    } else {
      setStatus(`The build failed: ${error instanceof Error ? error.message : error}`, 'error')
      // A pack that could not open is opened again at the next build.
      opened = null
    }
  } finally {
    if (run === builds) buildButton.disabled = false
  }
}

player.addEventListener('ready', () => {
  if (status.dataset.state !== 'building') return
  setStatus(status.textContent!.replace(/ Starting it below…$/, ' It plays below.'), 'ready')
})
player.addEventListener('error', (event) => {
  const { message } = (event as unknown as CustomEvent<{ message: string }>).detail
  if (player.state === 'ready') return // the content runs on; the frame logs it
  setStatus(`It was built, but does not play: ${message}`, 'error')
})

/** Says where the source stops being JSON, if it does, as it is typed, and what it names. */
function checkSource(): void {
  const problem = jsonProblem(sourceField.value)
  sourceState.dataset.state = problem ? 'error' : ''
  if (!problem) {
    sourceState.replaceChildren()
    return
  }
  const nodes: (string | HTMLElement)[] = [`Not valid JSON ${problem.message}`]
  if (problem.at !== undefined) {
    const at = problem.at
    const show = document.createElement('button')
    show.type = 'button'
    show.className = 'link-button'
    show.textContent = 'Show where'
    show.addEventListener('click', () => goTo({ at }))
    nodes.push(' ', show)
  }
  sourceState.replaceChildren(...nodes)
}

/**
 * Where the address carries a source, it carries the one that is here: written once the source is
 * JSON and is another source than the address has, not for a change of layout, and not while the
 * text is not JSON, when the address keeps the last that was. It is replaced, not added to the
 * history, and the page does not read it again: only a visit to another address does.
 */
async function followInAddress(): Promise<void> {
  if (!linked) return
  const write = ++linkWrites
  const now = compactSource(sourceField.value)
  if (now === null || now === carried) return
  const fragment = await fragmentFromSource(now)
  if (write !== linkWrites) return
  try {
    const url = new URL(location.href)
    url.hash = fragment
    history.replaceState(history.state, '', url)
    carried = now
  } catch {
    // Safari allows a hundred of these in thirty seconds: the next change to the source writes it.
  }
}

let typing: ReturnType<typeof setTimeout> | undefined
let following: ReturnType<typeof setTimeout> | undefined
/** The address follows the source once its changes pause, which spares the browser a write for each key. */
function followLater(): void {
  clearTimeout(following)
  following = setTimeout(() => void followInAddress(), 600)
}
/** The source changed, by typing or by the editor: what it says is looked at once the typing pauses. */
function sourceChanged(): void {
  clearTimeout(typing)
  typing = setTimeout(() => {
    checkSource()
    updateFiles()
  }, 300)
  followLater()
}
sourceField.addEventListener('input', sourceChanged)

/** The source replaced, as by a file or a link: laid out, in the editor if it is there, and always in the textarea. */
function setSource(text: string): void {
  const arrived = formatSource(text) ?? text
  sourceField.value = arrived
  editor?.set(arrived)
  checkSource()
  updateFiles()
  followLater()
}

// Where the editor has not loaded, a source pasted whole is laid out here, as the editor does it.
sourceField.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain')
  const laidOut = text && sourceField.selectionStart === 0 && sourceField.selectionEnd === sourceField.value.length ? formatSource(text) : null
  if (laidOut === null) return
  event.preventDefault()
  sourceField.value = laidOut
  sourceField.setSelectionRange(0, 0)
  sourceChanged()
})

sourceFile.addEventListener('change', async () => {
  const file = sourceFile.files?.[0]
  if (!file) return
  setSource(await file.text())
})

// The label is for the textarea, which the editor hides: a click on it goes to the editor.
sourceLabel.addEventListener('click', () => editor?.focus())

filesInput.addEventListener('change', () => {
  for (const file of filesInput.files ?? []) chosen.set(file.name, file)
  filesInput.value = ''
  updateFiles()
})

buildButton.addEventListener('click', () => void build())

copyProblems.addEventListener('click', async () => {
  try {
    // Only where the button is pressed before the type files are here, which takes a moment.
    while (typeFilesArriving) await typeFilesArriving
    await navigator.clipboard.writeText(forTheChat(shownProblems, shownTypeFiles))
    copyResult.textContent = 'Copied.'
  } catch {
    copyResult.textContent = 'The browser did not allow copying; select the list and copy it.'
  }
})

/** A link's source is built at once, unless it names files, which only the person can choose. */
async function fromLink(): Promise<void> {
  // A link of this kind is kept in step with the source from here on, whether or not it can be read.
  linked = linksSource(location.hash)
  carried = ''
  let text: string | null
  try {
    text = await sourceFromFragment(location.hash)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error')
    return
  }
  if (text === null) return
  carried = compactSource(text) ?? ''
  setSource(text)
  const paths = updateFiles()
  if (paths.length) setStatus('The source names files: choose them, then Build.', 'idle')
  else await build()
}

updateFiles()
void fromLink()
window.addEventListener('hashchange', () => void fromLink())

// The editor is loaded apart: where it cannot be, the textarea is the source, as it was.
import('./editor').then(({ mountEditor }) => {
  editor = mountEditor(sourceField, sourceChanged)
}).catch((error: unknown) => {
  console.warn('The source editor did not load; the source stays a plain text field.', error)
})
