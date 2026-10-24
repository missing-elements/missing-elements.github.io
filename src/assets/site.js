// Screen reader announcements through a polite status region.
export function announce(message, region = document.querySelector('[data-status="page"]')) {
  region.textContent = ''
  // Cleared first so that repeating the same message is announced again.
  setTimeout(() => (region.textContent = message), 50)
}

// Color scheme toggle: two states, the system default or its opposite.
const schemeMeta = document.querySelector('meta[name="color-scheme"]')
const systemDark = matchMedia('(prefers-color-scheme: dark)')

const storeScheme = (value) => {
  try {
    value ? localStorage.setItem('color-scheme', value) : localStorage.removeItem('color-scheme')
  } catch {}
}

const systemScheme = () => (systemDark.matches ? 'dark' : 'light')
const renderedScheme = () => (schemeMeta.content === 'light dark' ? systemScheme() : schemeMeta.content)
const themeSwitches = [...document.querySelectorAll('[data-theme-toggle] input')]
const syncSwitches = () => themeSwitches.forEach((input) => (input.checked = renderedScheme() === 'dark'))

const applyScheme = (stored) => {
  schemeMeta.content = stored ?? 'light dark'
  syncSwitches()
  document.dispatchEvent(new CustomEvent('colorschemechange'))
}

for (const input of themeSwitches) {
  input.closest('[data-theme-toggle]').hidden = false
  input.addEventListener('change', () => {
    const target = input.checked ? 'dark' : 'light'
    // Switching back to what the system shows means following the system again.
    const stored = target === systemScheme() ? null : target
    storeScheme(stored)
    applyScheme(stored)
  })
}
syncSwitches()
systemDark.addEventListener('change', syncSwitches)

addEventListener('storage', (event) => {
  if (event.key === 'color-scheme') applyScheme(event.newValue)
})

// Code blocks: a bar with the language, a Copy button and, inside `.example`, Try and Reset buttons.
const languageNames = { html: 'HTML', markup: 'HTML', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', bash: 'Shell', css: 'CSS', json: 'JSON' }

for (const pre of document.querySelectorAll('pre[class*="language-"]')) {
  const language = [...pre.classList].find((name) => name.startsWith('language-'))?.slice(9)
  const wrapper = document.createElement('div')
  wrapper.className = 'code'
  const bar = document.createElement('div')
  bar.className = 'code-bar'
  const label = document.createElement('span')
  label.className = 'code-lang'
  label.textContent = pre.dataset.label ?? languageNames[language] ?? language
  bar.append(label)

  const example = pre.closest('.example')
  if (example) {
    let heading = example
    while ((heading = heading.previousElementSibling) && !/^H[23]$/.test(heading.tagName));
    const tryButton = document.createElement('button')
    tryButton.type = 'button'
    tryButton.className = 'button button-primary'
    tryButton.dataset.tryButton = ''
    tryButton.innerHTML = '<span aria-hidden="true">▶</span> Try'
    if (heading) tryButton.setAttribute('aria-label', `Try the ${heading.textContent.trim()} example`)
    const resetButton = document.createElement('button')
    resetButton.type = 'button'
    resetButton.className = 'button'
    resetButton.dataset.resetButton = ''
    resetButton.textContent = 'Reset'
    resetButton.setAttribute('aria-label', 'Reset preview')
    bar.append(tryButton, resetButton)
  }

  if (navigator.clipboard) {
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'button'
    copy.textContent = 'Copy'
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent)
        copy.textContent = 'Copied'
        announce('Copied to clipboard')
      } catch {
        copy.textContent = 'Copy failed'
        announce('Copy failed')
      }
      setTimeout(() => (copy.textContent = 'Copy'), 1500)
    })
    bar.append(copy)
  }

  pre.before(wrapper)
  wrapper.append(bar, pre)
}

// Scrollspy for the sidebar table of contents.
const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')]

if (tocLinks.length) {
  const markCurrent = (current) => {
    for (const link of tocLinks) {
      link === current ? link.setAttribute('aria-current', 'true') : link.removeAttribute('aria-current')
    }
  }

  if (CSS.supports('scroll-target-group: auto')) {
    const sync = () => markCurrent(document.querySelector('.toc a:target-current'))
    let timer
    sync()
    // :target-current settles after the scroll, so read it once scrolling has paused.
    addEventListener('scroll', () => {
      clearTimeout(timer)
      timer = setTimeout(sync, 100)
    }, { passive: true })
  } else {
    const targets = tocLinks.map((link) => document.getElementById(link.hash.slice(1)))
    const update = () => {
      let index = 0
      targets.forEach((target, i) => {
        if (target && target.getBoundingClientRect().top < innerHeight * 0.3) index = i
      })
      tocLinks.forEach((link, i) => link.classList.toggle(':target-current', i === index))
      markCurrent(tocLinks[index])
    }
    const observer = new IntersectionObserver(update, { rootMargin: '0px 0px -70% 0px' })
    targets.forEach((target) => target && observer.observe(target))
  }
}
