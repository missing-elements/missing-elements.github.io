import '@missing-elements/h5p-offline-player'
import { buildPackage, openPack, SourceError } from '@missing-elements/h5p-author/browser'
import { pack as installPack } from '@missing-elements/h5p-libraries/install'
import { runtime } from '@missing-elements/h5p-runtime'
import { namedFiles, packageName, parseSource, sized, sourceFromFragment, type Problem } from '../build/build-source'

/**
 * The play page, `/h5p/play/`: the activity in a link's `#source=` built in the browser, as the
 * build page builds it, and played, with nothing else on the page but its file to download and a
 * way to the build page. A chat app frames it to show the activity in a reply (h5p-toolkit#210).
 * Framed, it tells the frame's parent its height, and gives it the built file, which a parent that
 * may not let the frame download can save its own way. Nothing leaves the browser otherwise.
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const status = $('status')
const download = $<HTMLAnchorElement>('download')
const edit = $<HTMLAnchorElement>('edit')
const player = $('player') as HTMLElementTagNameMap['h5p-player']
player.runtime = runtime

const framed = window.parent !== window
const toParent = (message: Record<string, unknown>): void => { if (framed) window.parent.postMessage({ source: 'h5p-play', ...message }, '*') }

function say(text: string, state: 'building' | 'ready' | 'error'): void {
  status.textContent = text
  status.dataset.state = state
  toParent({ type: 'status', state, text })
}

// The build page, with the same source, where its problems can be fixed and its files chosen.
edit.href = `/h5p/build/${location.hash}`

// The page's height for the parent, which sizes its frame to it.
if (framed) new ResizeObserver(() => toParent({ type: 'height', height: Math.ceil(document.documentElement.getBoundingClientRect().height) })).observe(document.body)

async function play(): Promise<void> {
  let text: string | null
  try {
    text = await sourceFromFragment(location.hash)
  } catch {
    return say('The link is damaged: its activity cannot be read. Ask the chat for it again.', 'error')
  }
  if (text === null) return say('The link carries no activity. This page plays the one an AI chat put in its link.', 'error')
  const parsed = parseSource(text)
  if ('problem' in parsed) return say('The activity in the link cannot be read. Open it in the build page to see why.', 'error')
  if (namedFiles(parsed.source).length) return say('The activity names files of your own: open it in the build page to choose them.', 'error')
  try {
    const result = await buildPackage(parsed.source, { libraries: await openPack(installPack), files: {} })
    const name = packageName(String(result.manifest.title ?? ''))
    download.href = URL.createObjectURL(result.blob)
    download.download = name
    download.hidden = false
    const file = new File([result.blob], name, { type: 'application/zip' })
    toParent({ type: 'built', file, title: result.manifest.title, size: sized(result.blob.size) })
    say(`“${String(result.manifest.title ?? name)}”, ${sized(result.blob.size)}. Starting it…`, 'building')
    player.file = file
  } catch (error) {
    if (error instanceof SourceError) {
      const problems = (error as SourceError & { problems: Problem[] }).problems
      return say(`The activity has ${problems.length} problem${problems.length === 1 ? '' : 's'}: open it in the build page to see and fix ${problems.length === 1 ? 'it' : 'them'}.`, 'error')
    }
    say(`It could not be built: ${error instanceof Error ? error.message : error}`, 'error')
  }
}

player.addEventListener('ready', () => say(status.textContent!.replace(/ Starting it…$/, ''), 'ready'))
player.addEventListener('error', (event) => {
  if (player.state === 'ready') return
  say(`It was built, but does not play: ${(event as unknown as CustomEvent<{ message: string }>).detail.message}`, 'error')
})

void play()
window.addEventListener('hashchange', () => location.reload())
