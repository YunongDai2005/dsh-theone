import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { TheOneLocaleKey } from './client-locales.ts'
import type { ClientRuntime } from './client-runtime.ts'
import { catalogPanelId, panelId, settingsPanelId } from './client-runtime.ts'

export function createGatewayPanel(rt: ClientRuntime) {
  const { useText, navigation } = rt
  function GatewayPanel() {
    const t = useText()
    const [error,setError] = useState<TheOneLocaleKey>()
    const [attempt,setAttempt] = useState(0)
    useEffect(() => {
      let mounted = true
      setError(undefined)
      void navigation.open().catch(error => {
        console.warn('TheOne gateway navigation failed:', error instanceof Error ? error.message : 'Unknown navigation error')
        if (mounted) setError('gateway.error')
      })
      return () => { mounted = false }
    },[attempt])
    return h('section',{className:'theone-opening','aria-live':'polite'},
      h('p',null,t(error ?? 'gateway.opening')),
      error && h('button',{type:'button',onClick:()=>setAttempt(value=>value+1)},t('retry')))
  }
  return GatewayPanel
}

export function registerSidebarEntry(rt: ClientRuntime): void {
  const { ctx, t, useText, subscribeUpdate, startUpdate, updateHint, icon, navigation } = rt
  /** One-click update on the right of the entry; it shows only when there is something to do. */
  function UpdateButton() {
    const t = useText()
    const status = useSyncExternalStore(subscribeUpdate, () => rt.update)
    // A newer npm version still inside pnpm's one-day wait is shown too, with the choice to install it now.
    const waiting = !!status?.waiting && !status.available && !status.state
    if (!status || (!status.available && !status.state && !waiting)) return null

    const label = waiting ? t('update.waiting') : status.state === 'installing' ? t('update.installing') : status.state === 'reloading' ? t('update.reloading')
      : status.state === 'restart' ? t('update.restart')
      : status.state === 'failed' ? t('update.failed') : t('update.available')
    const hint = updateHint(status)
    // The button is only an icon; its state and the full explanation are in the tooltip.
    const title = `${label} · ${hint}`
    const act = (event: React.SyntheticEvent) => {
      // The entry itself is a button that opens main chat; this click is only the update's.
      event.preventDefault(); event.stopPropagation()
      startUpdate(status)
    }
    return h('span', { className: 'theone-update', role: 'button', tabIndex: 0, title, 'aria-label': title, 'data-state': waiting ? 'waiting' : status.state ?? 'available',
      onClick: act, onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
      onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') act(event) } },
      status.state === 'installing' || status.state === 'reloading' ? h('span', { className: 'theone-update-spin', 'aria-hidden': true })
        : icon(status.state === 'restart' ? 'restart' : status.state === 'failed' ? 'alert' : 'download', 15))
  }

  /** The One mark: a ring around a dot, drawn so host styles cannot reshape it. */
  const symbol = () => h('svg', { className: 'theone-symbol', viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': true, focusable: false },
    h('circle', { cx: 10, cy: 10, r: 8.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
    h('circle', { cx: 10, cy: 10, r: 2.4, fill: 'currentColor' }))

  function SidebarEntry({size}: PropsRuntime<'sidebar.panellist'>) {
    const t = useText()
    const marker = useRef<HTMLSpanElement>(null)
    const pending = useSyncExternalStore(subscribeUpdate, () => !!rt.update?.available && !rt.update.state)
    const id = useSyncExternalStore(navigation.subscribe,navigation.getSnapshot)
    const sessions = useSyncExternalStore<SessionListState>(ctx.sessions.list.subscribe,ctx.sessions.list.getSnapshot)
    const panel = useSyncExternalStore<PanelInfo>(ctx.layout.panelInfo.subscribe,ctx.layout.panelInfo.getSnapshot)
    const active = panel.activePanelId === panelId || (panel.activePanelId === null && !!id && !!sessions.byId[id as SessionId]?.retainedBy.mainView)
    useEffect(() => {
      const button = marker.current?.closest('button')
      if (!button) return
      let menu: HTMLDivElement | undefined
      const close = () => {
        menu?.remove(); menu = undefined
        document.removeEventListener('pointerdown', outside, true)
        document.removeEventListener('keydown', keydown, true)
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('blur', close)
      }
      const outside = (event: PointerEvent) => { if (!menu?.contains(event.target as Node)) close() }
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault(); close(); button.focus()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); menu?.querySelector('button')?.focus()
        }
      }
      const open = (x: number, y: number) => {
        close()
        menu = document.createElement('div')
        menu.className = 'theone-context-menu'
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('settings.title'))
        menu.setAttribute('translate', 'no')
        const item = document.createElement('button')
        item.type = 'button'; item.setAttribute('role', 'menuitem'); item.textContent = t('settings.menu')
        item.addEventListener('click', () => { close(); ctx.layout.selectPanel(settingsPanelId) })
        menu.append(item); document.body.append(menu)
        const bounds = menu.getBoundingClientRect()
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
        document.addEventListener('pointerdown', outside, true)
        document.addEventListener('keydown', keydown, true)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        window.addEventListener('blur', close)
        item.focus()
      }
      const contextmenu = (event: MouseEvent) => {
        event.preventDefault(); event.stopPropagation()
        const bounds = button.getBoundingClientRect()
        open(event.clientX || bounds.left, event.clientY || bounds.bottom)
      }
      const keyboard = (event: KeyboardEvent) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const bounds = button.getBoundingClientRect(); open(bounds.left, bounds.bottom)
        }
      }
      button.addEventListener('contextmenu', contextmenu)
      button.addEventListener('keydown', keyboard)
      return () => { close(); button.removeEventListener('contextmenu', contextmenu); button.removeEventListener('keydown', keyboard) }
    }, [size])
    useEffect(() => {
      const button = marker.current?.closest('button')
      if (!button || !active) return
      const move = (event: PointerEvent) => {
        if (event.pointerType === 'touch') return
        const bounds = button.getBoundingClientRect()
        button.style.setProperty('--one-pointer-x', `${event.clientX - bounds.left}px`)
        button.style.setProperty('--one-pointer-y', `${event.clientY - bounds.top}px`)
        button.dataset.oneTracking = 'true'
      }
      const leave = () => { delete button.dataset.oneTracking }
      button.addEventListener('pointermove', move, { passive: true })
      button.addEventListener('pointerleave', leave)
      button.addEventListener('pointercancel', leave)
      return () => {
        button.removeEventListener('pointermove', move)
        button.removeEventListener('pointerleave', leave)
        button.removeEventListener('pointercancel', leave)
        leave()
        button.style.removeProperty('--one-pointer-x')
        button.style.removeProperty('--one-pointer-y')
      }
    }, [active, size])
    return h('span',{ref:marker,className:'theone-nav',translate:'no','data-wide':size === 16,'data-active':active},
      h('span',{className:'theone-symbol-wrap'},symbol(),size !== 16 && pending ? h('span',{className:'theone-update-dot','aria-hidden':true}) : null),
      size === 16 && h('span',{className:'theone-entry-copy'},
        h('span',{className:'theone-entry-title'},
          h('span',{className:'theone-wordmark',translate:'no'},h('span',{className:'theone-word-the'},'The'),
            h('span',{className:'theone-word-one'},'One',h('span',{className:'theone-word-dot'}))),
          h('span',{className:'theone-entry-label'},t('gateway.label'))),
        h('span',{className:'theone-entry-sub'},t('gateway.subtitle'))),
      size === 16 && h(UpdateButton))
  }

  // Wait for the owning plugins' declarations; retain their normal browser and chat.
  ctx.slots.inject('sidebar.panellist', () => [
    ctx.slots.register({name:'sidebar.panellist',id:panelId,order:-1000,label:()=>t('gateway.title')},SidebarEntry),
    ctx.slots.register({name:'sidebar.panellist',id:catalogPanelId,order:-999,label:()=>t('catalog.title')}, ({size}: PropsRuntime<'sidebar.panellist'>) => {
      const t = useText()
      return h('span',{className:'theone-catalog-entry',translate:'no'},icon('grid',16),size === 16 ? h('span',null,t('catalog.title')) : null)
    }),
  ])
}
