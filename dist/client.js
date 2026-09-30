window.__ModuleLoader__.load({id:"dsh-theone",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");

// src/client-navigation.ts
var GatewayNavigation = class {
  constructor(host, storage, key, uuid) {
    this.host = host;
    this.storage = storage;
    this.key = key;
    this.uuid = uuid;
  }
  pending;
  listeners = /* @__PURE__ */ new Set();
  getSnapshot = () => this.storage.getItem(this.key);
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async open() {
    const signal = this.host.beginNavigation();
    this.pending ??= this.ensure().finally(() => {
      this.pending = void 0;
    });
    const id = await this.pending;
    if (!signal.aborted) this.host.open(id);
    return id;
  }
  async ensure() {
    let id = this.getSnapshot();
    if (!id) {
      id = this.uuid();
      this.storage.setItem(this.key, id);
      for (const listener of this.listeners) listener();
    }
    if (!await this.host.exists(id)) await this.host.create(id);
    await this.host.prepare(id);
    return id;
  }
};

// src/client.ts
var inject = ["slots", "sessions", "workspaces", "layout", "uiWorkspace", "modelDirectories", "remote.session"];
var panelId = "theone-gateway";
function apply(ctx) {
  const lifetime = new AbortController();
  async function workspaceForGateway() {
    const known = ctx.workspaces.list.getSnapshot().items;
    const workspace = known[0] ?? await ctx.workspaces.initializeDefault(lifetime.signal);
    if (!workspace) throw new Error("Create a DSH workspace before opening TheOne");
    return workspace.workspaceId;
  }
  const navigation = new GatewayNavigation({
    async exists(id) {
      await ctx.sessions.refresh();
      return ctx.sessions.list.getSnapshot().ids.includes(id);
    },
    async create(id) {
      await ctx.sessions.create({ sessionId: id, workspaceId: await workspaceForGateway() });
    },
    async prepare(id) {
      const target = id;
      if (!ctx.sessions.list.getSnapshot().byId[target]?.cwd) {
        await ctx.sessions.create({ sessionId: target, workspaceId: await workspaceForGateway() });
      }
      await ctx.sessions.using(target, { source: "controllerOperation", signal: lifetime.signal }, async (reference) => {
        await reference.ready;
        lifetime.signal.throwIfAborted();
        const selected = await ctx.modelDirectories.directoryFor(target).select({ provider: "theone", model: "gateway" });
        if (!selected.ok) throw selected.error;
        const renamed = await reference.binding.session.rename("TheOne \xB7 \u4E3B\u804A\u5929");
        if (!renamed.ok) throw renamed.error;
      });
      await ctx.uiWorkspace.unarchiveSession(target);
    },
    open(id) {
      if (!lifetime.signal.aborted) ctx.uiWorkspace.openSession(id);
    },
    beginNavigation() {
      return AbortSignal.any([ctx.layout.beginNavigation(), lifetime.signal]);
    }
  }, window.localStorage, `dsh-theone.gateway.v1:${location.pathname}`, () => crypto.randomUUID());
  function SidebarEntry({ size }) {
    const id = (0, import_react.useSyncExternalStore)(navigation.subscribe, navigation.getSnapshot);
    const sessions = (0, import_react.useSyncExternalStore)(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot);
    const panel = (0, import_react.useSyncExternalStore)(ctx.layout.panelInfo.subscribe, ctx.layout.panelInfo.getSnapshot);
    const active = panel.activePanelId === panelId || panel.activePanelId === null && !!id && !!sessions.byId[id]?.retainedBy.mainView;
    return (0, import_react.createElement)(
      "span",
      { className: "theone-nav", "data-wide": size === 16, "data-active": active },
      (0, import_react.createElement)("span", { className: "theone-symbol" }),
      size === 16 && (0, import_react.createElement)(
        "span",
        { className: "theone-entry-copy" },
        (0, import_react.createElement)(
          "span",
          { className: "theone-entry-title" },
          (0, import_react.createElement)(
            "span",
            { className: "theone-wordmark" },
            (0, import_react.createElement)("span", { className: "theone-word-the" }, "The"),
            (0, import_react.createElement)("span", { className: "theone-word-one" }, "One", (0, import_react.createElement)("span", { className: "theone-word-dot" }))
          ),
          (0, import_react.createElement)("span", { className: "theone-entry-label" }, "\u4E3B\u804A\u5929")
        ),
        (0, import_react.createElement)("span", { className: "theone-entry-sub" }, "\u4ECE\u8FD9\u91CC\u7EE7\u7EED\u804A")
      )
    );
  }
  function GatewayPanel() {
    const [error, setError] = (0, import_react.useState)();
    const [attempt, setAttempt] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => {
      let mounted = true;
      setError(void 0);
      void navigation.open().catch((error2) => {
        console.warn("TheOne gateway navigation failed:", error2 instanceof Error ? error2.message : "Unknown navigation error");
        if (mounted) setError("\u4E3B\u804A\u5929\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u548C TheOne \u63D2\u4EF6\u72B6\u6001\u3002");
      });
      return () => {
        mounted = false;
      };
    }, [attempt]);
    return (0, import_react.createElement)(
      "section",
      { className: "theone-opening", "aria-live": "polite" },
      (0, import_react.createElement)("p", null, error ?? "\u6B63\u5728\u6253\u5F00 TheOne \u4E3B\u804A\u5929\u2026"),
      error && (0, import_react.createElement)("button", { type: "button", onClick: () => setAttempt((value) => value + 1) }, "\u91CD\u8BD5")
    );
  }
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-theone";
    style.textContent = sidebarCss;
    document.head.append(style);
    return () => {
      lifetime.abort();
      style.remove();
    };
  });
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: panelId }, GatewayPanel));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: panelId, order: -1e3, label: "TheOne \xB7 \u4E3B\u804A\u5929" }, SidebarEntry));
}
var sidebarCss = `
button:has(.theone-nav){--one-accent:#a75b1e;--one-tint:#fff5ec;--one-line:#eed3bb;--one-glow:0 0 22px 4px #ff6b0024,0 4px 32px 6px #ff76000d;border:1px solid var(--one-line);background:var(--one-tint);box-shadow:var(--one-glow);overflow:visible;border-radius:12px;color:var(--dsw-alias-label-primary);flex:none}
[data-ds-dark-theme] button:has(.theone-nav){--one-accent:#93c8f3;--one-tint:#1d2a37;--one-line:#344d64;--one-glow:0 0 22px 4px #80bae924}
button:has(.theone-nav[data-wide=true]){padding:12px 10px;min-height:64px;margin-top:4px;margin-bottom:18px}
button:has(.theone-nav[data-wide=true])>span:not(:has(.theone-nav)){display:none}
button:has(.theone-nav):hover{background:var(--one-tint);border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
button:has(.theone-nav[data-active=true]){border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
.theone-nav{display:flex;align-items:center;gap:10px;color:var(--one-accent);font-family:inherit}
.theone-symbol{width:18px;height:18px;border:1px solid currentColor;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none}
.theone-symbol:after{content:'';width:4px;height:4px;border-radius:50%;background:currentColor}
.theone-nav[data-wide=true] .theone-symbol{margin:0 3px}
.theone-entry-copy{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.theone-entry-title{display:flex;align-items:center;gap:9px;line-height:22px}
.theone-wordmark{display:inline-flex;align-items:baseline;gap:1px;white-space:nowrap}
.theone-word-the{font-size:12px;font-weight:400;letter-spacing:-.25px;color:var(--dsw-alias-label-secondary)}
.theone-word-one{position:relative;font-family:ui-rounded,'SF Pro Rounded','Avenir Next',sans-serif;font-size:19px;line-height:1.15;font-weight:500;letter-spacing:-1px;transform:rotate(-4deg);padding-right:7px}
.theone-word-dot{position:absolute;right:0;top:2px;width:4px;height:4px;border-radius:50%;background:currentColor}
.theone-entry-label{font-size:12px;font-weight:400}
.theone-entry-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.theone-opening{padding:32px;color:var(--dsw-alias-label-primary);font:inherit}
.theone-opening button{padding:8px 16px;font:inherit;color:inherit;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
`;
return module.exports;}});
