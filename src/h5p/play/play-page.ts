import '@missing-elements/h5p-offline-player'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'
import { pack as installPack } from '@missing-elements/h5p-libraries/install'
import { runtime } from '@missing-elements/h5p-runtime'
import { baseName, kindOf, matchFiles, matchNamed, namedFiles, packageName, parseSource, sized, sourceFromFragment, type Problem } from '../build/build-source'

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
 * A video or a recording the parent holds can come as its address instead of its bytes (#92): the
 * activity is built with it left there (h5p-author's `linked`) and plays at once, the browser asking
 * the address for the parts it shows. Such a package is a preview, since the address expires, so
 * Download asks the parent for the bytes, shows them coming under the stage while the activity plays
 * on, and builds the package to keep with the file in it.
 *
 * A frame may be let save nothing: a chat's card was found to drop the download of this page's own
 * link with nothing said (ChatGPT, 2026-11-23), while the card itself could ask the chat to save a
 * file. So a parent that saves files says so (#98), with the most it takes, and Download then hands
 * it the package and says under the stage how that went. A package bigger than that is not handed
 * over, and a video that would make one is not fetched for it: the build page, in a tab of its
 * own, is offered, where the person chooses the file and downloads as anywhere.
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
const downloadLabel = $('download-label')
const keepBox = $('keep')
const keepLabel = $('keep-label')
const keepProgress = $('keep-progress')
const keepBar = $('keep-bar')
const keepInstead = $<HTMLButtonElement>('keep-instead')
const keepOpen = $<HTMLAnchorElement>('keep-open')
const announcer = document.querySelector<HTMLElement>('[data-status="page"]')
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
/** The addresses the parent gave for files it holds, by name: played from there, none of their bytes read. */
const links = new Map<string, string>()
/** The names the source gives the files the package last built plays from an address: a preview. */
let previewed: string[] = []
/** Whether Download was pressed on a preview, and its package is not saved yet. */
let keeping = false
/** Whether the parent was asked for the bytes of those files, and has not brought them yet. */
let bringing = false
/** Whether the package to keep is being built: one at a time. */
let packing = false
/** Whether the package that plays has its files in it. Files that come after that change nothing. */
let whole = false
/** That package, as a file, for a parent that saves it. */
let kept: File | null = null
/** The most bytes the parent saves of a file it is handed, where it saves files itself; null where this page does. */
let hostSaves: number | null = null
/** Whether a file was handed to the parent to save, and it has not said how that went. */
let handed = false
/** Whether one ever was: a yes that comes after the wait for it ended is still said. */
let everHanded = false
let handedTimer: ReturnType<typeof setTimeout> | undefined
/** The address each file of the preview plays from, by its path in the source, and the sizes the parent gave, by address. */
let shownFrom: Record<string, string> = {}
const sizeAt = new Map<string, number>()
/** Shows the question for the person's files a moment late, where the parent may bring them first. */
let askTimer: ReturnType<typeof setTimeout> | undefined

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
  // Whatever was built does not play: files that come now are built from again.
  whole = false
  fix.hidden = !fixable
  // The headings above end in no full stop, and a message from elsewhere may be empty.
  show('error', text ? `${heading}. ${text}` : `${heading}.`)
}

/** What the activity is, under the stage: its title, and its type with the package's size once built. */
function about(name: unknown, type: unknown, size?: number | string): void {
  if (typeof name === 'string' && name.trim()) title.textContent = name
  // "H5P.InteractiveVideo 1.27" as "Interactive Video".
  const typed = typeof type === 'string' ? type.replace(/^H5P\./, '').replace(/\s[\d.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : ''
  const parts = [typed, size === undefined ? '' : typeof size === 'string' ? size : sized(size)].filter(Boolean)
  if (parts.length) meta.textContent = parts.join(' · ')
}

// The build page, with the same source, where its problems can be fixed and its files chosen.
edit.href = fix.href = keepOpen.href = `/h5p/build/${location.hash}`

// The page's height for the parent, which sizes its frame to it.
if (framed) new ResizeObserver(() => toParent({ type: 'height', height: Math.ceil(document.documentElement.getBoundingClientRect().height) })).observe(document.body)

/** A file's kind, by the ending of its name. */
const kind = kindOf
/** What a person calls a file of that kind. */
const called = (name: string): string => /^(mp4|webm|ogv|mov)$/.test(kind(name)) ? 'video' : /^(mp3|m4a|wav|ogg|oga)$/.test(kind(name)) ? 'recording' : /^(png|jpe?g|gif|bmp)$/.test(kind(name)) ? 'picture' : 'file'

/**
 * The given files for the paths the source names, matched as the build page matches them: by name,
 * and a single file of a kind whatever it is called, since a chat may write the name its own way
 * and the source cannot be changed here.
 */
const filesFor = (paths: string[]): { files: Record<string, File>, missing: string[] } => matchFiles(paths, [...chosen.values()])

/** Whether a file of that name can be played from an address: a video or a recording. */
const playable = (name: string): boolean => called(name) === 'video' || called(name) === 'recording'

/**
 * The addresses for the paths still missing, matched as files are, by the same rule: by name, then
 * a single one of a kind whatever it is called. A picture is never played from an address: its
 * size is read.
 */
function linksFor(paths: string[]): { linked: Record<string, string>, missing: string[] } {
  const { matched } = matchNamed(paths.filter(playable), [...links])
  return { linked: matched, missing: paths.filter((path) => !(path in matched)) }
}

/** Something said to a screen reader once, beside the state's own words. */
function announce(text: string): void {
  if (!announcer) return
  announcer.textContent = ''
  setTimeout(() => { announcer.textContent = text }, 50)
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
  const missingNow = names.join('\n')
  const first = missingNow !== told
  if (first) {
    told = missingNow
    toParent({ type: 'needs-files', names })
  }
  // A parent that holds the files answers within a moment: until then the loader stays, so the
  // question does not flash up and go.
  clearTimeout(askTimer)
  askTimer = undefined
  if (framed && first && !chosen.size) {
    askTimer = setTimeout(() => {
      askTimer = undefined
      showAsk(listed, one)
    }, 1200)
    return
  }
  showAsk(listed, one)
}

function showAsk(listed: string, one: boolean): void {
  show('asking', chosen.size
    ? `Still needed: ${listed}.`
    : `This activity uses ${one ? 'a file' : 'files'} of yours: ${listed}. Choose ${one ? 'it' : 'them'} from your computer; ${one ? 'it stays' : 'they stay'} in your browser.`)
}

/**
 * A file on its way from the parent, which holds what the person attached in the chat: how much
 * has come, drawn as a bar where its size is known. The person can still choose the file from
 * their computer, which needs no wait. Told a screen reader once, not with every number.
 */
function fetching(name: string, received: number, total: number): void {
  if (keeping) return keepCount(name, received, total)
  // Asked for, the question shown or still held back a moment: the file on its way is shown in its place.
  if (main.dataset.state !== 'asking' && main.dataset.state !== 'fetching' && askTimer === undefined) return
  clearTimeout(askTimer)
  askTimer = undefined
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
  // A file that comes late, from a parent still bringing what the person chose themselves
  // meanwhile, must not start the activity again under them, nor take the place of the file
  // the package to keep is being built from.
  if (whole || packing) return
  // Where one file is named, a second choice replaces the first.
  if (wanted.length === 1) chosen.clear()
  for (const file of files) chosen.set(file.name, file)
  // While a preview plays, the files make the package to keep, and the player is left playing:
  // saved where Download asked for them, and only made ready for it where the parent sent them unasked.
  if (previewed.length) void keep()
  else void play()
}

/** The words for the files a preview plays from an address: "video", or "files". */
const previewedAs = (): string => previewed.length === 1 ? called(previewed[0]!) : 'files'

/** The row under the stage while a download is made ready, with the choice of the file's own where it helps. */
function preparing(text: string, choice: boolean): void {
  keepBox.hidden = false
  keepInstead.hidden = !choice
  keepOpen.hidden = true
  keepLabel.textContent = text
  keepProgress.hidden = false
  keepProgress.dataset.indeterminate = ''
  keepProgress.removeAttribute('aria-valuenow')
  download.setAttribute('aria-disabled', 'true')
  downloadLabel.textContent = 'Preparing…'
}

/** The row under the stage for a download the parent makes: what it is doing, or how it went, with the build page where that is the way on. */
function saying(text: string, { busy = false, open = false } = {}): void {
  keepBox.hidden = false
  keepInstead.hidden = true
  keepOpen.hidden = !open
  keepLabel.textContent = text
  keepProgress.hidden = !busy
  if (busy) {
    keepProgress.dataset.indeterminate = ''
    keepProgress.removeAttribute('aria-valuenow')
  }
  download[busy ? 'setAttribute' : 'removeAttribute']('aria-disabled', 'true')
  downloadLabel.textContent = busy ? 'Saving…' : 'Download .h5p'
  announce(text)
}

/**
 * A package the parent cannot save: the build page can, with the person's files chosen there.
 * Before it is built, its size is at least its files': said as "over".
 */
function tooBig(size: number, atLeast = false): void {
  const files = wanted.length ? `choose your ${wanted.length === 1 ? called(wanted[0]!) : 'files'} there, ` : ''
  saying(`${atLeast ? `With your ${previewedAs()} in it, this .h5p is over` : 'This .h5p is'} ${sized(size)}, more than the chat can save from here. Open it in the build page, ${files}and download it.`, { open: true })
}

/** The package handed to a parent that saves files itself, which says how that went; no word in a minute is taken as no. */
function handOver(file: File): void {
  if (hostSaves !== null && file.size > hostSaves) return tooBig(file.size)
  handed = everHanded = true
  saying('The chat is saving the .h5p…', { busy: true })
  toParent({ type: 'save', file })
  clearTimeout(handedTimer)
  handedTimer = setTimeout(() => saveDone(false), 60_000)
}

/** How the parent's save went. A yes that comes after the minute is still said. */
function saveDone(ok: boolean): void {
  clearTimeout(handedTimer)
  handed = false
  if (!ok) return saying('The chat did not save it. Open it in the build page, and download it there.', { open: true })
  saying('Saved. Look in your downloads.')
  handedTimer = setTimeout(() => { keepBox.hidden = true }, 8000)
}

/** What the files of a preview weigh, where the parent said for each: the package is that and a little. */
function previewSize(): number | null {
  let total = 0
  for (const path of previewed) {
    const size = sizeAt.get(shownFrom[path] ?? '')
    if (size === undefined) return null
    total += size
  }
  return total
}

/**
 * Download of a preview: the parent is asked for the bytes of what it plays from an address, and
 * how much has come is shown under the stage while the activity plays on. The person can choose
 * the file from their computer instead, as when it was first asked for. Files that are here
 * already, sent unasked or left by a build that failed, are built from at once.
 */
function fetchToKeep(): void {
  keeping = true
  if (packing) return preparing(`Building the .h5p with your ${previewedAs()} in it…`, false)
  if (bringing) return
  if (!filesFor(wanted).missing.length) return void keep()
  bringing = true
  preparing(`Getting your ${previewedAs()} from the chat for the download…`, true)
  announce(`Getting your ${previewedAs()} from the chat for the download.`)
  toParent({ type: 'needs-bytes', names: previewed.map(baseName) })
}

/** How much of a file for the download has come. */
function keepCount(name: string, received: number, total: number): void {
  if (!bringing) return
  const what = previewed.length === 1 ? called(name || previewed[0]!) : 'file'
  keepLabel.textContent = `Getting your ${what} for the download… ${sized(received)}${total > 0 ? ` of ${sized(total)}` : ''}`
  if (total > 0) {
    const done = Math.min(100, Math.round(received / total * 100))
    delete keepProgress.dataset.indeterminate
    keepProgress.setAttribute('aria-valuenow', String(done))
    keepBar.style.setProperty('--done', `${done}%`)
  }
}

/**
 * The package to keep, built with the files in it and given to the parent, while the player plays
 * on. It is saved only where Download asked for it: files the parent sends unasked make Download
 * a link to it, with nothing shown and nothing saved.
 */
async function keep(): Promise<void> {
  if (packing) return
  const { files, missing } = filesFor(wanted)
  if (missing.length) {
    if (keeping) keepLabel.textContent = `Still needed for the download: ${new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(missing.map(baseName))}.`
    return
  }
  packing = true
  bringing = false
  if (keeping) preparing(`Building the .h5p with your ${previewedAs()} in it…`, false)
  try {
    opened ??= openPack(installPack)
    const result = await buildPackage(source, { libraries: await opened, files })
    const name = packageName(String(result.manifest.title ?? ''))
    if (packageUrl) URL.revokeObjectURL(packageUrl)
    packageUrl = URL.createObjectURL(result.blob)
    kept = new File([result.blob], name, { type: 'application/zip' })
    // Download may have been pressed while this was built.
    const asked = keeping
    previewed = []
    keeping = false
    whole = true
    keepBox.hidden = true
    download.href = packageUrl
    download.download = name
    download.removeAttribute('aria-disabled')
    downloadLabel.textContent = 'Download .h5p'
    about(result.manifest.title, result.builtWith, result.blob.size)
    toParent({ type: 'built', file: kept, title: result.manifest.title, size: sized(result.blob.size) })
    if (!asked) return
    // The download the person asked for: made by a parent that saves files, or by this page.
    if (hostSaves !== null) return handOver(kept)
    announce(`The .h5p is ready, ${sized(result.blob.size)}: downloading.`)
    download.click()
  } catch (error) {
    // Unasked, nothing is said: the preview plays on, and Download builds from the same files.
    if (!keeping) return
    const text = `The .h5p could not be built: ${error instanceof Error ? error.message : String(error)}`
    keepInstead.hidden = false
    keepProgress.hidden = true
    keepLabel.textContent = text
    download.removeAttribute('aria-disabled')
    downloadLabel.textContent = 'Try again'
    announce(text)
  } finally {
    packing = false
  }
}

async function play(): Promise<void> {
  const build = ++builds
  clearTimeout(askTimer)
  askTimer = undefined
  const found = filesFor(wanted)
  const { linked, missing } = linksFor(found.missing)
  if (missing.length) return ask(missing)
  busy('Building the activity in your browser…')
  try {
    opened ??= openPack(installPack)
    const result = await buildPackage(source, { libraries: await opened, files: found.files, linked })
    if (build !== builds) return
    const name = packageName(String(result.manifest.title ?? ''))
    if (packageUrl) URL.revokeObjectURL(packageUrl)
    const file = new File([result.blob], name, { type: 'application/zip' })
    previewed = result.linked
    shownFrom = linked
    download.hidden = false
    if (previewed.length) {
      // A preview is not a file to hand out: its address expires. Download fetches the bytes first.
      // Its link is this page's own, for a press that opens it elsewhere; a press here is taken below.
      packageUrl = null
      download.href = location.href
      download.removeAttribute('download')
      about(result.manifest.title, result.builtWith, `${previewedAs() === 'files' ? 'its files play' : `its ${previewedAs()} plays`} from the chat`)
    } else {
      whole = true
      kept = file
      packageUrl = URL.createObjectURL(result.blob)
      download.href = packageUrl
      download.download = name
      about(result.manifest.title, result.builtWith, result.blob.size)
      toParent({ type: 'built', file, title: result.manifest.title, size: sized(result.blob.size) })
    }
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
keepInstead.addEventListener('click', () => filesInput.click())
// Download of a preview fetches the files first; of a package with its files in it, it is a link,
// or, under a parent that saves files itself, the package handed to it.
download.addEventListener('click', (event) => {
  if (previewed.length) {
    event.preventDefault()
    // A video whose package the parent could not save is not fetched for nothing.
    const size = hostSaves !== null && !keeping ? previewSize() : null
    if (size !== null && size > hostSaves!) return tooBig(size, true)
    return fetchToKeep()
  }
  if (hostSaves === null || !kept) return
  event.preventDefault()
  if (!handed) handOver(kept)
})
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

/** A count of bytes as a message gives it: a number that is one, and not below nothing. */
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/**
 * Addresses the parent gives for files it holds, by name: kept where they are http(s) and name a
 * video or a recording, and the activity built with them where a file of its own is still missing.
 * While a preview plays they are only kept: a new address for the same file is not a new activity.
 */
function takeLinks(given: Record<string, unknown>, sizes: Record<string, unknown>): void {
  let added = false
  for (const [name, address] of Object.entries(given)) {
    if (typeof address !== 'string' || !/^https?:\/\//i.test(address) || !URL.canParse(address) || !playable(name)) continue
    // What the file there weighs, where the parent knows: a download is not begun that cannot be saved.
    const size = amount(sizes[name])
    if (size !== null) sizeAt.set(address, size)
    // The same address again, as with its size once that is known, is nothing new to build with.
    if (links.get(baseName(name)) === address) continue
    links.set(baseName(name), address)
    added = true
  }
  if (added && !previewed.length && filesFor(wanted).missing.length) void play()
}

// From the frame's parent, which may hold what the person attached in the chat: the files, how
// much of one has come so far, and the chat's theme where it is not the system's. And from one
// that saves files itself: that it does, with the most it takes, and how a save went.
window.addEventListener('message', (event) => {
  if (!framed || event.source !== window.parent) return
  const message = event.data as { source?: unknown, type?: unknown, files?: unknown, links?: unknown, sizes?: unknown, name?: unknown, received?: unknown, total?: unknown, theme?: unknown, max?: unknown, ok?: unknown } | null
  if (message?.source !== 'h5p-play-host') return
  if (message.type === 'files' && Array.isArray(message.files)) take(message.files.filter((file): file is File => file instanceof File))
  else if (message.type === 'links' && message.links && typeof message.links === 'object') takeLinks(message.links as Record<string, unknown>, message.sizes && typeof message.sizes === 'object' ? message.sizes as Record<string, unknown> : {})
  else if (message.type === 'saves') hostSaves = amount(message.max) ?? Infinity
  else if (message.type === 'saved' && (handed || (everHanded && message.ok === true))) saveDone(message.ok !== false)
  else if (message.type === 'progress' && amount(message.received) !== null) fetching(typeof message.name === 'string' ? message.name : '', amount(message.received)!, amount(message.total) ?? 0)
  else if (message.type === 'theme' && (message.theme === 'light' || message.theme === 'dark')) document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content = message.theme
})

void start()
window.addEventListener('hashchange', () => location.reload())
