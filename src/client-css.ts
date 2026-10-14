/** Target only the row containing our own slot marker; no generated DSH class names. */
export const sidebarCss = `
button:has(.theone-nav){--one-accent:#a75b1e;--one-tint:#fff5ec;--one-line:#eed3bb;--one-heat:#ff78002b;--one-glow:0 0 22px 4px #ff6b0024,0 4px 32px 6px #ff76000d;border:1px solid var(--one-line);background:var(--one-tint);box-shadow:var(--one-glow);overflow:visible;border-radius:12px;color:var(--dsw-alias-label-primary);flex:none;position:relative;isolation:isolate}
[data-ds-dark-theme] button:has(.theone-nav){--one-accent:#93c8f3;--one-tint:#1d2a37;--one-line:#344d64;--one-heat:#80caff30;--one-glow:0 0 22px 4px #80bae924}
button:has(.theone-nav)::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(85px circle at var(--one-pointer-x,50%) var(--one-pointer-y,50%),var(--one-heat),transparent 100%);opacity:0;transition:opacity 180ms ease;z-index:0}
button[data-one-tracking=true]:has(.theone-nav[data-active=true])::after{opacity:1}
@media(prefers-reduced-motion:reduce){button:has(.theone-nav)::after{transition:none}}
button:has(.theone-nav[data-wide=true]){padding:12px 10px;min-height:64px;margin-top:4px;margin-bottom:18px}
button:has(.theone-nav[data-wide=true])>span:not(:has(.theone-nav)){display:none}
button:has(.theone-nav):hover{background:var(--one-tint);border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
button:has(.theone-nav[data-active=true]){border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
.theone-nav{display:flex;align-items:center;gap:10px;color:var(--one-accent);font-family:inherit;position:relative;z-index:1}
.theone-symbol-wrap{position:relative;display:inline-flex;flex:none;width:20px;height:20px}
.theone-nav .theone-symbol{display:block;width:20px;height:20px;flex:none;overflow:visible;border:0;border-radius:0;background:none}
.theone-nav[data-wide=true] .theone-symbol-wrap{margin:0 2px}
.theone-update-dot{position:absolute;top:-2px;right:-2px;width:7px;height:7px;border-radius:50%;background:#e8590c;box-shadow:0 0 0 2px var(--one-tint)}
button:has(.theone-nav[data-wide=true])>span:has(.theone-nav){flex:1;min-width:0}
.theone-nav[data-wide=true]{width:100%}
.theone-icon{display:block;flex:none;overflow:visible}
.theone-update{margin-left:auto;align-self:center;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;box-sizing:border-box;padding:0;border-radius:50%;border:1px solid color-mix(in srgb,var(--one-accent) 45%,transparent);background:color-mix(in srgb,var(--one-accent) 12%,transparent);color:var(--one-accent);font-size:12px;line-height:16px;white-space:nowrap;cursor:pointer;transition:background 150ms ease}
.theone-update:hover{background:color-mix(in srgb,var(--one-accent) 22%,transparent)}
.theone-update:focus-visible{outline:2px solid var(--one-accent);outline-offset:2px}
.theone-update[data-state=installing],.theone-update[data-state=reloading],.theone-update[data-state=restart]{cursor:default}
.theone-update[data-state=failed]{color:#d9480f;border-color:#d9480f66;background:#d9480f14}
.theone-update[data-state=waiting]{opacity:.8;border-style:dashed}
.theone-dialog-backdrop{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;background:#0008}
.theone-dialog{width:min(440px,100%);box-sizing:border-box;padding:22px 22px 18px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:16px;background:var(--dsw-specific-sidebar-fill,#232326);color:var(--dsw-alias-label-primary,#e8e8ea);box-shadow:0 16px 48px #0005;font:inherit;font-size:14px;line-height:1.65}
.theone-dialog h2{margin:0 0 10px;font-size:17px}
.theone-dialog p{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-dialog .theone-dialog-note{font-size:13px}
.theone-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
.theone-dialog-actions button{padding:8px 14px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.theone-dialog-actions button:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff12)}
.theone-dialog-actions .theone-dialog-primary{border-color:transparent;background:#3b6fb0;color:#fff}
.theone-dialog-actions .theone-dialog-primary:hover{background:#4a7fc0}
.theone-dialog-actions button:focus-visible{outline:2px solid #4a7fc0;outline-offset:2px}
.theone-dialog .theone-dialog-body{white-space:pre-wrap;color:var(--dsw-alias-label-primary,#e8e8ea)}
.theone-feedback{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto}
.theone-feedback textarea,.theone-feedback input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:9px;background:transparent;color:inherit;font:inherit;resize:vertical}
.theone-feedback .theone-feedback-check{display:block;margin:0 0 10px;font-size:13px;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-feedback-preview{margin:0 0 10px;font-size:13px}
.theone-feedback-preview summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-feedback-preview pre{max-height:220px;overflow:auto;margin:6px 0 0;padding:8px 10px;border-radius:9px;background:#0000001f;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.theone-notice{display:flex;align-items:center;gap:8px;margin:6px 4px 0;padding:6px 8px 6px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a0a0a6);min-width:0}
.theone-notice-tag{flex:none;display:inline-flex;padding:3px;border-radius:6px;background:#3b6fb033;color:#7fa9dd}
.theone-notice-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-notice-text strong{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.theone-notice button{flex:none;display:inline-flex;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:4px;border-radius:6px}
.theone-notice button:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff12)}
.theone-notice-link{color:#7fa9dd!important}
.theone-update-spin{width:12px;height:12px;border-radius:50%;border:1.5px solid currentColor;border-right-color:transparent;animation:theone-spin 800ms linear infinite}
@keyframes theone-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.theone-update-spin{animation:none}}
.theone-entry-copy{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}
.theone-entry-title{display:flex;align-items:center;gap:9px;line-height:22px}
.theone-wordmark{display:inline-flex;align-items:baseline;gap:1px;white-space:nowrap}
.theone-word-the{font-size:12px;font-weight:400;letter-spacing:-.25px;color:var(--dsw-alias-label-secondary)}
.theone-word-one{position:relative;font-family:ui-rounded,'SF Pro Rounded','Avenir Next',sans-serif;font-size:19px;line-height:1.15;font-weight:500;letter-spacing:-1px;transform:rotate(-4deg);padding-right:7px}
.theone-word-dot{position:absolute;right:0;top:2px;width:4px;height:4px;border-radius:50%;background:currentColor}
.theone-entry-label{font-size:12px;font-weight:400;white-space:nowrap}
.theone-entry-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.theone-opening{padding:32px;color:var(--dsw-alias-label-primary);font:inherit}
.theone-opening button{padding:8px 16px;font:inherit;color:inherit;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
`

export const catalogCss = `
button:has(.theone-catalog-entry)>span:not(:has(.theone-catalog-entry)){display:none}
.theone-catalog{--t-fg:var(--dsw-alias-label-primary,#18181b);--t-muted:var(--dsw-alias-label-secondary,#6b6b72);--t-rule:var(--dsw-alias-border-l2,#18181b1f);--t-accent:#b4531c;--t-warn:#c2410c;--t-field:#18181b0a;
  container-type:inline-size;box-sizing:border-box;height:100%;overflow:auto;padding:48px 56px 96px;color:var(--t-fg);font-feature-settings:"tnum" 1}
[data-ds-dark-theme] .theone-catalog{--t-accent:#8cc2ef;--t-warn:#fb923c;--t-field:#ffffff0d}
.theone-catalog>*{max-width:1120px;margin-left:auto;margin-right:auto}
.theone-catalog button{font:inherit;font-size:13px;line-height:1.4;color:inherit;background:transparent;border:1px solid var(--t-rule);border-radius:6px;padding:6px 12px;cursor:pointer;white-space:nowrap}
.theone-catalog button:hover:not(:disabled){border-color:var(--t-fg)}
.theone-catalog button:disabled{opacity:.4;cursor:default}
.theone-catalog button:focus-visible{outline:2px solid var(--t-accent);outline-offset:2px}
.theone-catalog .theone-primary{background:var(--t-fg);border-color:var(--t-fg);color:var(--dsw-alias-bg-primary,#fff)}
[data-ds-dark-theme] .theone-catalog .theone-primary{color:#111}
.theone-catalog .theone-quiet{border-color:transparent;color:var(--t-muted);padding-left:6px;padding-right:6px}
.theone-catalog .theone-quiet:hover:not(:disabled){border-color:transparent;color:var(--t-fg);text-decoration:underline;text-underline-offset:3px}
.theone-catalog .theone-continue{border-color:transparent;color:var(--t-accent);font-weight:600;padding-left:0;padding-right:6px}
.theone-catalog .theone-continue:hover:not(:disabled){border-color:transparent;text-decoration:underline;text-underline-offset:3px}
.theone-catalog-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:24px 48px;padding-bottom:28px;border-bottom:2px solid var(--t-fg)}
.theone-overline{margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--t-accent)}
.theone-catalog h1{margin:0;font-size:44px;line-height:1.05;font-weight:700;letter-spacing:-.02em}
.theone-catalog-lede{margin:14px 0 0;max-width:34em;font-size:15px;line-height:1.6;color:var(--t-muted)}
.theone-figures{display:flex;gap:40px;margin:0}
.theone-figures>div{display:flex;flex-direction:column-reverse;gap:6px;min-width:64px}
.theone-figures dd{margin:0;font-size:40px;line-height:1;font-weight:600;letter-spacing:-.02em}
.theone-figures dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted)}
.theone-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px;padding:14px 0 40px}
.theone-catalog-status{margin:0;font-size:13px;color:var(--t-muted)}
.theone-catalog-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.theone-catalog-note,.theone-catalog-empty{color:var(--t-muted);font-size:14px;line-height:1.7}
.theone-catalog-empty{padding:48px 0}
.theone-catalog-warning{margin:0 0 24px;padding:10px 0 10px 14px;border-left:2px solid var(--t-warn);font-size:13px;line-height:1.6}
.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}
.theone-routes{margin-bottom:56px;border-top:1px solid var(--t-rule);border-bottom:1px solid var(--t-rule)}
.theone-routes summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:14px 0;cursor:pointer;font-size:13px;font-weight:600;letter-spacing:.04em;list-style:none}
.theone-routes summary::-webkit-details-marker{display:none}
.theone-routes summary::before{content:"+";display:inline-block;width:14px;color:var(--t-muted);font-weight:400}
.theone-routes[open] summary::before{content:"−"}
.theone-routes summary>span{color:var(--t-muted);font-weight:400}
.theone-route-stats{font-weight:400;color:var(--t-muted);font-size:12px}
.theone-routes .theone-manage-hint{margin:0 0 12px 26px;max-width:46em}
.theone-routes ol{list-style:none;margin:0;padding:0 0 8px}
.theone-routes li{display:grid;grid-template-columns:52px minmax(0,1.3fr) minmax(0,1fr) auto;gap:4px 20px;align-items:baseline;padding:10px 0;border-top:1px solid var(--t-rule);font-size:13px}
.theone-routes time{color:var(--t-muted)}
.theone-routes q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;quotes:none}
.theone-route-target{display:flex;flex-direction:column;gap:2px;min-width:0}
.theone-route-target strong{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-route-target small{color:var(--t-muted);font-size:12px}
.theone-route-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.theone-route-fixed{color:var(--t-muted);font-size:12px}
.theone-routes select{width:auto;max-width:150px;padding-top:4px;padding-bottom:4px;font-size:12px}
.theone-catalog-groups{display:flex;flex-direction:column;gap:56px}
.theone-topic-group{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,9fr);gap:0 40px;border-top:2px solid var(--t-fg);padding-top:16px}
.theone-group-head{position:sticky;top:0;align-self:start}
.theone-group-index{display:block;margin-bottom:10px;font-size:13px;font-weight:600;color:var(--t-accent)}
.theone-topic-group h2{margin:0;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-.01em}
.theone-topic-group h2 span{margin-left:8px;font-size:13px;font-weight:400;color:var(--t-muted)}
.theone-group-summary{margin:10px 0 0;font-size:13px;line-height:1.6;color:var(--t-muted)}
.theone-topic-list{list-style:none;margin:0;padding:0}
.theone-topic-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 32px;padding:18px 0 20px;border-top:1px solid var(--t-rule)}
.theone-topic-card:first-child{border-top:0;padding-top:4px}
.theone-topic-card.theone-hidden .theone-topic-main{opacity:.6}
.theone-topic-card h3{margin:0;font-size:16px;line-height:1.4;font-weight:600}
.theone-topic-summary{margin:6px 0 0;max-width:42em;font-size:14px;line-height:1.6;color:var(--t-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.theone-topic-meta{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 16px;margin:14px 0 0;max-width:46em;font-size:13px;line-height:1.55}
.theone-topic-meta dt{color:var(--t-muted);font-size:12px;white-space:nowrap}
.theone-topic-meta dd{margin:0}
.theone-tag{display:inline-block;margin-left:8px;padding:0 6px;border:1px solid var(--t-rule);border-radius:4px;font-size:11px;color:var(--t-muted)}
.theone-topic-main h3 .theone-tag{vertical-align:middle;font-weight:400;letter-spacing:0}
.theone-status-waiting{color:var(--t-warn);border-color:currentColor}
.theone-status-done{color:var(--t-accent);border-color:currentColor}
.theone-topic-warning{margin:10px 0 0;padding-left:12px;border-left:2px solid var(--t-warn);font-size:12px;line-height:1.6}
.theone-topic-actions{display:flex;flex-direction:column;align-items:flex-end;gap:0}.theone-topic-actions button{padding-top:3px;padding-bottom:3px}
.theone-topic-edit{grid-column:1/-1;margin-top:12px;padding:4px 0 4px 20px;border-left:2px solid var(--t-accent)}
.theone-topic-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 16px;font-size:13px}
.theone-links-label,.theone-links-empty{color:var(--t-muted)}
.theone-link-chip{display:inline-flex;align-items:center;gap:2px;padding:2px 2px 2px 10px;border:1px solid var(--t-rule);border-radius:4px}
.theone-catalog .theone-link-chip button{border:0;padding:0 6px;font-size:14px;line-height:1;color:var(--t-muted)}
.theone-link-private{display:inline-flex;align-items:center;gap:6px;color:var(--t-muted);cursor:pointer}
.theone-catalog input:not([type=checkbox]),.theone-catalog textarea,.theone-catalog select{font:inherit;font-size:13px;color:inherit;background:var(--t-field);border:1px solid transparent;border-bottom-color:var(--t-rule);border-radius:4px 4px 0 0;padding:7px 10px;box-sizing:border-box;min-width:0}
.theone-catalog input:not([type=checkbox]):focus,.theone-catalog textarea:focus,.theone-catalog select:focus{outline:none;border-bottom-color:var(--t-accent)}
.theone-manage{display:flex;flex-direction:column;gap:14px;font-size:13px}
.theone-create{flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 40px;padding:16px 0;border-top:1px solid var(--t-rule);border-bottom:1px solid var(--t-rule)}
.theone-create input{flex:1;min-width:200px}
.theone-manage-field{display:flex;flex-direction:column;gap:6px}
.theone-manage-field>span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted)}
.theone-manage textarea{resize:vertical;width:100%}
.theone-manage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.theone-manage-row select,.theone-manage-row input{flex:1;min-width:160px}
.theone-manage-hint{margin:0;font-size:12px;line-height:1.6;color:var(--t-muted)}
.theone-catalog .theone-danger{color:var(--t-warn);border-color:var(--t-warn)}
@container (max-width:860px){.theone-topic-group{grid-template-columns:1fr}.theone-group-head{position:static;margin-bottom:20px}.theone-catalog-header{grid-template-columns:1fr}.theone-figures{gap:32px}}
@container (max-width:640px){.theone-catalog h1{font-size:32px}.theone-figures dd{font-size:30px}.theone-topic-card{grid-template-columns:1fr}.theone-topic-actions{flex-direction:row;flex-wrap:wrap;align-items:center}.theone-routes li{grid-template-columns:44px minmax(0,1fr)}.theone-route-target,.theone-route-actions{grid-column:2}.theone-route-actions{justify-content:flex-start}}
@media(max-width:640px){.theone-catalog{padding:28px 16px 64px}}
`

export const composerCss = `
.theone-bg{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;white-space:nowrap;cursor:pointer;max-width:220px}
.theone-bg:hover,.theone-bg[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.theone-bg:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4a7fb5);outline-offset:1px}
.theone-bg:disabled{opacity:.6;cursor:default}
.theone-bg-caption,.theone-bg-chevron{color:var(--dsw-alias-label-secondary)}
.theone-bg-text{overflow:hidden;text-overflow:ellipsis;display:var(--dsh-composer-model-text-display,inline)}
.theone-bg-caption,.theone-bg-chevron{display:inline-flex}
.theone-bg[data-failed=true] .theone-bg-caption{color:#d9480f}
.theone-bg-menu{position:fixed;z-index:10000;width:280px;max-height:min(420px,70vh);display:flex;flex-direction:column;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);box-shadow:0 10px 32px #0003;font:inherit;font-size:14px;box-sizing:border-box}
.theone-bg-heading{padding:8px 10px 6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.theone-bg-search{margin:0 4px 6px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}
.theone-bg-search:focus{border-color:var(--dsw-focus-ring-color,#4a7fb5)}
.theone-bg-list{overflow:auto;min-height:0}
.theone-bg-group{padding:8px 10px 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.theone-bg-item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.theone-bg-item:hover,.theone-bg-item:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.theone-bg-item span:first-child{flex:0 1 auto;min-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-bg-item small{flex:0 100 auto;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.theone-bg-check{margin-left:auto;flex:none;width:14px;text-align:center;color:var(--dsw-alias-label-primary)}
.theone-bg-empty{margin:8px 10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
`

export const settingsCss = `
.theone-settings{--one-settings-accent:#a75b1e}[data-ds-dark-theme] .theone-settings{--one-settings-accent:#93c8f3}
.theone-settings input,.theone-settings select{width:100%;box-sizing:border-box;min-height:38px;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;color:inherit;background:var(--dsw-specific-sidebar-fill)}.theone-settings input:focus-visible,.theone-settings select:focus-visible{outline:2px solid var(--one-settings-accent);outline-offset:2px}.theone-settings input:disabled,.theone-settings select:disabled,.theone-settings button:disabled{opacity:.5;cursor:default}.theone-settings small{display:block;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:12px}
.theone-settings-footer{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:15px 16px;margin-top:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 -4px 20px #00007;z-index:2}.theone-settings-footer p{flex:1;min-width:180px;margin:0;font-size:13px;line-height:1.6}.theone-settings .theone-settings-save{color:var(--one-settings-accent);border-color:color-mix(in srgb,var(--one-settings-accent) 35%,transparent);background:color-mix(in srgb,var(--one-settings-accent) 9%,var(--dsw-specific-sidebar-fill))}
.theone-context-menu{position:fixed;z-index:10000;min-width:160px;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);box-shadow:0 8px 30px #0002;font:inherit}
.theone-context-menu button{display:block;width:100%;padding:9px 14px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.theone-context-menu button:hover,.theone-context-menu button:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.theone-settings{height:100%;overflow:auto;box-sizing:border-box;padding:32px max(24px,calc((100% - 980px)/2));color:var(--dsw-alias-label-primary);font:inherit}
.theone-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.theone-settings h1{font-size:26px;margin:0 0 8px;outline:none}.theone-settings h2{font-size:17px;margin:0 0 16px}.theone-settings-header p,.theone-settings-help{color:var(--dsw-alias-label-secondary);line-height:1.6;margin:0 0 18px}
.theone-settings button{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:9px 14px;background:var(--dsw-alias-interactive-bg-hover);color:inherit;font:inherit;cursor:pointer;white-space:nowrap}.theone-settings button:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}
.theone-settings-notice{padding:13px 16px;border:1px solid #ed9b412a;background:#f3940710;border-radius:12px;font-size:13px;line-height:1.7;margin:0 0 22px}
.theone-weixin-login{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:6px 0 12px}.theone-weixin-qr{background:#fff;border-radius:12px;padding:6px;image-rendering:pixelated}.theone-weixin input{min-width:8em}.theone-weixin .theone-settings-update-actions+p{margin-top:12px}.theone-settings-update p{margin:0 0 10px;line-height:1.7}.theone-settings-update-version{color:var(--dsw-alias-label-secondary);font-size:13px}.theone-settings-update-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.theone-settings-summary,.theone-settings-group{border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:22px;margin-bottom:20px}.theone-settings-summary{background:#88804}.theone-settings-summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.theone-settings dl{margin:0}.theone-settings-summary dt{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}.theone-settings dd{margin:0;overflow-wrap:anywhere;line-height:1.6}.theone-settings-summary dd{font-size:15px}.theone-settings-summary p{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:16px 0 0}
.theone-settings-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,42%);gap:24px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}.theone-settings-row:first-child{border-top:0;padding-top:0}.theone-settings-row:last-child{padding-bottom:0}.theone-settings-row strong{font-size:14px;font-weight:500}.theone-settings-row p{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:6px 0}.theone-settings-row code{font-size:11px;color:var(--dsw-alias-label-secondary)}.theone-settings-row dd{font-size:13px;padding-top:1px}.theone-settings-row[data-inactive=true]{opacity:.6}
@media(max-width:640px){.theone-settings{padding:20px 16px}.theone-settings-header{flex-wrap:wrap}.theone-settings-summary,.theone-settings-group{padding:18px}.theone-settings-summary dl{grid-template-columns:1fr}.theone-settings-row{grid-template-columns:1fr;gap:10px}}
`
