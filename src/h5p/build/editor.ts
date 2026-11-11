import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { type Diagnostic, linter, lintGutter, setDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { formatSource, jsonProblem, place, type Target } from './json-scan'

/**
 * The editor of the build page's source, `/h5p/build/`, in place of its textarea: JSON in colours,
 * a mistake in it marked as it is typed, the problems the build finds marked where they are, and a
 * source pasted whole laid out as it goes in.
 * It is CodeMirror 6, loaded apart from the page, so that where it cannot load the textarea stays
 * as it is and the page works. The textarea stays beside it, hidden, holding the text, so that the
 * rest of the page reads the source as it always did.
 *
 * It is mounted in a shadow root. The page's policy has no `style-src 'unsafe-inline'`, and an
 * editor that adds a `<style>` to the page is refused; in a shadow root it adopts its styles as a
 * constructed stylesheet instead, which the policy does not govern. Its colours are the site's own,
 * custom properties that reach in from outside, so the site's light and dark themes need no code.
 * Tab is not the editor's: it leaves it, so that the keyboard is never trapped.
 */
export interface SourceEditor {
  /** Replaces the whole text. */
  set(text: string): void
  focus(): void
  /** Selects where a target is and shows it; `false` where the text has no such place. */
  goTo(target: Target): boolean
  /** Marks where each problem is, until the text changes; none clears the marks. */
  mark(problems: { path: string; message: string; at?: number }[]): void
}

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--t-attr)' },
  { tag: tags.string, color: 'var(--t-string)' },
  { tag: tags.number, color: 'var(--t-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--t-keyword)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: 'var(--muted)' }
])

const theme = EditorView.theme({
  '&': {
    height: '20rem',
    minHeight: '8rem',
    maxHeight: '80vh',
    resize: 'vertical',
    overflow: 'hidden',
    color: 'var(--text)',
    backgroundColor: 'var(--raised)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem'
  },
  '&:hover': { borderColor: 'var(--text)' },
  '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '1px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--text)', padding: '0.5rem 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'var(--tint)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--tint)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)'
  },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--tint)', outline: '1px solid var(--control)' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--raised)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' },
  '.cm-diagnostic': { fontFamily: 'var(--font)' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--bad)' }
})

/**
 * Text typed over a selection is put in by the editor, not by the browser. Chrome's own editing
 * gives text typed over a selection of coloured text a `style` attribute, which the page's policy
 * refuses and reports in the console, and the editor has to read the text through. The editor's
 * input handlers still see it first, so that a bracket or a quote typed over a selection wraps it.
 */
const typeOverSelection = EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (event.inputType !== 'insertText' || event.data === null || event.isComposing || view.state.selection.main.empty) return false
    event.preventDefault()
    const text = event.data
    const { from, to } = view.state.selection.main
    const insert = () => view.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type', scrollIntoView: true })
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, insert))) view.dispatch(insert())
    return true
  }
})

/**
 * A source pasted whole, into an empty editor or over all of its text, goes in laid out, and out of
 * the code fence a chat put it in, so that the page needs no button for it. A paste into the text,
 * or of text that is not JSON, goes in as it is.
 */
const pasteLaidOut = EditorView.domEventHandlers({
  paste(event, view) {
    const { from, to } = view.state.selection.main
    const text = event.clipboardData?.getData('text/plain')
    const laidOut = text && from === 0 && to === view.state.doc.length ? formatSource(text) : null
    if (laidOut === null) return false
    event.preventDefault()
    view.dispatch({ changes: { from, to, insert: laidOut }, selection: { anchor: 0 }, userEvent: 'input.paste', scrollIntoView: true })
    return true
  }
})

/** The mistake in the text, as the editor marks it while the text is typed. */
const mistakes = linter((view): Diagnostic[] => {
  const text = view.state.doc.toString()
  const problem = jsonProblem(text)
  if (!problem) return []
  const from = Math.min(problem.at ?? 0, Math.max(0, text.length - 1))
  return [{ from, to: Math.min(from + 1, text.length), severity: 'error', message: `Not valid JSON ${problem.message}` }]
}, { delay: 300 })

/**
 * Puts the editor where the textarea is, with the textarea's text, and calls `onChange` with the
 * text of every change, which it has already written into the textarea.
 */
export function mountEditor(textarea: HTMLTextAreaElement, onChange: (text: string) => void): SourceEditor {
  const host = document.createElement('div')
  host.className = 'source-editor'
  const shadow = host.attachShadow({ mode: 'open' })
  const parent = shadow.appendChild(document.createElement('div'))
  textarea.after(host)

  const view = new EditorView({
    parent,
    root: shadow,
    state: EditorState.create({
      doc: textarea.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        json(),
        syntaxHighlighting(highlight),
        mistakes,
        lintGutter(),
        placeholder(textarea.placeholder),
        theme,
        EditorView.contentAttributes.of({
          'aria-label': 'The source, as JSON',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off'
        }),
        typeOverSelection,
        pasteLaidOut,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          textarea.value = text
          onChange(text)
        })
      ]
    })
  })
  textarea.hidden = true

  return {
    set(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true })
    },
    focus() {
      view.focus()
    },
    goTo(target) {
      const range = place(view.state.doc.toString(), target)
      if (!range) return false
      view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: 'center' }) })
      view.focus()
      return true
    },
    mark(problems) {
      const text = view.state.doc.toString()
      const diagnostics: Diagnostic[] = []
      for (const { path, message, at } of problems) {
        const range = place(text, at === undefined ? { path } : { at })
        if (!range || !text) continue
        // At least a character is marked, and one that is in the text: a mistake at its very end marks the last.
        const from = Math.min(range.from, text.length - 1)
        diagnostics.push({ from, to: Math.min(Math.max(range.to, from + 1), text.length), severity: 'error', message: `${path}: ${message}` })
      }
      view.dispatch(setDiagnostics(view.state, diagnostics))
    }
  }
}
