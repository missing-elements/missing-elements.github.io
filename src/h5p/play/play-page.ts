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
 * person chooses them from their computer, or the frame's parent gives them, and the activity is
 * built once they are all here. A chat app was found to hand a card no file the person attached
 * (ChatGPT, 2026-11-20: the tool got a piece of text in the file's place), so the page asks itself.
 * A file chosen here goes nowhere: the build reads it in the browser.
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const status = $('status')
const filesBox = $('files-box')
const choose = $<HTMLButtonElement>('choose')
const filesInput = $<HTMLInputElement>('files')
const playerBox = $('player-box')
const download = $<HTMLAnchorElement>('download')
const edit = $<HTMLAnchorElement>('edit')
const player = $('player') as HTMLElementTagNameMap['h5p-player']
player.runtime = runtime

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

const framed = window.parent !== window
const toParent = (message: Record<string, unknown>): void => { if (framed) window.parent.postMessage({ source: 'h5p-play', ...message }, '*') }

function say(text: string, state: 'building' | 'asking' | 'ready' | 'error'): void {
  status.textContent = text
  status.dataset.state = state
  toParent({ type: 'status', state, text })
}

// The build page, with the same source, where its problems can be fixed and its files chosen.
edit.href = `/h5p/build/${location.hash}`

// The page's height for the parent, which sizes its frame to it.
if (framed) new ResizeObserver(() => toParent({ type: 'height', height: Math.ceil(document.documentElement.getBoundingClientRect().height) })).observe(document.body)

/** A file's kind, by the ending of its name. */
const kind = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

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

/** Asks for the files still missing, by their names, and tells the parent, which may have them. */
function ask(missing: string[]): void {
  const names = missing.map(baseName)
  const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(names)
  const one = missing.length === 1
  choose.textContent = one ? 'Choose the file' : 'Choose the files'
  filesInput.accept = [...new Set(missing.map((path) => `.${kind(path)}`))].join(',')
  filesBox.hidden = false
  say(chosen.size
    ? `Still needed: ${listed}.`
    : `This activity uses ${one ? 'a file' : 'files'} of yours: ${listed}. Choose ${one ? 'it' : 'them'} from your computer; ${one ? 'it stays' : 'they stay'} in your browser.`, 'asking')
  toParent({ type: 'needs-files', names })
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
  filesBox.hidden = true
  say('Building the activity in your browser…', 'building')
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
    const file = new File([result.blob], name, { type: 'application/zip' })
    toParent({ type: 'built', file, title: result.manifest.title, size: sized(result.blob.size) })
    say(`“${String(result.manifest.title ?? name)}”, ${sized(result.blob.size)}. Starting it…`, 'building')
    playerBox.hidden = false
    player.file = file
  } catch (error) {
    if (build !== builds) return
    if (error instanceof SourceError) {
      const problems = (error as SourceError & { problems: Problem[] }).problems
      return say(`The activity has ${problems.length} problem${problems.length === 1 ? '' : 's'}: open it in the build page to see and fix ${problems.length === 1 ? 'it' : 'them'}.`, 'error')
    }
    // A pack that could not open is opened again at the next build.
    opened = null
    say(`It could not be built: ${error instanceof Error ? error.message : error}`, 'error')
  }
}

async function start(): Promise<void> {
  let text: string | null
  try {
    text = await sourceFromFragment(location.hash)
  } catch {
    return say('The link is damaged: its activity cannot be read. Ask the chat for it again.', 'error')
  }
  if (text === null) return say('The link carries no activity. This page plays the one an AI chat put in its link.', 'error')
  const parsed = parseSource(text)
  if ('problem' in parsed) return say('The activity in the link cannot be read. Open it in the build page to see why.', 'error')
  source = parsed.source
  wanted = namedFiles(source)
  await play()
}

player.addEventListener('ready', () => say(status.textContent!.replace(/ Starting it…$/, ''), 'ready'))
player.addEventListener('error', (event) => {
  if (player.state === 'ready') return
  say(`It was built, but does not play: ${(event as unknown as CustomEvent<{ message: string }>).detail.message}`, 'error')
})

// The file field is hidden, and the button opens it.
choose.addEventListener('click', () => filesInput.click())
filesInput.addEventListener('change', () => {
  const files = [...(filesInput.files ?? [])]
  filesInput.value = ''
  take(files)
})
// Files from the frame's parent, which may hold what the person attached in the chat.
window.addEventListener('message', (event) => {
  if (!framed || event.source !== window.parent) return
  const message = event.data as { source?: unknown, type?: unknown, files?: unknown } | null
  if (message?.source !== 'h5p-play-host' || message.type !== 'files' || !Array.isArray(message.files)) return
  take(message.files.filter((file): file is File => file instanceof File))
})

void start()
window.addEventListener('hashchange', () => location.reload())
