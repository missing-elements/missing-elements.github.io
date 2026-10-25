// Live preview: one <pdfjs-viewer-element> that the playground and the Try buttons drive.
import { announce } from '/assets/site.js'

const ELEMENT_URL = '/pdfjs-viewer/vendor/pdfjs-viewer-element.js'
const BASE_ATTRIBUTES = {
  src: '/pdfjs-viewer/samples/sample-pdf-with-images.pdf',
  'iframe-title': 'Live preview of the documented PDF viewer',
}
// Placeholder used in snippets where the file doesn't matter; Try keeps the current document.
const PLACEHOLDER_SRC = '/file.pdf'
const SITE_ORIGIN = 'https://missing-elements.github.io'
const SKIPPED_ATTRIBUTES = new Set(['style', 'id', 'class'])

const pane = document.querySelector('[data-preview]')
const stage = pane.querySelector('[data-preview-stage]')
const markup = pane.querySelector('[data-preview-markup]')
const markupBox = pane.querySelector('[data-preview-markup-box]')
const status = pane.querySelector('[data-status="preview"]')
const openButton = document.querySelector('[data-preview-open]')
const closeButton = pane.querySelector('[data-preview-close]')
const playground = document.querySelector('[data-playground]')
const schemeMeta = document.querySelector('meta[name="color-scheme"]')
const narrow = matchMedia('(max-width: 999px)')
// Everything behind the full-screen preview on phones.
const background = document.querySelectorAll('.skip-link, .toc, .content, [data-preview-open]')

let viewer = null
let viewerReady = null
let elementLoaded = null
let lastOpener = null
const typingTimers = new Map()

const viewerTheme = () => ({ light: 'LIGHT', dark: 'DARK' })[schemeMeta.content] ?? 'AUTOMATIC'

// Snippets use the published sample URLs; serve them from wherever the docs are running.
const localUrl = (value) => value.replace(SITE_ORIGIN, location.origin)

const observer = new MutationObserver(() => {
  renderMarkup()
  syncPlayground()
})

function mount(attributes = {}) {
  viewerReady = create(attributes)
  return viewerReady
}

async function create(attributes) {
  elementLoaded ??= import(ELEMENT_URL)
  await elementLoaded
  const element = document.createElement('pdfjs-viewer-element')
  const all = { ...BASE_ATTRIBUTES, 'viewer-css-theme': viewerTheme(), ...attributes }
  for (const [name, value] of Object.entries(all)) {
    if (value) element.setAttribute(name, value)
  }
  observer.disconnect()
  stage.replaceChildren(element)
  observer.observe(element, { attributes: true })
  viewer = element
  renderMarkup()
  syncPlayground()
  return element
}

const ensureViewer = () => viewerReady ?? mount()

// The viewer's current markup, colored with the same token classes as the page's code blocks.
const token = (type, text) => Object.assign(document.createElement('span'), { className: `token ${type}`, textContent: text })

function renderMarkup() {
  if (!viewer) return
  const parts = [token('punctuation', '<'), token('tag', 'pdfjs-viewer-element')]
  for (const { name, value } of viewer.attributes) {
    parts.push('\n  ', token('attr-name', name), token('punctuation', '="'), token('attr-value', value), token('punctuation', '"'))
  }
  parts.push(token('punctuation', '>'), '\n', token('punctuation', '</'), token('tag', 'pdfjs-viewer-element'), token('punctuation', '>'))
  markup.replaceChildren(...parts)
  updateMarkupFocus()
}

// The markup box is a tab stop only while it has to scroll.
function updateMarkupFocus() {
  requestAnimationFrame(() => {
    markupBox.tabIndex = markupBox.scrollHeight > markupBox.clientHeight ? 0 : -1
  })
}

function syncPlayground() {
  if (!playground || !viewer) return
  for (const control of playground.querySelectorAll('[data-attr]')) {
    if (typingTimers.has(control)) continue
    const value = viewer.getAttribute(control.dataset.attr) ?? ''
    if (control.type === 'checkbox') {
      control.checked = value === 'true'
    } else if (control.tagName === 'SELECT') {
      const known = [...control.options].some((option) => option.value === value)
      if (!value && !known) control.selectedIndex = 0
      else if (!known) control.add(new Option(value, value))
      if (value || known) control.value = value
    } else if (control.value !== value && document.activeElement !== control) {
      control.value = value
    }
  }
}

function flash() {
  stage.classList.remove('flash')
  void stage.offsetWidth
  stage.classList.add('flash')
}

function showError(error) {
  markup.textContent = `Error: ${error.message}`
  announce(`The example failed: ${error.message}`, status)
  console.error(error)
}

// Phones: the preview is a modal, full-screen dialog.
function openPanel(opener) {
  if (!narrow.matches) return
  lastOpener = opener ?? openButton
  pane.dataset.open = ''
  pane.setAttribute('role', 'dialog')
  pane.setAttribute('aria-modal', 'true')
  openButton.setAttribute('aria-expanded', 'true')
  background.forEach((element) => (element.inert = true))
  ensureViewer()
  closeButton.focus()
  updateMarkupFocus()
}

function closePanel() {
  if (!('open' in pane.dataset)) return
  delete pane.dataset.open
  pane.setAttribute('role', 'complementary')
  pane.removeAttribute('aria-modal')
  openButton.setAttribute('aria-expanded', 'false')
  background.forEach((element) => (element.inert = false))
  lastOpener?.focus()
}

// Try: an HTML snippet applies the attributes of its <pdfjs-viewer-element>, a JS snippet runs
// as written. `fresh` examples start from a new element, for settings read only at startup.
const AsyncFunction = (async () => {}).constructor

async function tryExample(example, button) {
  const code = example.querySelector('pre').textContent
  const fresh = example.dataset.try === 'fresh'
  const isHtml = example.querySelector('pre').matches('.language-html, .language-markup')
  openPanel(button)

  try {
    if (isHtml) {
      const template = document.createElement('template')
      template.innerHTML = code
      const source = template.content.querySelector('pdfjs-viewer-element')
      const attributes = Object.fromEntries(
        [...source.attributes]
          .filter(({ name, value }) => !SKIPPED_ATTRIBUTES.has(name) && !(name === 'src' && value === PLACEHOLDER_SRC))
          .map(({ name, value }) => [name, localUrl(value)])
      )
      if (fresh) {
        await mount({ src: viewer?.getAttribute('src'), ...attributes })
      } else {
        const element = await ensureViewer()
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
      }
    } else {
      if (fresh) await mount({ src: viewer?.getAttribute('src') })
      else await ensureViewer()
      await new AsyncFunction(localUrl(code))()
    }
    flash()
    announce('Example applied to the live preview', status)
  } catch (error) {
    showError(error)
  }
}

async function resetPreview() {
  await mount()
  flash()
  announce('Preview reset', status)
}

document.addEventListener('click', (event) => {
  const tryButton = event.target.closest('[data-try-button]')
  if (tryButton) tryExample(tryButton.closest('.example'), tryButton)
  // On phones the viewer may not be loaded yet, and then there's nothing to reset.
  if (event.target.closest('[data-reset-button]') && viewerReady) resetPreview()
})

// Playground: each control sets or removes its attribute.
playground?.addEventListener('input', (event) => {
  const control = event.target.closest('[data-attr]')
  if (!control) return
  const apply = async () => {
    typingTimers.delete(control)
    const element = await ensureViewer()
    const value = control.type === 'checkbox' ? (control.checked ? 'true' : '') : control.value.trim()
    value ? element.setAttribute(control.dataset.attr, value) : element.removeAttribute(control.dataset.attr)
  }
  clearTimeout(typingTimers.get(control))
  if (control.type === 'search' || control.type === 'number') typingTimers.set(control, setTimeout(apply, 300))
  else apply()
})

pane.querySelector('[data-preview-reset]').addEventListener('click', resetPreview)
openButton.addEventListener('click', () => openPanel(openButton))
closeButton.addEventListener('click', closePanel)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePanel()
})
document.addEventListener('colorschemechange', () => viewer?.setAttribute('viewer-css-theme', viewerTheme()))

openButton.hidden = false
narrow.addEventListener('change', () => {
  if (!narrow.matches) {
    closePanel()
    ensureViewer()
  }
})
// On wide screens the preview is always visible; on phones it loads when first opened.
if (!narrow.matches) mount()
