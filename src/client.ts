import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { catalogPanelId, createClientRuntime, panelId, settingsPanelId } from './client-runtime.ts'
import { createGatewayPanel, registerSidebarEntry } from './client-sidebar.ts'
import { registerComposer } from './client-composer.ts'
import { createCatalogPanel } from './client-catalog.ts'
import { createSettingsPanel } from './client-settings.ts'
import { installClientEffects } from './client-effects.ts'

// ui-workspace retains the selected conversation with this public source label.
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { mainView: unknown }
}

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'layout', 'uiWorkspace', 'modelDirectories', 'remote.session']

export function apply(ctx: Context) {
  const rt = createClientRuntime(ctx)
  const GatewayPanel = createGatewayPanel(rt)
  const CatalogPanel = createCatalogPanel(rt)
  const SettingsPanel = createSettingsPanel(rt)
  registerComposer(rt)
  installClientEffects(rt)
  // Wait for the owning plugins' declarations; retain their normal browser and chat.
  ctx.slots.inject('main', () => [
    ctx.slots.register({name:'main',key:panelId},GatewayPanel),
    ctx.slots.register({name:'main',key:catalogPanelId},CatalogPanel),
    ctx.slots.register({name:'main',key:settingsPanelId},SettingsPanel),
  ])
  registerSidebarEntry(rt)
}
