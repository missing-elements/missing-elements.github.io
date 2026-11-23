import '@missing-elements/h5p-offline-player'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'
import { pack as installPack } from '@missing-elements/h5p-libraries/install'
import { runtime } from '@missing-elements/h5p-runtime'
import { baseName, matchFiles, namedFiles, packageName, parseSource, sized, sourceFromFragment, type Problem } from '../build/build-source'

/**
 * The play page, `/h5p/play/`: the activity in a link's `#source=` built in the browser, as the
 * build page builds it, and played, with nothing else on the page but its file to download and a
 * way to the build page. A chat app frames it to show the activity in a reply (h5p-toolkit#210).
 * Framed, it tells the frame's parent its height, and gives it the built file, which a parent that
 * may not let the frame download can save its own way. Nothing leaves the browser otherwise.
 *
 * A source that names files of the person's own, a video beside it, is asked for them here: the
 * person chooses them from their computer or drops them, or the frame's parent gives them, and the
 * activity is built once they are all here. A chat app was found to hand a card no file the person
 * attached (ChatGPT, 2026-11-20: the tool got a piece of text in the file's place), so the page
 * asks itself. A file chosen here goes nowhere: the build reads it in the browser.
 *
 * What is seen is one stage, in one of five states (`data-state` on `main`): `building`, a loader
 * over the place the player takes; `fetching`, the loader with how much of a file the parent has
 * brought so far; `asking`, for the person's files; `error`, with the one thing to do about it;
 * `ready`, the player. The parent is told each as a `status`, in words a screen reader is told too.
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const main = $('main')
const status = $('status')
const label = $('label')
const note = $('note')
const progress = $('progress')
const progressBar = $('progress-bar')
const instead = $<HTMLButtonElement>('instead')
const loader = $('loader')
const filesBox = $('files-box')
const askTitle = $('ask-title')
const askText = $('ask-text')
const choose = $<HTMLButtonElement>('choose')
const filesInput = $<HTMLInputElement>('files')
const errorBox = $('error')
const errorTitle = $('error-title')
const errorText = $('error-text')
const fix = $<HTMLAnchorElement>('fix')
const playerBox = $('player-box')
const title = $('title')
const meta = $('meta')
const download = $<HTMLAnchorElement>('download')
const edit = $<HTMLAnchorElement>('edit')
const player = $('player') as HTMLElementTagNameMap['h5p-player']
player.runtime = runtime

type State = 'building' | 'fetching' | 'asking' | 'ready' | 'error'
type Opened = Awaited<ReturnType<typeof openPack>>
/** The pack, opened at the first build and kept for the next, which a file chosen later starts. */
let opened: Promise<Opened> | null = null
/** The source the link carries, once read, and the files it names. */
let source: unknown
let wanted: string[] = []
/** The files given so far, by name. */
const chosen = new Map<string, File>()
/** The address of the package last built, given back when the next one replaces it. */
let packageUrl: string | null = null
/** Counts builds, so that one overtaken by a newer one shows nothing. */
let builds = 0
/** The missing names the parent was last told, so that it is told again only when they change. */
let told = ''

const framed = window.parent !== window
if (!framed) document.documentElement.dataset.standalone = ''
const toParent = (message: Record<string, unknown>): void => { if (framed) window.parent.postMessage({ source: 'h5p-play', ...message }, '*') }

/** The state drawn, and its words, for a screen reader and for the parent. */
function show(state: State, text: string): void {
  main.dataset.state = state
  loader.hidden = state !== 'building' && state !== 'fetching'
  filesBox.hidden = state !== 'asking'
  errorBox.hidden = state !== 'error'
  // The way to the build page is the problem's own button where it has one.
  edit.hidden = state === 'error' && !fix.hidden
  if (status.textContent !== text) status.textContent = text
  status.dataset.state = state
  toParent({ type: 'status', state, text })
}

/** The loader, with what is being done. */
function busy(text: string): void {
  label.textContent = text
  progress.hidden = true
  instead.hidden = true
  note.textContent = 'Nothing is sent to a server.'
  show('building', text)
}

/** A problem, in a heading and a line, with the build page to fix it in where that helps. */
function fail(heading: string, text: string, fixable = false): void {
  errorTitle.textContent = heading
  errorText.textContent = text
  fix.hidden = !fixable
  show('error', `${heading}. ${text}`)
}

/** What the activity is, under the stage: its title, and its type with the package's size once built. */
function about(name: unknown, type: unknown, size?: number): void {
  if (typeof name === 'string' && name.trim()) title.textContent = name
  // "H5P.InteractiveVideo 1.27" as "Interactive Video".
  const typed = typeof type === 'string' ? type.replace(/^H5P\./, '').replace(/\s[\d.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : ''
  const parts = [typed, size === undefined ? '' : sized(size)].filter(Boolean)
  if (parts.length) meta.textContent = parts.join(' · ')
}

// The build page, with the same source, where its problems can be fixed and its files chosen.
edit.href = fix.href = `/h5p/build/${location.hash}`

// The page's height for the parent, which sizes its frame to it.
if (framed) new ResizeObserver(() => toParent({ type: 'height', height: Math.ceil(document.documentElement.getBoundingClientRect().height) })).observe(document.body)

/** A file's kind, by the ending of its name. */
const kind = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()
/** What a person calls a file of that kind. */
const called = (name: string): string => /^(mp4|webm|ogv|mov)$/.test(kind(name)) ? 'video' : /^(mp3|m4a|wav|ogg|oga)$/.test(kind(name)) ? 'recording' : /^(png|jpe?g|gif|bmp)$/.test(kind(name)) ? 'picture' : 'file'

/**
 * The given files for the paths the source names, matched by name as the build page matches them.
 * Where it names one file and one of the same kind was given, that is the file whatever it is
 * called: a chat may write the name its own way, and the source cannot be changed here.
 */
function filesFor(paths: string[]): { files: Record<string, File>, missing: string[] } {
  const given = [...chosen.values()]
  const matched = matchFiles(paths, given)
  const [path] = paths
  const [file] = given
  if (matched.missing.length && paths.length === 1 && given.length === 1 && path !== undefined && file !== undefined && kind(path) === kind(file.name)) {
    return { files: { [path]: file }, missing: [] }
  }
  return matched
}

/**
 * Asks for the files still missing, by their names, and tells the parent, which may have them. The
 * parent is told once for a set of names: one that answers each time with the same files, some of
 * them or none that match, would otherwise be asked again with every answer, without end.
 */
function ask(missing: string[]): void {
  const names = missing.map(baseName)
  const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(names)
  const one = missing.length === 1
  askTitle.textContent = one ? `Add your ${called(names[0]!)}` : 'Add your files'
  askText.textContent = chosen.size ? `Still needed: ${listed}.` : `This activity uses ${listed}. ${one ? 'It stays' : 'They stay'} in your browser.`
  choose.textContent = one ? 'Choose the file' : 'Choose the files'
  filesInput.accept = [...new Set(missing.map((path) => `.${kind(path)}`))].join(',')
  show('asking', chosen.size
    ? `Still needed: ${listed}.`
    : `This activity uses ${one ? 'a file' : 'files'} of yours: ${listed}. Choose ${one ? 'it' : 'them'} from your computer; ${one ? 'it stays' : 'they stay'} in your browser.`)
  const missingNow = names.join('\n')
  if (missingNow === told) return
  told = missingNow
  toParent({ type: 'needs-files', names })
}

/**
 * A file on its way from the parent, which holds what the person attached in the chat: how much
 * has come, drawn as a bar where its size is known. The person can still choose the file from
 * their computer, which needs no wait. Told a screen reader once, not with every number.
 */
function fetching(name: string, received: number, total: number): void {
  if (main.dataset.state !== 'asking' && main.dataset.state !== 'fetching') return
  const what = wanted.length === 1 ? called(name || wanted[0]!) : 'file'
  label.textContent = `Getting your ${what}… ${sized(received)}${total > 0 ? ` of ${sized(total)}` : ''}`
  note.textContent = 'From the chat to your browser, nowhere else.'
  const done = total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0
  progress.hidden = total <= 0
  progress.setAttribute('aria-valuenow', String(done))
  progressBar.style.setProperty('--done', `${done}%`)
  instead.hidden = false
  if (main.dataset.state !== 'fetching') show('fetching', `Getting your ${what} from the chat.`)
}

/** Files given, by the person or by the parent: the activity is built once none is missing. */
function take(files: File[]): void {
  if (!files.length || !wanted.length) return
  // Where one file is named, a second choice replaces the first.
  if (wanted.length === 1) chosen.clear()
  for (const file of files) chosen.set(file.name, file)
  void play()
}

async function play(): Promise<void> {
  const build = ++builds
  const { files, missing } = filesFor(wanted)
  if (missing.length) return ask(missing)
  busy('Building the activity in your browser…')
  try {
    opened ??= openPack(installPack)
    const result = await buildPackage(source, { libraries: await opened, files })
    if (build !== builds) return
    const name = packageName(String(result.manifest.title ?? ''))
    if (packageUrl) URL.revokeObjectURL(packageUrl)
    packageUrl = URL.createObjectURL(result.blob)
    download.href = packageUrl
    download.download = name
    download.hidden = false
    about(result.manifest.title, result.builtWith, result.blob.size)
    const file = new File([result.blob], name, { type: 'application/zip' })
    toParent({ type: 'built', file, title: result.manifest.title, size: sized(result.blob.size) })
    busy('Starting the activity…')
    playerBox.hidden = false
    player.file = file
  } catch (error) {
    if (build !== builds) return
    if (error instanceof SourceError) {
      const count = (error as SourceError & { problems: Problem[] }).problems.length
      return fail(`The activity has ${count} problem${count === 1 ? '' : 's'}`, `Open it in the build page to see and fix ${count === 1 ? 'it' : 'them'}.`, true)
    }
    // A pack that could not open is opened again at the next build.
    opened = null
    fail('It could not be built', error instanceof Error ? error.message : String(error))
  }
}

async function start(): Promise<void> {
  let text: string | null
  try {
    text = await sourceFromFragment(location.hash)
  } catch {
    return fail('The link is damaged', 'Its activity cannot be read. Ask the chat for it again.')
  }
  if (text === null) return fail('The link carries no activity', 'This page plays the one an AI chat put in its link.')
  const parsed = parseSource(text)
  if ('problem' in parsed) return fail('The activity cannot be read', 'Open it in the build page to see why.', true)
  source = parsed.source
  wanted = namedFiles(source)
  const written = source as { title?: unknown, type?: unknown }
  about(written.title, written.type)
  await play()
}

player.addEventListener('ready', () => show('ready', `“${title.textContent}” is ready.`))
player.addEventListener('error', (event) => {
  if (player.state === 'ready') return
  fail('It was built, but does not play', (event as unknown as CustomEvent<{ message: string }>).detail.message, true)
})

// The file field is hidden, and the buttons open it.
choose.addEventListener('click', () => filesInput.click())
instead.addEventListener('click', () => filesInput.click())
filesInput.addEventListener('change', () => {
  const files = [...(filesInput.files ?? [])]
  filesInput.value = ''
  take(files)
})
// A file dropped on the stage while it is asked for, as one chosen.
const asked = (): boolean => main.dataset.state === 'asking' || main.dataset.state === 'fetching'
main.addEventListener('dragover', (event) => {
  if (!asked() || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  main.dataset.drop = ''
})
main.addEventListener('dragleave', (event) => { if (!main.contains(event.relatedTarget as Node | null)) delete main.dataset.drop })
main.addEventListener('drop', (event) => {
  delete main.dataset.drop
  if (!asked() || !event.dataTransfer?.files.length) return
  event.preventDefault()
  take([...event.dataTransfer.files])
})

// From the frame's parent, which may hold what the person attached in the chat: the files, how
// much of one has come so far, and the chat's theme where it is not the system's.
window.addEventListener('message', (event) => {
  if (!framed || event.source !== window.parent) return
  const message = event.data as { source?: unknown, type?: unknown, files?: unknown, name?: unknown, received?: unknown, total?: unknown, theme?: unknown } | null
  if (message?.source !== 'h5p-play-host') return
  if (message.type === 'files' && Array.isArray(message.files)) take(message.files.filter((file): file is File => file instanceof File))
  else if (message.type === 'progress' && typeof message.received === 'number') fetching(typeof message.name === 'string' ? message.name : '', message.received, typeof message.total === 'number' ? message.total : 0)
  else if (message.type === 'theme' && (message.theme === 'light' || message.theme === 'dark')) document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content = message.theme
})

void start()
window.addEventListener('hashchange', () => location.reload())
