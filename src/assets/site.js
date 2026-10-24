// Color scheme toggle: two states, the system default or its opposite.
const schemeMeta = document.querySelector('meta[name="color-scheme"]')
const systemDark = matchMedia('(prefers-color-scheme: dark)')

const storeScheme = (value) => {
  try {
    value ? localStorage.setItem('color-scheme', value) : localStorage.removeItem('color-scheme')
  } catch {}
}

const applyScheme = (stored) => {
  schemeMeta.content = stored ?? 'light dark'
  document.dispatchEvent(new CustomEvent('colorschemechange'))
}

for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
  toggle.hidden = false
  toggle.addEventListener('click', () => {
    const rendered = schemeMeta.content === 'light dark' ? (systemDark.matches ? 'dark' : 'light') : schemeMeta.content
    const target = rendered === 'dark' ? 'light' : 'dark'
    const stored = target === (systemDark.matches ? 'dark' : 'light') ? null : target
    storeScheme(stored)
    applyScheme(stored)
  })
}

addEventListener('storage', (event) => {
  if (event.key === 'color-scheme') applyScheme(event.newValue)
})

// Code blocks: a bar with the language, a Copy button and, inside `.example`, a Try button.
const languageNames = { html: 'HTML', markup: 'HTML', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', bash: 'Shell', css: 'CSS', json: 'JSON' }

for (const pre of document.querySelectorAll('pre[class*="language-"]')) {
  const language = [...pre.classList].find((name) => name.startsWith('language-'))?.slice(9)
  const wrapper = document.createElement('div')
  wrapper.className = 'code'
  const bar = document.createElement('div')
  bar.className = 'code-bar'
  const label = document.createElement('span')
  label.className = 'code-lang'
  label.textContent = languageNames[language] ?? language
  bar.append(label)

  if (pre.closest('.example')) {
    const tryButton = document.createElement('button')
    tryButton.type = 'button'
    tryButton.className = 'button button-primary'
    tryButton.dataset.tryButton = ''
    tryButton.textContent = '▶ Try'
    bar.append(tryButton)
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
      } catch {
        copy.textContent = 'Copy failed'
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
