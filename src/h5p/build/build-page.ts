import '@missing-elements/h5p-offline-player'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'
import { pack as installPack } from '@missing-elements/h5p-libraries/install'
import { runtime } from '@missing-elements/h5p-runtime'
import { forTheChat, matchFiles, namedFiles, packageName, parseSource, sized, sourceFromFragment, type Problem } from './build-source'

/**
 * The build page, `/h5p/build/`: a source an AI chat wrote with the h5p-author skill becomes a
 * `.h5p` file here, in the browser, for a chat whose sandbox cannot install the build tool
 * (ChatGPT's npm mirror was reported refusing installs). The build is
 * `@missing-elements/h5p-author/browser`, the same build as the command's; its libraries are
 * `@missing-elements/h5p-libraries/install`'s pack, which Vite emits into `/h5p/assets/` one part
 * per library, the build fetching only the parts a package needs. The package then plays in the
 * player on this page and downloads from it. Nothing leaves the browser: a link that carries a
 * source carries it in its fragment, `#source=`, which no server sees. The page's markup is
 * `index.njk` beside this file, and its styles are the site's own, in `site.css`.
 */

type Opened = Awaited<ReturnType<typeof openPack>>

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`The page has no #${id}`)
  return element as T
}

const sourceField = $<HTMLTextAreaElement>('source')
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
const notesBox = $('notes-box')
const notesList = $<HTMLUListElement>('notes')
const playStep = $('play-step')
const download = $<HTMLAnchorElement>('download')
const player = $('player') as HTMLElementTagNameMap['h5p-player']

player.runtime = runtime

/** The pack, opened at the first build and kept for the page's builds. */
let opened: Promise<Opened> | null = null
/** The files chosen so far, by name; a file chosen again under the same name replaces the first. */
const chosen = new Map<string, File>()
/** The problems last shown, for the copy button. */
let shownProblems: Problem[] = []
/** The address of the package last built, given back when the next one replaces it. */
let packageUrl: string | null = null
/** Counts builds, so that one overtaken by a newer one shows nothing. */
let builds = 0

function setStatus(text: string, state: 'idle' | 'building' | 'ready' | 'error'): void {
  status.textContent = text
  status.dataset.state = state
}

function fillList(list: HTMLUListElement, items: Problem[]): void {
  list.replaceChildren(...items.map(({ path, message }) => {
    const item = document.createElement('li')
    const where = document.createElement('code')
    where.textContent = path
    item.append(where, ` ${message}`)
    return item
  }))
}

function showProblems(problems: Problem[]): void {
  shownProblems = problems
  fillList(problemsList, problems)
  problemsBox.hidden = problems.length === 0
  copyResult.textContent = ''
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
      showProblems(problems)
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

let typing: ReturnType<typeof setTimeout> | undefined
sourceField.addEventListener('input', () => {
  clearTimeout(typing)
  typing = setTimeout(updateFiles, 300)
})

sourceFile.addEventListener('change', async () => {
  const file = sourceFile.files?.[0]
  if (!file) return
  sourceField.value = await file.text()
  updateFiles()
})

filesInput.addEventListener('change', () => {
  for (const file of filesInput.files ?? []) chosen.set(file.name, file)
  filesInput.value = ''
  updateFiles()
})

buildButton.addEventListener('click', () => void build())

copyProblems.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(forTheChat(shownProblems))
    copyResult.textContent = 'Copied.'
  } catch {
    copyResult.textContent = 'The browser did not allow copying; select the list and copy it.'
  }
})

/** A link's source is built at once, unless it names files, which only the person can choose. */
async function fromLink(): Promise<void> {
  let text: string | null
  try {
    text = await sourceFromFragment(location.hash)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error')
    return
  }
  if (text === null) return
  sourceField.value = text
  const paths = updateFiles()
  if (paths.length) setStatus('The source names files: choose them, then Build.', 'idle')
  else await build()
}

updateFiles()
void fromLink()
window.addEventListener('hashchange', () => void fromLink())
