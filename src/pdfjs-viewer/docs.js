// Live preview: one <pdfjs-viewer-element> that the playground and the Try buttons drive.
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
const openButton = document.querySelector('[data-preview-open]')
const closeButton = pane.querySelector('[data-preview-close]')
const playground = document.querySelector('[data-playground]')
const schemeMeta = document.querySelector('meta[name="color-scheme"]')
const narrow = matchMedia('(max-width: 999px)')

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

function renderMarkup() {
  if (!viewer) return
  const lines = [...viewer.attributes].map(({ name, value }) => `  ${name}="${value}"`)
  markup.textContent = `<pdfjs-viewer-element\n${lines.join('\n')}>\n</pdfjs-viewer-element>`
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
  console.error(error)
}

// Mobile: the preview is a full-screen panel.
function openPanel(opener) {
  if (!narrow.matches) return
  lastOpener = opener ?? openButton
  pane.dataset.open = ''
  openButton.setAttribute('aria-expanded', 'true')
  document.querySelector('.content').inert = true
  ensureViewer()
  closeButton.focus()
}

function closePanel() {
  if (!('open' in pane.dataset)) return
  delete pane.dataset.open
  openButton.setAttribute('aria-expanded', 'false')
  document.querySelector('.content').inert = false
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
  } catch (error) {
    showError(error)
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-try-button]')
  if (button) tryExample(button.closest('.example'), button)
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

pane.querySelector('[data-preview-reset]').addEventListener('click', () => mount())
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
