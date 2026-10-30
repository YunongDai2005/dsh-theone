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
  /** Called once the flow closes, whether finished or put off; the caller retires the onboarding notice. */
  onClose: () => void
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
/** What changed in this version, shown to people who update; each line is a picture, a name and one sentence. */
const news = [
  { key: 'mark', svg: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17.4 10c0 4.2-3.2 7.3-7.4 7.3S2.6 14.2 2.6 10 5.8 2.6 10 2.6s7.4 3.2 7.4 7.4Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10.4" cy="9.6" r="2.9" fill="currentColor"/></svg>' },
  { key: 'sessions', svg: `<svg viewBox="0 0 36 24" aria-hidden="true">${icons.sidebar}</svg>` },
  { key: 'pumpkin', svg: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5.6c-1-.9-2.6-1-4-.4C3.8 6.1 2.4 8.4 2.6 11c.3 3.5 3.4 5.6 7.4 5.6s7.1-2.1 7.4-5.6c.2-2.6-1.2-4.9-3.4-5.8-1.4-.6-3-.5-4 .4Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 5.4c0-1.4.6-2.4 1.8-2.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
]

export async function openSetup({ t, cellFrame, signal, onClose }: SetupOptions): Promise<void> {
  const read = async <T>(path: string) => {
    try { const response = await fetch(path, { signal, cache: 'no-store' }); return response.ok ? await response.json() as T : undefined } catch { return undefined }
  }
  const [catalog, settings] = await Promise.all([
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
  // One flow for everyone, new or updating: welcome, what changed, the questions, done.
  const pages = [
    `<div class="theone-setup-hero theone-setup-hero-cell">${cell(92)}</div>
     <h2 class="theone-setup-title theone-setup-welcome">${escape(t('setup.welcome'))} <span class="theone-setup-brand"><span>The</span>One</span></h2>
     <p class="theone-setup-body">${multiline(t('setup.welcomeBody'))}</p><div class="theone-setup-space"></div>
     <button type="button" class="theone-setup-go" data-next>${escape(t('setup.start'))}${arrow}</button><button type="button" class="theone-setup-later" data-later>${escape(t('setup.later'))}</button>`,
    `<div class="theone-setup-hero theone-setup-hero-cell theone-setup-hero-news">${cell(64)}<span class="theone-setup-badge">${escape(t('setup.newBadge'))}</span></div><h2 class="theone-setup-title">${escape(t('setup.newTitle'))}</h2>
     <ul class="theone-setup-news">${news.map(item => `<li><span class="theone-setup-news-icon">${item.svg}</span><span><b>${escape(t(`setup.new.${item.key}`))}</b><small>${escape(t(`setup.new.${item.key}Hint`))}</small></span></li>`).join('')}</ul>
     <div class="theone-setup-space"></div><button type="button" class="theone-setup-go" data-next>${escape(t('setup.continue'))}${arrow}</button>`,
    ...questions.map(question),
    `<div class="theone-setup-hero theone-setup-hero-cell">${cell(92)}</div><h2 class="theone-setup-title">${escape(t('setup.doneTitle'))}</h2>
     <p class="theone-setup-body">${multiline(t('setup.doneBody'))}</p><p class="theone-setup-hint" data-status>${escape(t('setup.apps'))}</p><div class="theone-setup-space"></div>
     <button type="button" class="theone-setup-go" data-finish>${escape(t('setup.finish'))}${arrow}</button>`]

  const overlay = document.createElement('div')
  overlay.className = 'theone-setup'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', t('setup.label')); overlay.setAttribute('translate', 'no')
  overlay.innerHTML = `<button type="button" class="theone-setup-back" data-back hidden>‹ ${escape(t('setup.back'))}</button>
    <div class="theone-setup-track">${pages.map(page => `<section class="theone-setup-page"><div class="theone-setup-column">${page}</div></section>`).join('')}</div>`
  const track = overlay.querySelector<HTMLElement>('.theone-setup-track')!, back = overlay.querySelector<HTMLButtonElement>('[data-back]')!
  const sections = [...overlay.querySelectorAll<HTMLElement>('.theone-setup-page')]
  let at = 0
  const go = (index: number) => {
    at = index
    track.style.transform = `translateX(${-100 * index}%)`
    sections.forEach((section, i) => { section.inert = i !== index })
    back.hidden = index === 0 || index === pages.length - 1
    sections[index].querySelector<HTMLElement>('.theone-setup-go')?.focus({ preventScroll: true })
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

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    cancelAnimationFrame(frame)
    document.removeEventListener('keydown', keydown, true)
    overlay.remove(); onClose()
  }
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
  signal.addEventListener('abort', close, { once: true })

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
    close()
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
.theone-setup-hero-news{flex-direction:column;gap:16px}
.theone-setup-badge{font-size:12px;line-height:18px;color:var(--s-ac);background:var(--s-tint);box-shadow:inset 0 0 0 .5px var(--s-line);border-radius:6px;padding:2px 9px;margin-bottom:14px}
.theone-setup-title{font-size:26px;font-weight:500;letter-spacing:-.6px;line-height:1.3;margin:8px 0 8px;text-wrap:balance;text-align:center;color:var(--s-tx)}
.theone-setup-welcome{font-size:30px}
.theone-setup-news{list-style:none;margin:14px 0 0;padding:0;width:100%;display:flex;flex-direction:column;gap:18px}
.theone-setup-news li{display:flex;gap:14px;align-items:flex-start}
.theone-setup-news-icon{flex:none;width:40px;height:40px;border-radius:10px;background:var(--s-tint);box-shadow:inset 0 0 0 .5px var(--s-line);color:var(--s-ac);display:grid;place-items:center}
.theone-setup-news-icon svg{width:22px;height:22px;overflow:visible}
.theone-setup-news b{display:block;font-size:14px;line-height:20px;font-weight:500;color:var(--s-tx)}
.theone-setup-news small{display:block;font-size:13px;line-height:1.6;color:var(--s-cap);margin-top:2px}
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
@media(prefers-reduced-motion:reduce){.theone-setup,.theone-setup-track{animation:none;transition:none}.theone-setup-a{animation:none!important;opacity:1!important}}
`
