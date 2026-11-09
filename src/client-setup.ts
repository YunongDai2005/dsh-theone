import type { SettingsSnapshot } from './settings-types.ts'

/**
 * First-run setup: a full-window flow, one question per page, the way a phone is set up. Each answer is an
 * existing setting (sorting earlier chats, where topic sessions live, how topics are marked in main chat),
 * so nothing new is stored; every choice can be changed later in TheOne's settings.
 */
export interface SetupOptions {
  t: (key: string) => string
  /** TheOne's living cell, so the welcome pages breathe like the sidebar mark. */
  cellFrame: (time: number) => { membrane: string; x: number; y: number; r: number }
  signal: AbortSignal
  /**
   * Called once the flow closes: `finished` when its last button was pressed, `sawNews` when the last change was reached
   * (however it was left then). The caller decides what to retire: the setup, the news, the onboarding card.
   */
  onClose: (outcome: { finished: boolean; sawNews: boolean }) => void
  /** Only the "what's new" page, for someone who has been through the setup before: no welcome, no questions, nothing saved. */
  newsOnly?: boolean
}

type Option = { icon: string; label: string; hint: string; recommended?: boolean; hero: number }
type Question = { key: 'sort' | 'side' | 'tag'; title: string; body: string; options: Option[]; pick: number }

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
const multiline = (text: string) => escape(text).replace(/\n/g, '<br>')

const ring = (x: number, y: number, r: number, attributes = '') =>
  `<g class="theone-setup-a" ${attributes}><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="currentColor" stroke-width="${Math.max(1.4, r * 0.16)}"/><circle cx="${x}" cy="${y}" r="${r * 0.34}" fill="currentColor"/></g>`

/** The large picture above each question; it follows the option chosen. */
const heroes: Record<Question['key'], (mode: number) => string> = {
  sort: mode => {
    const crumbs = [[30, 22], [192, 28], [22, 90], [200, 94], [64, 108], [160, 8]]
    return `<svg viewBox="0 0 220 110"><g class="theone-setup-a" style="animation:theone-setup-pulse 3.2s ease-in-out infinite">${ring(110, 55, 28)}</g>${crumbs.map(([x, y], i) => mode === 0
      ? `<circle class="theone-setup-a" cx="${x}" cy="${y}" r="5" fill="currentColor" style="--dx:${110 - x}px;--dy:${55 - y}px;animation:theone-setup-absorb 3.2s ${i * 0.45}s cubic-bezier(.5,0,.4,1) infinite;opacity:0"/>`
      : `<circle class="theone-setup-a" cx="${x}" cy="${y}" r="5" fill="currentColor" opacity=".35" style="--fx:${i % 2 ? 3 : -3}px;--fy:${i % 3 ? -3 : 3}px;animation:theone-setup-drift ${3 + i * 0.4}s ease-in-out infinite"/>`).join('')}</svg>`
  },
  side: mode => `<svg viewBox="0 0 220 110"><rect x="20" y="4" width="180" height="102" rx="14" fill="none" stroke="currentColor" stroke-width="2" opacity=".4"/><path d="M82 4v102" stroke="currentColor" stroke-width="1.5" opacity=".22"/><rect x="32" y="18" width="38" height="8" rx="4" fill="currentColor" opacity=".28"/><rect x="32" y="32" width="30" height="8" rx="4" fill="currentColor" opacity=".28"/>${mode === 0
    ? [0, 1, 2].map(i => `<g class="theone-setup-a" style="animation:theone-setup-slide 3.6s ${0.3 + i * 0.35}s ease-out infinite;opacity:0">${ring(36, 54 + i * 17, 5)}<rect x="46" y="${50 + i * 17}" width="${26 - i * 4}" height="8" rx="4" fill="currentColor"/></g>`).join('')
    : `<rect x="110" y="24" width="74" height="64" rx="12" fill="none" stroke="currentColor" stroke-width="1.8"/>${[0, 1, 2].map(i => `<g class="theone-setup-a" style="animation:theone-setup-pop 3.6s ${0.3 + i * 0.3}s ease-out infinite;opacity:0">${ring(126, 41 + i * 17, 5)}<rect x="136" y="${37 + i * 17}" width="${34 - i * 6}" height="8" rx="4" fill="currentColor"/></g>`).join('')}`}</svg>`,
  tag: mode => `<svg viewBox="0 0 220 110">${[[30, 10, 96], [30, 44, 120], [30, 78, 84]].map(([x, y, w], i) => {
    const marked = mode === 2 || (mode === 1 && i === 2)
    return `<g class="theone-setup-a" style="animation:theone-setup-type 4.2s ${i * 0.5}s ease-out infinite;opacity:0"><rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="currentColor" opacity=".2"/></g>${marked ? ring(x + w + 16, y + 11, 7.5, `style="animation:theone-setup-pop 4.2s ${i * 0.5 + 0.25}s ease-out infinite;opacity:0"`) : ''}`
  }).join('')}</svg>`,
}

/** The small pictures on the option tiles: the large one, reduced. */
const icons: Record<string, string> = {
  absorb: '<circle cx="23" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="23" cy="12" r="2.6" fill="currentColor"/><circle cx="5" cy="6" r="2.2" fill="currentColor"/><circle cx="6" cy="18" r="2.2" fill="currentColor"/>',
  loose: '<circle cx="8" cy="7" r="2.2" fill="currentColor"/><circle cx="18" cy="17" r="2.2" fill="currentColor"/><circle cx="28" cy="8" r="2.2" fill="currentColor"/>',
  sidebar: '<rect x="2" y="2" width="32" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13 2v20" stroke="currentColor" stroke-width="1.3"/><circle cx="7.5" cy="9" r="2" fill="currentColor"/><circle cx="7.5" cy="15.5" r="2" fill="currentColor"/>',
  list: '<rect x="2" y="2" width="32" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13 2v20" stroke="currentColor" stroke-width="1.3"/><rect x="18" y="6" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="24" cy="12" r="2" fill="currentColor"/>',
  some: '<rect x="2" y="5" width="20" height="5" rx="2.5" fill="currentColor" opacity=".5"/><rect x="2" y="14" width="16" height="5" rx="2.5" fill="currentColor" opacity=".5"/><circle cx="25" cy="16.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="25" cy="16.5" r="1.3" fill="currentColor"/>',
  all: '<rect x="2" y="5" width="20" height="5" rx="2.5" fill="currentColor" opacity=".5"/><circle cx="29" cy="7.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="29" cy="7.5" r="1.3" fill="currentColor"/><rect x="2" y="14" width="16" height="5" rx="2.5" fill="currentColor" opacity=".5"/><circle cx="25" cy="16.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="25" cy="16.5" r="1.3" fill="currentColor"/>',
  none: '<rect x="2" y="5" width="20" height="5" rx="2.5" fill="currentColor" opacity=".5"/><rect x="2" y="14" width="16" height="5" rx="2.5" fill="currentColor" opacity=".5"/>',
}
const arrow = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7h8m-3-3 3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const cell = (size: number) => `<svg class="theone-setup-cell" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle fill="currentColor"/></svg>`
const notices = ['switch', 'all', 'hidden'] as const
/** The main-chat card the topic cells hang under, drawn small at the top of a picture. */
const card = (glow = '') => `<g class="theone-setup-a" ${glow}><rect x="44" y="2" width="132" height="24" rx="8" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".5"/>${ring(58, 14, 5.5)}<rect x="70" y="10.5" width="44" height="7" rx="3.5" fill="currentColor" opacity=".25"/></g>`
/** A soft halo behind a busy cell. */
const halo = (x: number, y: number, r: number, delay = 0) => `<circle class="theone-setup-a theone-setup-halo" cx="${x}" cy="${y}" r="${r}" fill="currentColor" style="animation:theone-setup-glow 2.8s ${delay}s ease-in-out infinite;opacity:.08"/>`
/**
 * What changed in this version, one page each in the setup's own picture language: the line-drawn cell, the accent colour,
 * slow movement that stops for reduced motion. Updating users see these after a short opening page; new users meet them
 * between the welcome and the questions, as the tour of how TheOne looks now.
 */
const newsPictures = {
  // Topics as cells clinging under the main-chat card: recent ones bigger, a busy one glowing.
  cluster: () => `<svg viewBox="0 0 220 110">${card()}${halo(126, 52, 17)}
    <g class="theone-setup-a" style="animation:theone-setup-pulse 3.2s ease-in-out infinite">${ring(100, 67, 17)}</g>
    ${ring(126, 52, 12)}<g opacity=".6">${ring(114, 92, 11)}${ring(76, 80, 10)}</g><g opacity=".4">${ring(137, 73, 8)}${ring(76, 56, 7.5)}</g></svg>`,
  // A message leaves the mark as a vesicle and lands in its topic; another candidate stays lit.
  route: () => `<svg viewBox="0 0 220 110"><g class="theone-setup-a" style="animation:theone-setup-send 3.2s ease-in-out infinite">${ring(34, 56, 15)}</g>
    <path d="M50 48C80 18 112 18 137 37" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.5 4.5" stroke-linecap="round" opacity=".35"/>
    ${halo(150, 38, 19, 2.2)}<g class="theone-setup-a" style="animation:theone-setup-catch 3.2s ease-in-out infinite">${ring(150, 38, 13)}</g>
    <circle class="theone-setup-a" cx="151" cy="64" r="17" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 3.5" style="animation:theone-setup-blink 3.2s ease-in-out infinite;opacity:0"/>
    <g opacity=".7">${ring(151, 64, 12)}</g><g opacity=".45">${ring(173, 49, 10)}${ring(129, 58, 8)}</g>
    <circle class="theone-setup-a theone-setup-ghost" cx="50" cy="48" r="4.5" fill="currentColor" style="animation:theone-setup-fly 3.2s ease-in-out infinite;opacity:0"/></svg>`,
  // A cell lifted into the card (carry on there), another thrown out to the side (set aside for now).
  drag: () => `<svg viewBox="0 0 220 110">${card('style="animation:theone-setup-take 4.4s ease-in-out infinite"')}
    <g opacity=".6">${ring(90, 74, 13)}${ring(115, 66, 11)}${ring(103, 96, 9.5)}</g>
    <g class="theone-setup-a" style="animation:theone-setup-lift 4.4s ease-in-out infinite">${ring(126, 88, 10)}</g>
    <g class="theone-setup-a" style="animation:theone-setup-toss 4.4s ease-in infinite">${ring(136, 63, 8.5)}</g></svg>`,
  // Main chat holds only the conversation; what each topic is doing lives on its cell beside it.
  quiet: () => `<svg viewBox="0 0 220 110">${halo(30, 40, 15, .4)}${ring(30, 40, 10)}<g opacity=".5">${ring(46, 64, 8)}${ring(26, 72, 7)}</g>
    <path d="M64 6v98" stroke="currentColor" stroke-width="1.2" opacity=".2"/>
    ${[[128, 10, 76, 18, 9], [80, 40, 112, 8, 4], [80, 54, 84, 8, 4], [140, 74, 64, 18, 9], [80, 100, 96, 8, 4]].map(([x, y, w, h, r], i) =>
      `<rect class="theone-setup-a" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="currentColor" style="animation:theone-setup-type 5.2s ${i * 0.45}s ease-out infinite;opacity:0;fill-opacity:${h > 10 ? .28 : .2}"/>`).join('')}</svg>`,
} as const
const news = Object.keys(newsPictures) as (keyof typeof newsPictures)[]

export async function openSetup({ t, cellFrame, signal, onClose, newsOnly = false }: SetupOptions): Promise<void> {
  const read = async <T>(path: string) => {
    try { const response = await fetch(path, { signal, cache: 'no-store' }); return response.ok ? await response.json() as T : undefined } catch { return undefined }
  }
  // The news alone asks nothing, so it reads nothing either.
  const [catalog, settings] = newsOnly ? [undefined, undefined] : await Promise.all([
    read<{ status: { consent: 'ask' | 'granted' | 'declined' } }>('/api/theone/catalog'), read<SettingsSnapshot>('/api/theone/settings')])
  if (signal.aborted) return
  const questions: Question[] = []
  // Someone who already agreed to sorting is not asked again; a disabled catalog cannot be asked about at all.
  if (catalog && catalog.status.consent !== 'granted') questions.push({ key: 'sort', title: t('setup.sortTitle'), body: t('setup.sortBody'), pick: 0, options: [
    { icon: 'absorb', hero: 0, label: t('setup.sortYes'), hint: t('setup.sortYesHint'), recommended: true },
    { icon: 'loose', hero: 1, label: t('setup.sortNo'), hint: t('setup.sortNoHint') }] })
  if (settings) {
    questions.push({ key: 'side', title: t('setup.sideTitle'), body: t('setup.sideBody'), pick: settings.savedValues.hideTopicSessions ? 1 : 0, options: [
      { icon: 'sidebar', hero: 0, label: t('setup.sideShow'), hint: t('setup.sideShowHint'), recommended: true },
      { icon: 'list', hero: 1, label: t('setup.sideHide'), hint: t('setup.sideHideHint') }] })
    questions.push({ key: 'tag', title: t('setup.tagTitle'), body: t('setup.tagBody'), pick: 0, options: [
      { icon: 'some', hero: 1, label: t('setup.tagSwitch'), hint: t('setup.tagSwitchHint'), recommended: true },
      { icon: 'all', hero: 2, label: t('setup.tagAll'), hint: t('setup.tagAllHint') },
      { icon: 'none', hero: 0, label: t('setup.tagNone'), hint: t('setup.tagNoneHint') }] })
  }

  const hint = (option: Option) => option.recommended ? `<b>${escape(t('setup.recommended'))}</b>${escape(option.hint)}` : escape(option.hint)
  const dots = (at: number) => `<div class="theone-setup-dots" aria-hidden="true">${questions.map((_, i) => `<i data-on="${i === at}"></i>`).join('')}</div>`
  const question = (q: Question, index: number) => `<div class="theone-setup-hero" data-hero="${index}">${heroes[q.key](q.options[q.pick].hero)}</div>
    <h2 class="theone-setup-title" id="theone-setup-q${index}">${escape(q.title)}</h2><p class="theone-setup-body">${escape(q.body)}</p>
    <div class="theone-setup-options" role="radiogroup" aria-labelledby="theone-setup-q${index}" style="grid-template-columns:repeat(${q.options.length},minmax(0,1fr))">${q.options.map((option, i) =>
      `<button type="button" class="theone-setup-option" role="radio" data-question="${index}" data-option="${i}" aria-checked="${q.pick === i}"><svg viewBox="0 0 36 24" aria-hidden="true">${icons[option.icon]}</svg>${escape(option.label)}</button>`).join('')}</div>
    <p class="theone-setup-hint" data-hint="${index}" aria-live="polite">${hint(q.options[q.pick])}</p>
    <div class="theone-setup-space"></div>${dots(index)}<button type="button" class="theone-setup-go" data-next>${escape(t('setup.continue'))}${arrow}</button>`
  /** One change per page, in the same frame as a question: picture, name, a sentence or two, its own row of dots. */
  const newsDots = (at: number) => `<div class="theone-setup-dots" aria-hidden="true">${news.map((_, i) => `<i data-on="${i === at}"></i>`).join('')}</div>`
  const newsPage = (key: typeof news[number], index: number, button: string) => `<div class="theone-setup-hero theone-setup-hero-big">${newsPictures[key]()}</div>
    <h2 class="theone-setup-title">${escape(t(`setup.new.${key}`))}</h2><p class="theone-setup-body">${escape(t(`setup.new.${key}Hint`))}</p>
    <div class="theone-setup-space"></div>${newsDots(index)}${button}`
  const next = (label: string) => `<button type="button" class="theone-setup-go" data-next>${escape(label)}${arrow}</button>`
  const tour = news.map((key, i) => ({ kind: 'news' as const, step: i, html: newsPage(key, i, newsOnly && i === news.length - 1
    ? `<button type="button" class="theone-setup-go" data-done>${escape(t('setup.finish'))}${arrow}</button>` : next(t('setup.continue'))) }))
  // Someone who has been through the setup sees only what changed after an update that brings news: an opening page they
  // can put off, then the changes, the last one closing. Everyone else gets the one flow: welcome, the questions first
  // (so setting up never waits behind a tour), then the changes as the tour of how TheOne looks, then done.
  const pages: { kind: 'open' | 'news' | 'question' | 'done'; step?: number; html: string }[] = newsOnly ? [
    { kind: 'open', html: `<div class="theone-setup-hero theone-setup-hero-cell theone-setup-hero-news">${cell(80)}<span class="theone-setup-badge">${escape(t('setup.newBadge'))}</span></div>
     <h2 class="theone-setup-title">${escape(t('setup.newTitle'))}</h2><p class="theone-setup-body">${multiline(t('setup.newBody'))}</p><div class="theone-setup-space"></div>
     ${next(t('setup.newGo'))}<button type="button" class="theone-setup-later" data-later>${escape(t('setup.newSkip'))}</button>` },
    ...tour] : [
    { kind: 'open', html: `<div class="theone-setup-hero theone-setup-hero-cell">${cell(92)}</div>
     <h2 class="theone-setup-title theone-setup-welcome">${escape(t('setup.welcome'))} <span class="theone-setup-brand"><span>The</span>One</span></h2>
     <p class="theone-setup-body">${multiline(t('setup.welcomeBody'))}</p><div class="theone-setup-space"></div>
     <button type="button" class="theone-setup-go" data-next>${escape(t('setup.start'))}${arrow}</button><button type="button" class="theone-setup-later" data-later>${escape(t('setup.later'))}</button>` },
    ...questions.map((q, i) => ({ kind: 'question' as const, step: i, html: question(q, i) })),
    ...tour,
    { kind: 'done', html: `<div class="theone-setup-hero theone-setup-hero-cell">${cell(92)}</div><h2 class="theone-setup-title">${escape(t('setup.doneTitle'))}</h2>
     <p class="theone-setup-body">${multiline(t('setup.doneBody'))}</p><p class="theone-setup-hint" data-status>${escape(t('setup.apps'))}</p><div class="theone-setup-space"></div>
     <button type="button" class="theone-setup-go" data-finish>${escape(t('setup.finish'))}${arrow}</button>` }]

  const overlay = document.createElement('div')
  overlay.className = 'theone-setup'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', t(newsOnly ? 'setup.newsLabel' : 'setup.label')); overlay.setAttribute('translate', 'no')
  overlay.innerHTML = `<button type="button" class="theone-setup-back" data-back hidden>‹ ${escape(t('setup.back'))}</button><p class="theone-setup-sr" aria-live="polite"></p>
    <div class="theone-setup-track">${pages.map(page => `<section class="theone-setup-page"><div class="theone-setup-column">${page.html}</div></section>`).join('')}</div>`
  const track = overlay.querySelector<HTMLElement>('.theone-setup-track')!, back = overlay.querySelector<HTMLButtonElement>('[data-back]')!
  const sections = [...overlay.querySelectorAll<HTMLElement>('.theone-setup-page')], status = overlay.querySelector<HTMLElement>('.theone-setup-sr')!
  // Reaching the last change counts as having seen what is new, however the flow is left afterwards.
  let at = 0, sawNews = false
  const go = (index: number) => {
    at = index
    const page = pages[index]
    if (page.kind === 'news' && page.step === news.length - 1) sawNews = true
    track.style.transform = `translateX(${-100 * index}%)`
    sections.forEach((section, i) => { section.inert = i !== index })
    // The closing page of the full flow has nothing to go back to; the last change of the news alone still can.
    back.hidden = index === 0 || page.kind === 'done'
    sections[index].querySelector<HTMLElement>('.theone-setup-go')?.focus({ preventScroll: true })
    // Focus lands on the button, so the page's title and where it stands are read out on their own.
    const title = sections[index].querySelector('.theone-setup-title')?.textContent ?? ''
    const where = page.kind === 'news' ? t('setup.progressNews') : page.kind === 'question' ? t('setup.progressSetup') : ''
    status.textContent = [title, where.replace('{n}', String((page.step ?? 0) + 1)).replace('{total}', String(page.kind === 'news' ? news.length : questions.length))].filter(Boolean).join(' · ')
  }

  // The welcome and closing cells breathe; everything else moves by CSS and stops for reduced motion.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  let frame = 0
  const paint = (time: number) => {
    const pose = cellFrame(time)
    for (const svg of overlay.querySelectorAll('.theone-setup-cell')) {
      svg.children[0].setAttribute('d', pose.membrane)
      svg.children[1].setAttribute('cx', pose.x.toFixed(3)); svg.children[1].setAttribute('cy', pose.y.toFixed(3)); svg.children[1].setAttribute('r', pose.r.toFixed(3))
    }
  }
  paint(0)
  if (!still) {
    let time = 0, last = performance.now()
    frame = requestAnimationFrame(function step(now) { time += Math.min(0.05, (now - last) / 1000) * 0.7; last = now; paint(time); frame = requestAnimationFrame(step) })
  }

  // A modal flow: what is behind it is out of reach while it is open, and focus goes back where it was afterwards.
  const before = document.activeElement as HTMLElement | null
  const behind = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== overlay && !el.inert)
  let closed = false
  /** `finished`: the last button was pressed (answers saved, or the last change seen), not put off or abandoned. */
  const close = (finished = false) => {
    if (closed) return
    closed = true
    cancelAnimationFrame(frame)
    document.removeEventListener('keydown', keydown, true)
    for (const el of behind) el.inert = false
    overlay.remove()
    if (before?.isConnected) before.focus({ preventScroll: true })
    onClose({ finished, sawNews })
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    // Tab stays within the page in view (and Back), wrapping at either end.
    if (event.key !== 'Tab') return
    const stops = [...(back.hidden ? [] : [back]), ...sections[at].querySelectorAll<HTMLElement>('button:not([disabled])')]
    if (!stops.length) return
    const index = stops.indexOf(document.activeElement as HTMLElement)
    event.preventDefault()
    stops[index < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (index + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus()
  }
  signal.addEventListener('abort', () => close(), { once: true })

  /** Applies the answers through the same endpoints the settings page and the topic workspace use. */
  const finish = async (button: HTMLButtonElement) => {
    button.disabled = true
    let failed = false
    const sort = questions.find(q => q.key === 'sort')
    if (sort) {
      try {
        const response = await fetch('/api/theone/catalog/consent', { method: 'POST', signal, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: sort.pick === 0 }) })
        failed ||= !response.ok
      } catch { failed = true }
    }
    const side = questions.find(q => q.key === 'side'), tag = questions.find(q => q.key === 'tag')
    if (side && tag) {
      // Read again just before writing, so a revision saved meanwhile is not overwritten.
      const fresh = await read<SettingsSnapshot>('/api/theone/settings')
      try {
        const response = fresh ? await fetch('/api/theone/settings', { method: 'PUT', signal, cache: 'no-store', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ values: { ...fresh.savedValues, hideTopicSessions: side.pick === 1, routeNotice: notices[tag.pick] }, revision: fresh.revision }) }) : undefined
        failed ||= !response?.ok
        if (response?.ok) window.dispatchEvent(new Event('theone-settings-changed'))
      } catch { failed = true }
    }
    if (signal.aborted) return
    if (failed) {
      overlay.querySelector('[data-status]')!.textContent = t('setup.error')
      button.disabled = false
      button.removeAttribute('data-finish'); button.setAttribute('data-later', '')
      return
    }
    close(true)
  }

  overlay.addEventListener('click', event => {
    const button = (event.target as Element).closest('button')
    if (!button || button.disabled) return
    if (button.dataset.question !== undefined) {
      const index = Number(button.dataset.question), q = questions[index]
      q.pick = Number(button.dataset.option)
      button.parentElement!.querySelectorAll('[role=radio]').forEach(radio => radio.setAttribute('aria-checked', String(radio === button)))
      overlay.querySelector(`[data-hero="${index}"]`)!.innerHTML = heroes[q.key](q.options[q.pick].hero)
      const hintLine = overlay.querySelector<HTMLElement>(`[data-hint="${index}"]`)!
      hintLine.innerHTML = hint(q.options[q.pick])
      hintLine.classList.remove('theone-setup-fade'); void hintLine.offsetWidth; hintLine.classList.add('theone-setup-fade')
    } else if ('next' in button.dataset) go(at + 1)
    else if ('back' in button.dataset) go(at - 1)
    else if ('later' in button.dataset) close()
    else if ('done' in button.dataset) close(true)
    else if ('finish' in button.dataset) void finish(button as HTMLButtonElement)
  })
  // Arrow keys move between the options of a question, as in any radio group.
  overlay.addEventListener('keydown', event => {
    const radio = (event.target as Element).closest<HTMLElement>('[role=radio]')
    if (!radio || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const radios = [...radio.parentElement!.querySelectorAll<HTMLElement>('[role=radio]')]
    const next = radios[(radios.indexOf(radio) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? radios.length - 1 : 1)) % radios.length]
    next.focus(); next.click()
  })
  document.addEventListener('keydown', keydown, true)
  document.body.append(overlay)
  for (const el of behind) el.inert = true
  go(0)
}

/** Restrained like DSH's own pages; TheOne's tint, hairline and one small glow on the main button. */
export const setupCss = `
.theone-setup{--s-bg:var(--dsw-alias-bg-base,#fff);--s-tx:var(--dsw-alias-label-primary,#18181b);--s-mu:var(--dsw-alias-label-tertiary,#6b6f78);--s-cap:var(--dsw-alias-label-caption,#9aa0aa);--s-neutral:var(--dsw-alias-border-l2,#00000014);
  --s-ac:#a75b1e;--s-tint:#fff5ec;--s-line:#eed3bb;--s-glow:0 0 22px 4px #ff6b001c;
  position:fixed;inset:0;z-index:10050;overflow:hidden;background:var(--s-bg);color:var(--s-tx);font-family:var(--dsw-font-family,inherit);animation:theone-setup-in .28s ease}
[data-ds-dark-theme] .theone-setup{--s-ac:#93c8f3;--s-tint:#1d2a37;--s-line:#344d64;--s-glow:0 0 22px 4px #80bae91c}
@keyframes theone-setup-in{from{opacity:0}}
.theone-setup-track{display:flex;height:100%;transition:transform .5s cubic-bezier(.32,.72,0,1)}
.theone-setup-page{flex:0 0 100%;height:100%;box-sizing:border-box;padding:48px 24px 32px;display:flex;align-items:center;justify-content:center;overflow:auto}
/* A fixed-height column, centred: the button keeps the same place on every page however tall the window is. */
.theone-setup-column{width:min(400px,100%);height:min(580px,100%);display:flex;flex-direction:column;align-items:center}
.theone-setup-back{all:unset;position:absolute;left:20px;top:16px;z-index:1;cursor:pointer;color:var(--s-cap);font-size:13px;line-height:20px;padding:4px 8px;border-radius:8px}
.theone-setup-back:hover{color:var(--s-tx)}.theone-setup-back[hidden]{display:none}
.theone-setup-hero{flex:none;width:100%;height:150px;display:flex;align-items:center;justify-content:center;color:var(--s-ac)}
.theone-setup-hero>svg{width:220px;height:110px;overflow:visible}
.theone-setup-hero-cell svg{overflow:visible}
.theone-setup-hero-big{height:210px}.theone-setup-hero-big>svg{width:330px;height:165px}
.theone-setup-hero-news{flex-direction:column;gap:16px}
.theone-setup-badge{font-size:12px;line-height:18px;color:var(--s-ac);background:var(--s-tint);box-shadow:inset 0 0 0 .5px var(--s-line);border-radius:6px;padding:2px 9px;margin-bottom:14px}
.theone-setup-title{font-size:26px;font-weight:500;letter-spacing:-.6px;line-height:1.3;margin:8px 0 8px;text-wrap:balance;text-align:center;color:var(--s-tx)}
.theone-setup-welcome{font-size:30px}
.theone-setup-brand{color:var(--s-ac)}.theone-setup-brand span{font-weight:400;font-size:.78em;color:var(--s-mu);margin-right:1px}
.theone-setup-body{font-size:14px;line-height:1.7;color:var(--s-mu);text-align:center;margin:0 0 22px;text-wrap:pretty}
.theone-setup-options{display:grid;gap:10px;width:100%}
.theone-setup-option{all:unset;box-sizing:border-box;cursor:pointer;border-radius:12px;border:1px solid var(--s-neutral);padding:13px 6px 11px;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--s-mu);font-size:13px;line-height:18px;transition:border-color .2s,background .2s,color .2s}
.theone-setup-option svg{width:40px;height:26px;transition:color .2s}
.theone-setup-option:hover{border-color:var(--s-line)}
.theone-setup-option[aria-checked=true]{background:var(--s-tint);border-color:color-mix(in srgb,var(--s-ac) 40%,var(--s-line));color:var(--s-tx)}
.theone-setup-option[aria-checked=true] svg{color:var(--s-ac)}
.theone-setup-hint{min-height:44px;margin:14px 0 0;text-align:center;text-wrap:pretty;font-size:13px;line-height:1.65;color:var(--s-cap)}
.theone-setup-hint b{color:var(--s-tx);font-weight:500}
.theone-setup-fade{animation:theone-setup-fade .3s ease}@keyframes theone-setup-fade{from{opacity:0}}
.theone-setup-space{flex:1;min-height:20px}
.theone-setup-go{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:9px 22px;border-radius:var(--dsw-radius-md,12px);background:var(--s-tint);border:1px solid var(--s-line);color:var(--s-ac);font-size:14px;line-height:20px;font-weight:500;box-shadow:var(--s-glow);transition:border-color .2s}
.theone-setup-go:hover{border-color:color-mix(in srgb,var(--s-ac) 40%,var(--s-line))}
.theone-setup-go:disabled{opacity:.6;cursor:default}
.theone-setup-go svg{width:13px;height:13px}
.theone-setup :is(.theone-setup-go,.theone-setup-option,.theone-setup-back,.theone-setup-later):focus-visible{outline:2px solid var(--s-ac);outline-offset:3px}
.theone-setup-later{all:unset;cursor:pointer;margin-top:14px;font-size:13px;line-height:20px;color:var(--s-cap)}.theone-setup-later:hover{color:var(--s-tx)}
.theone-setup-dots{display:flex;gap:6px;margin-bottom:18px}.theone-setup-dots i{width:5px;height:5px;border-radius:50%;background:var(--s-neutral);transition:all .3s}
.theone-setup-dots i[data-on=true]{background:var(--s-cap);width:14px;border-radius:3px}
.theone-setup-a{transform-box:fill-box;transform-origin:center}
@keyframes theone-setup-absorb{0%{opacity:0;transform:translate(0,0) scale(1)}15%{opacity:.75}75%{opacity:.85;transform:translate(var(--dx),var(--dy)) scale(.35)}85%,100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2)}}
@keyframes theone-setup-drift{0%,100%{transform:translate(0,0)}50%{transform:translate(var(--fx),var(--fy))}}
@keyframes theone-setup-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes theone-setup-slide{0%{opacity:0;transform:translateX(-10px)}12%,82%{opacity:1;transform:none}94%,100%{opacity:0}}
@keyframes theone-setup-pop{0%,20%{opacity:0;transform:scale(.4)}32%,85%{opacity:1;transform:scale(1)}95%,100%{opacity:0}}
@keyframes theone-setup-type{0%{opacity:0;transform:translateY(5px)}10%,88%{opacity:1;transform:none}98%,100%{opacity:0}}
/* The "what is new" pictures: a vesicle flying from the mark into its topic (the curve sampled), the topic catching it, a candidate left lit, a cell lifted into the card, one thrown aside. */
@keyframes theone-setup-fly{0%{opacity:0;transform:translate(0,0) scale(.6)}8%{opacity:1;transform:translate(4px,-4px) scale(1)}25%{transform:translate(22.7px,-17.1px)}40%{transform:translate(45.4px,-24.3px)}55%{transform:translate(67.1px,-22.8px)}68%{opacity:.9;transform:translate(87px,-14px) scale(.5)}74%,100%{opacity:0;transform:translate(87px,-14px) scale(.3)}}
@keyframes theone-setup-send{0%,100%{transform:scale(1)}6%{transform:scale(1.1)}16%{transform:scale(1)}}
@keyframes theone-setup-catch{0%,64%{transform:scale(1)}72%{transform:scale(1.13)}84%,100%{transform:scale(1)}}
@keyframes theone-setup-blink{0%,30%{opacity:0}42%,80%{opacity:.55}92%,100%{opacity:0}}
@keyframes theone-setup-glow{0%,100%{opacity:.05}50%{opacity:.2}}
@keyframes theone-setup-lift{0%,8%{opacity:1;transform:none}40%{opacity:1;transform:translate(-30px,-66px) scale(.75)}48%,100%{opacity:0;transform:translate(-30px,-70px) scale(.5)}}
@keyframes theone-setup-take{0%,36%{transform:none}44%{transform:scale(1.04)}54%,100%{transform:none}}
@keyframes theone-setup-toss{0%,58%{opacity:1;transform:none}82%{opacity:0;transform:translate(64px,-14px) rotate(25deg) scale(.8)}100%{opacity:0;transform:translate(64px,-14px) scale(.8)}}
@media(prefers-reduced-motion:reduce){.theone-setup,.theone-setup-track{animation:none;transition:none}.theone-setup-a{animation:none!important;opacity:1!important}
  .theone-setup-a.theone-setup-halo{opacity:.12!important}.theone-setup-a.theone-setup-ghost{opacity:0!important}}
.theone-setup-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`
