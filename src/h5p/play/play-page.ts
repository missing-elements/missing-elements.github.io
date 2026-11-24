import '@missing-elements/h5p-offline-player'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'
import { pack as installPack } from '@missing-elements/h5p-libraries/install'
import { runtime } from '@missing-elements/h5p-runtime'
import { baseName, compactSource, fragmentFromSource, fragmentWithLinks, kindOf, linksFromFragment, matchFiles, matchNamed, namedFiles, packageName, parseSource, sized, sourceFromFragment, type Problem } from '../build/build-source'

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
 * it the package, numbered, and says under the stage how the parent says that one went. A package
 * bigger than that, or one the parent did not save, is still built here and stays behind Download:
 * the browser's own menu on a link was found to work in such a frame (right-click, open in a new
 * tab), so that is said under the stage, and nobody is sent out of the chat to choose the video
 * again (#100). A link of this page opens nothing there on a press, so a parent that opens links
 * says so too, and is handed the address.
 *
 * One press is asked for all the same (#102), and a package built in a frame cannot be passed to
 * a tab: the browser keeps a framed page's storage apart. But a tab can build it again from what
 * the frame had, the source and the files' addresses, where the store behind the addresses answers
 * any site, as the chat's was found to (2026-11-24). So a link to this page may carry `&links=`
 * and `&save=1` beside its source: the page then fetches the files itself, shows them coming,
 * builds the package and saves it, with no press. Framed by a parent that saves files and opens
 * links, Download of a video said to weigh more than the parent saves hands it such a link, at
 * once, while the press still lets a tab open.
 *
 * Such a tab is there to save a file, not to play one (#104): it draws no player, only the file
 * coming, the package being built, and that it is saved, and then it closes itself, which a tab
 * with nothing behind it may do. It waits a few seconds first, counted only while the page is seen
 * and has the keyboard: a question of the browser's own, where to save or whether to, may be over
 * it otherwise, or waiting in a tab nobody has looked at yet. "Keep this tab open" stops it, and
 * the activity can then be played there. Such a tab builds from files only, never from an
 * address: what it fetched, or what the person chose in its place.
 *
 * What is seen is one stage, in one of six states (`data-state` on `main`): `building`, a loader
 * over the place the player takes; `fetching`, the loader with how much of a file has come so far,
 * from the parent or from its address; `asking`, for the person's files; `error`, with the one
 * thing to do about it; `ready`, the player; `saved`, in a tab that only saves, the package saved
 * and the tab about to close. The parent is told each as a `status`, in words a screen reader is
 * told too.
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
const savedBox = $('saved')
const savedText = $('saved-text')
const savedStay = $<HTMLButtonElement>('saved-stay')
const savedPlay = $<HTMLButtonElement>('saved-play')
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
const announcer = document.querySelector<HTMLElement>('[data-status="page"]')
const edit = $<HTMLAnchorElement>('edit')
const player = $('player') as HTMLElementTagNameMap['h5p-player']
player.runtime = runtime

type State = 'building' | 'fetching' | 'asking' | 'ready' | 'error' | 'saved'
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
/** The number of the last one handed, which the parent's word on it carries: word on an earlier one says nothing of this one. */
let handedId = 0
let handedTimer: ReturnType<typeof setTimeout> | undefined
/** Whether the parent opens links itself, where a press on one of this page's opens nothing. */
let hostOpens = false
/** The address each file of the preview plays from, by its path in the source, and the sizes the parent gave, by address. */
let shownFrom: Record<string, string> = {}
const sizeAt = new Map<string, number>()
/** What the preview's package weighs without those files: its libraries and its content. */
let previewWeighs = 0
/** What the link carried beside its source: addresses, and the wish to save with no press. Read once, and taken out of the address bar. */
const carried = linksFromFragment(location.hash)
if (carried.rest !== location.hash) history.replaceState(null, '', `${location.pathname}${location.search}${carried.rest}`)
let saveUnasked = carried.save
/** Whether the save now made was asked for by the link: said under the stage, where nobody pressed anything. */
let unasked = false
/** The source as a link's fragment, for a tab of this page that saves the package. */
let ownFragment = ''
/** Stops the page's own fetch of a file, where the person chooses it themselves meanwhile. */
let fetchStop: AbortController | null = null
/** Whether this is a tab of its own that a link asked to save the package: it draws no player. */
let savingOnly = carried.save && window.parent === window
/** Counts down to the tab closing itself, once the package is saved. */
let closing: ReturnType<typeof setInterval> | undefined
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
  savedBox.hidden = state !== 'saved'
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
edit.href = fix.href = `/h5p/build/${location.hash}`

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
  // In a tab that only saves, a file chosen while files are fetched ends the fetch, and with it
  // the addresses: the package is built from files alone, and one still missing is asked for.
  if (savingOnly) {
    fetchStop?.abort()
    links.clear()
  }
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
  keepLabel.textContent = text
  keepProgress.hidden = false
  keepProgress.dataset.indeterminate = ''
  keepProgress.removeAttribute('aria-valuenow')
  download.setAttribute('aria-disabled', 'true')
  downloadLabel.textContent = 'Preparing…'
}

/** The row under the stage for a download the parent makes: what it is doing, or how it went. */
function saying(text: string, { busy = false } = {}): void {
  keepBox.hidden = false
  keepInstead.hidden = true
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
 * What the package to keep will weigh, about: the preview's own package and the files it plays
 * from addresses, where the parent said what each weighs. `null` where it did not, and where a
 * file of the activity is here and not at an address: a tab could not fetch that one.
 */
function previewSize(): number | null {
  if (previewed.length !== wanted.length) return null
  let total = previewWeighs
  for (const path of previewed) {
    const size = sizeAt.get(shownFrom[path] ?? '')
    if (size === undefined) return null
    total += size
  }
  return total
}

/** A link to this page, in a tab of its own, that fetches what the preview plays from its addresses and saves the package. */
const savingLink = (): string => `${location.origin}${location.pathname}${fragmentWithLinks(ownFragment, Object.fromEntries(links))}`

/**
 * The way to the package where the parent does not save it and its frame may let this page save
 * nothing: Download is a link to it, and the browser's own menu opens a link from any frame.
 */
const BY_HAND = 'To save it, right-click Download, or press and hold it, and open the link in a new tab.'

/** A package bigger than the parent saves: the browser is left to save it, and the way is said where it may not. */
function tooBig(size: number): void {
  saying(`This .h5p is ${sized(size)}, more than the chat saves with one press. ${BY_HAND}`)
}

/** The package handed to a parent that saves files itself, which says how that went; no word in a minute is taken as no. */
function handOver(file: File): void {
  handed = true
  saying('The chat is saving the .h5p…', { busy: true })
  toParent({ type: 'save', id: ++handedId, file })
  clearTimeout(handedTimer)
  handedTimer = setTimeout(() => saveDone(false), 60_000)
}

/** How the parent's save of the last package handed went. A yes that comes after the minute is still said. */
function saveDone(ok: boolean): void {
  clearTimeout(handedTimer)
  handed = false
  if (!ok) return saying(`The chat did not save it. ${BY_HAND}`)
  saying('Saved. Look in your downloads.')
  handedTimer = setTimeout(() => { keepBox.hidden = true }, 8000)
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
  if (framed) toParent({ type: 'needs-bytes', names: previewed.map(baseName) })
  else void fetchFiles()
}

/**
 * Files fetched by this page from their addresses, by their paths in the source, counted as they
 * come, ten times a second at most. The browser keeps each as a Blob, which it may hold on disk.
 */
async function fetched(from: Record<string, string>, signal: AbortSignal, count: (name: string, received: number, total: number) => void): Promise<File[]> {
  const files: File[] = []
  for (const [path, address] of Object.entries(from)) {
    const response = await fetch(address, { signal })
    if (!response.ok || !response.body) throw new Error(`the chat answered ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 0
    let received = 0
    let shown = 0
    const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        if (performance.now() - shown > 100) { shown = performance.now(); count(baseName(path), received, total) }
        controller.enqueue(chunk)
      },
    }))
    files.push(new File([await new Response(counted).blob()], baseName(path), { type: response.headers.get('content-type') ?? '' }))
  }
  return files
}

/** The files of a preview fetched by this page, where no parent holds them: from the addresses it plays from. */
async function fetchFiles(): Promise<void> {
  const stop = fetchStop = new AbortController()
  try {
    const files = await fetched(Object.fromEntries(previewed.map((path) => [path, shownFrom[path] ?? ''])), stop.signal, keepCount)
    if (stop.signal.aborted) return
    take(files)
  } catch (error) {
    // Stopped for a file the person chose: that one is built from.
    if (stop.signal.aborted) return
    notBrought(error instanceof Error ? error.message : String(error))
  }
}

/** The files for a download did not come, to this page or to the parent that was asked for them: said under the stage, with the way on. */
function notBrought(why = ''): void {
  bringing = false
  const text = `Your ${previewedAs()} could not be fetched from the chat${why ? ` (${why})` : ''}: its address may have run out. Choose it from your computer instead.`
  keepInstead.hidden = false
  keepProgress.hidden = true
  keepLabel.textContent = text
  download.removeAttribute('aria-disabled')
  downloadLabel.textContent = 'Try again'
  announce(text)
}

/**
 * The parent says a file it was asked for did not come (#106). For a download, that is said
 * under the stage. For a file the activity is waiting to be built with, the person is asked for
 * it, with the reason. At any other time it says nothing new.
 */
function failed(): void {
  if (bringing && previewed.length) return notBrought()
  if (main.dataset.state !== 'fetching' || whole || packing) return
  const { missing } = filesFor(wanted)
  if (!missing.length) return
  ask(missing)
  const one = missing.length === 1
  askText.textContent = `Your ${one ? called(missing[0]!) : 'files'} could not be fetched from the chat. Choose ${one ? 'it' : 'them'} from your computer; ${one ? 'it stays' : 'they stay'} in your browser.`
}

/**
 * In a tab that only saves: the files fetched from the addresses the link carried, shown coming in
 * the stage, and then built from. One that cannot be fetched is asked for, as where none was given.
 */
async function fetchThenBuild(from: Record<string, string>): Promise<void> {
  const stop = fetchStop = new AbortController()
  const paths = Object.keys(from)
  const what = paths.length === 1 ? called(paths[0]!) : 'files'
  label.textContent = `Getting your ${what}…`
  note.textContent = 'From the chat to your browser, nowhere else.'
  progress.hidden = true
  instead.hidden = false
  show('fetching', `Getting your ${what} from the chat.`)
  try {
    const files = await fetched(from, stop.signal, fetching)
    if (stop.signal.aborted) return
    // The addresses are used up: a file still missing is asked for, not played from another's.
    links.clear()
    take(files)
  } catch {
    if (stop.signal.aborted) return
    links.clear()
    ask(paths)
    askText.textContent = `Your ${what} could not be fetched from the chat: its address may have run out. Choose ${paths.length === 1 ? 'it' : 'them'} from your computer; ${paths.length === 1 ? 'it stays' : 'they stay'} in your browser.`
  }
}

/**
 * The package saved in a tab that only saves, with no press, and the tab closed a few seconds
 * later. The seconds are counted only while the page is seen and has the keyboard: otherwise a
 * question of the browser's own, where to save or whether to, may be open over it, or waiting
 * in a tab that was opened behind another.
 */
function savedHere(file: File): void {
  saveUnasked = false
  download.click()
  const named = `${file.name}, ${sized(file.size)},`
  let left = 5
  const said = (): void => { savedText.textContent = `${named} is in your downloads. This tab closes in ${left} s.` }
  savedStay.hidden = false
  savedPlay.hidden = true
  said()
  show('saved', `Your .h5p is saved: ${named} is in your downloads. This tab closes itself in a few seconds.`)
  clearInterval(closing)
  closing = setInterval(() => {
    if (document.hidden || !document.hasFocus()) return
    if (--left > 0) return said()
    // A tab the browser lets no page close stays, and says what it would have.
    stay()
    window.close()
  }, 1000)
}

/** The tab kept open: the way on where the browser saved nothing, and the activity to play. */
function stay(): void {
  clearInterval(closing)
  savedText.textContent = `${kept?.name ?? 'The .h5p'}, ${sized(kept?.size ?? 0)}, is in your downloads. If nothing was saved, press Download.`
  savedStay.hidden = true
  savedPlay.hidden = false
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
  fetchStop?.abort()
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
    // The download the person asked for: made by a parent that saves files, where it takes this one, or by this page.
    if (hostSaves !== null && kept.size <= hostSaves) return handOver(kept)
    download.click()
    // A save the link asked for, with no press: said where it shows, with the way on where the browser saved nothing.
    if (unasked) saying(`Your .h5p is saved to your downloads, ${sized(result.blob.size)}. You can close this tab. If nothing was saved, press Download.`)
    else announce(`The .h5p is ready, ${sized(result.blob.size)}: downloading.`)
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
    previewWeighs = result.blob.size
    download.hidden = false
    if (previewed.length) {
      // A preview is not a file to hand out: its address expires. Download fetches the bytes first.
      // Its link is this page's own, with the addresses and the wish to save, for a press that opens
      // it in a tab, which then saves the package; a press here is taken below.
      packageUrl = null
      download.href = savingLink()
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
    // A tab that only saves has what it came for: no player is drawn.
    if (savingOnly && whole) return savedHere(file)
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
  ownFragment = await fragmentFromSource(compactSource(text) ?? '')
  // The addresses the link carried, kept before the files are known to be wanted: the build below is the one that uses them.
  takeLinks(carried.links, {})
  wanted = namedFiles(source)
  const written = source as { title?: unknown, type?: unknown }
  about(written.title, written.type)
  // A tab that only saves fetches what the link gave addresses for first, and builds once.
  const { linked } = savingOnly ? linksFor(wanted) : { linked: {} }
  if (Object.keys(linked).length) return fetchThenBuild(linked)
  await play()
}

player.addEventListener('ready', () => {
  show('ready', `“${title.textContent}” is ready.`)
  // The save a link asked for: made once, as Download would, with no press.
  if (!saveUnasked) return
  saveUnasked = false
  unasked = true
  if (previewed.length) fetchToKeep()
  else download.click()
})
player.addEventListener('error', (event) => {
  if (player.state === 'ready') return
  fail('It was built, but does not play', (event as unknown as CustomEvent<{ message: string }>).detail.message, true)
})

savedStay.addEventListener('click', stay)
// The package that was saved, played in the tab that was kept open.
savedPlay.addEventListener('click', () => {
  if (!kept) return
  savingOnly = false
  busy('Starting the activity…')
  playerBox.hidden = false
  player.file = kept
})
// The file field is hidden, and the buttons open it.
choose.addEventListener('click', () => filesInput.click())
instead.addEventListener('click', () => filesInput.click())
keepInstead.addEventListener('click', () => filesInput.click())
// Download of a preview fetches the files first; of a package with its files in it, it is a link,
// or, under a parent that saves files itself, the package handed to it. One bigger than that
// parent saves stays the link, with the way to save it said where the frame saves nothing.
download.addEventListener('click', (event) => {
  if (previewed.length) {
    event.preventDefault()
    // A package that will weigh more than the parent saves is not made here, where it could not be
    // saved with a press: a tab of this page is opened by the parent, at once, and saves it there.
    // Only where every file of the activity is at an address, which is all a tab can reach.
    const size = hostSaves !== null && hostOpens && !keeping ? previewSize() : null
    if (size !== null && size > hostSaves!) {
      toParent({ type: 'open', href: savingLink() })
      return saying(`This .h5p is about ${sized(size)}, more than the chat saves. A new tab gets your ${previewedAs()} and saves it there.`)
    }
    return fetchToKeep()
  }
  if (hostSaves === null || !kept) return
  if (kept.size > hostSaves) return tooBig(kept.size)
  event.preventDefault()
  if (!handed) handOver(kept)
})
// A link of this page, under a parent that opens links itself: the parent is handed its address.
// A press with a key held, or the browser's own menu, is left to the browser.
document.addEventListener('click', (event) => {
  if (!hostOpens || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[target="_blank"]') : null
  if (!link?.href) return
  event.preventDefault()
  toParent({ type: 'open', href: link.href })
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
    // What the file there weighs, where the parent knows: a tab is opened for one it could not save.
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
// that saves files itself: that it does, with the most it takes, and how a save went; and from
// one that opens links itself, that it does. And that a file it was asked for did not come.
window.addEventListener('message', (event) => {
  if (!framed || event.source !== window.parent) return
  const message = event.data as { source?: unknown, type?: unknown, files?: unknown, links?: unknown, sizes?: unknown, name?: unknown, received?: unknown, total?: unknown, theme?: unknown, max?: unknown, id?: unknown, ok?: unknown } | null
  if (message?.source !== 'h5p-play-host') return
  if (message.type === 'files' && Array.isArray(message.files)) take(message.files.filter((file): file is File => file instanceof File))
  else if (message.type === 'links' && message.links && typeof message.links === 'object') takeLinks(message.links as Record<string, unknown>, message.sizes && typeof message.sizes === 'object' ? message.sizes as Record<string, unknown> : {})
  else if (message.type === 'failed') failed()
  else if (message.type === 'saves') hostSaves = amount(message.max) ?? Infinity
  else if (message.type === 'opens') hostOpens = true
  else if (message.type === 'saved' && handedId && message.id === handedId && typeof message.ok === 'boolean' && (handed || message.ok)) saveDone(message.ok)
  else if (message.type === 'progress' && amount(message.received) !== null) fetching(typeof message.name === 'string' ? message.name : '', amount(message.received)!, amount(message.total) ?? 0)
  else if (message.type === 'theme' && (message.theme === 'light' || message.theme === 'dark')) document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content = message.theme
})

void start()
window.addEventListener('hashchange', () => location.reload())
