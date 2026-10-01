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
var catalogPanelId = "theone-catalog";
function apply(ctx) {
  const lifetime = new AbortController();
  async function createGateway(id) {
    const response = await fetch("/api/theone/gateway", { signal: lifetime.signal, cache: "no-store" });
    if (!response.ok) throw new Error("Global gateway directory unavailable");
    const { cwd } = await response.json();
    await ctx.sessions.create({ sessionId: id, cwd });
  }
  const navigation = new GatewayNavigation({
    async exists(id) {
      await ctx.sessions.refresh();
      return ctx.sessions.list.getSnapshot().ids.includes(id);
    },
    create: createGateway,
    async prepare(id) {
      const target = id;
      if (!ctx.sessions.list.getSnapshot().byId[target]?.cwd) {
        await createGateway(id);
      }
      await ctx.sessions.using(target, { source: "controllerOperation", signal: lifetime.signal }, async (reference) => {
        await reference.ready;
        lifetime.signal.throwIfAborted();
        const selected = await ctx.modelDirectories.directoryFor(target).select({ provider: "theone", model: "gateway" });
        if (!selected.ok) throw selected.error;
        const renamed = await reference.binding.session.rename("TheOne \xB7 \u4E3B\u804A\u5929");
        if (!renamed.ok) throw renamed.error;
      });
      const prepared = await fetch("/api/theone/gateway/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
        signal: lifetime.signal
      });
      if (!prepared.ok) throw new Error("Global gateway preparation failed");
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
            { className: "theone-wordmark", translate: "no" },
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
  function CatalogPanel() {
    const [snapshot, setSnapshot] = (0, import_react.useState)();
    const [error, setError] = (0, import_react.useState)();
    const [busy, setBusy] = (0, import_react.useState)();
    (0, import_react.useEffect)(() => {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, lifetime.signal]);
      let reading = false;
      async function load() {
        if (reading || signal.aborted) return;
        reading = true;
        try {
          const response = await fetch("/api/theone/catalog", { signal, cache: "no-store" });
          if (!response.ok) throw new Error("Catalog unavailable");
          const value = await response.json();
          if (!signal.aborted) {
            setSnapshot(value);
            setError(void 0);
          }
        } catch {
          if (!signal.aborted) setError("\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u8BDD\u9898\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u3002");
        } finally {
          reading = false;
        }
      }
      void load();
      const timer = setInterval(() => {
        void load();
      }, 5e3);
      return () => {
        controller.abort();
        clearInterval(timer);
      };
    }, []);
    async function continueTopic(contextId) {
      setBusy(contextId);
      setError(void 0);
      try {
        const response = await fetch("/api/theone/context/mount", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contextId }),
          signal: lifetime.signal
        });
        if (!response.ok) throw new Error("Mount unavailable");
        await navigation.open();
      } catch {
        setError("\u6682\u65F6\u65E0\u6CD5\u7EE7\u7EED\u8FD9\u4E2A\u8BDD\u9898\uFF0C\u8BF7\u7B49\u5F53\u524D\u804A\u5929\u7ED3\u675F\u540E\u91CD\u8BD5\u3002");
      } finally {
        setBusy(void 0);
      }
    }
    async function refresh() {
      setBusy("refresh");
      setError(void 0);
      try {
        const response = await fetch("/api/theone/catalog/refresh", { method: "POST", signal: lifetime.signal });
        if (!response.ok) throw new Error("Refresh unavailable");
      } catch {
        setError("\u6682\u65F6\u65E0\u6CD5\u6574\u7406\u5386\u53F2\uFF0C\u8BF7\u68C0\u67E5 DSH \u6A21\u578B\u914D\u7F6E\u3002");
      } finally {
        setBusy(void 0);
      }
    }
    const assigned = new Set(snapshot?.groups.flatMap((group) => group.contextIds) ?? []);
    const groups = [...snapshot?.groups ?? [], ...snapshot?.contexts.some((c) => !assigned.has(c.id)) ? [{ id: "pending", title: "\u5F85\u6574\u7406", summary: "\u8FD9\u4E9B\u8BDD\u9898\u8FD8\u5728\u7B49\u5F85\u81EA\u52A8\u5F52\u7C7B\u3002", contextIds: snapshot.contexts.filter((c) => !assigned.has(c.id)).map((c) => c.id) }] : []];
    const status = snapshot?.status;
    return (0, import_react.createElement)(
      "section",
      { className: "theone-catalog", translate: "no" },
      (0, import_react.createElement)(
        "header",
        { className: "theone-catalog-header" },
        (0, import_react.createElement)("div", null, (0, import_react.createElement)("h1", null, "\u8BDD\u9898\u5DE5\u4F5C\u533A"), (0, import_react.createElement)("p", null, "\u76F8\u5173\u7684\u4E8B\u60C5\u653E\u5728\u4E00\u8D77\uFF0C\u968F\u65F6\u56DE\u5230\u4E3B\u804A\u5929\u7EE7\u7EED\u3002")),
        (0, import_react.createElement)("button", { type: "button", onClick: refresh, disabled: !!busy || status?.running }, "\u6574\u7406\u5386\u53F2")
      ),
      (0, import_react.createElement)("p", { className: "theone-catalog-status", role: "status" }, snapshot ? `${snapshot.contexts.length} \u4E2A\u8BDD\u9898 \xB7 ${snapshot.groups.length} \u4E2A\u5206\u7EC4` + (status?.running ? " \xB7 \u6B63\u5728\u6574\u7406\u5386\u53F2\u2026" : status?.pending ? ` \xB7 \u8FD8\u6709 ${status.pending} \u4E2A\u4F1A\u8BDD\u5F85\u6574\u7406` : " \xB7 \u5386\u53F2\u76EE\u5F55\u5DF2\u66F4\u65B0") : "\u6B63\u5728\u8BFB\u53D6\u8BDD\u9898\u2026"),
      status?.failed ? (0, import_react.createElement)("p", { className: "theone-catalog-warning" }, `${status.failed} \u4E2A\u4F1A\u8BDD\u6682\u65F6\u672A\u80FD\u6574\u7406\uFF0C\u7A0D\u540E\u4F1A\u91CD\u8BD5\u3002\u5DF2\u6709\u8BDD\u9898\u4ECD\u53EF\u67E5\u770B\u3002`) : null,
      status?.searchUnavailable ? (0, import_react.createElement)("p", { className: "theone-catalog-warning" }, "\u90E8\u5206\u5386\u53F2\u6682\u65F6\u65E0\u6CD5\u68C0\u7D22\uFF0C\u4ECD\u53EF\u4ECE\u8BDD\u9898\u76EE\u5F55\u7EE7\u7EED\u804A\u5929\u3002") : null,
      error ? (0, import_react.createElement)("p", { role: "alert", className: "theone-catalog-warning" }, error) : null,
      snapshot && !snapshot.contexts.length ? (0, import_react.createElement)("p", { className: "theone-catalog-empty" }, status?.running ? "\u6B63\u5728\u4ECE\u4EE5\u524D\u7684\u804A\u5929\u4E2D\u6574\u7406\u8BDD\u9898\u3002\u4F60\u4E5F\u53EF\u4EE5\u5148\u56DE\u5230\u4E3B\u804A\u5929\u3002" : "\u76EE\u524D\u8FD8\u6CA1\u6709\u6574\u7406\u51FA\u8BDD\u9898\u3002\u5F00\u59CB\u804A\u5929\u540E\uFF0C\u5B83\u4EEC\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002") : null,
      (0, import_react.createElement)("div", { className: "theone-catalog-groups" }, ...groups.map((group) => (0, import_react.createElement)(
        "section",
        { key: group.id, className: "theone-topic-group" },
        (0, import_react.createElement)("h2", null, group.title, (0, import_react.createElement)("span", null, ` ${group.contextIds.length}`)),
        group.summary ? (0, import_react.createElement)("p", { className: "theone-group-summary" }, group.summary) : null,
        ...group.contextIds.flatMap((id) => {
          const topic = snapshot?.contexts.find((c) => c.id === id);
          if (!topic) return [];
          return [(0, import_react.createElement)(
            "article",
            { key: id, className: "theone-topic-card" },
            (0, import_react.createElement)("h3", null, topic.title),
            (0, import_react.createElement)("p", null, topic.summary),
            (0, import_react.createElement)(
              "div",
              { className: "theone-topic-actions" },
              (0, import_react.createElement)("button", { type: "button", disabled: !!busy, onClick: () => {
                void continueTopic(id);
              } }, busy === id ? "\u6B63\u5728\u6253\u5F00\u2026" : "\u7EE7\u7EED\u804A\u5929"),
              ...topic.sourceSessionIds.slice(0, 3).map((sessionId, i) => (0, import_react.createElement)("button", {
                key: sessionId,
                type: "button",
                className: "theone-source-link",
                onClick: () => {
                  ctx.layout.beginNavigation();
                  ctx.uiWorkspace.openSession(sessionId);
                }
              }, `\u67E5\u770B\u539F\u4F1A\u8BDD${topic.sourceSessionIds.length > 1 ? " " + (i + 1) : ""}`))
            )
          )];
        })
      )))
    );
  }
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-theone";
    style.textContent = sidebarCss + catalogCss;
    document.head.append(style);
    return () => {
      lifetime.abort();
      style.remove();
    };
  });
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-theone-gateway-row";
    const update = () => {
      const id = navigation.getSnapshot();
      style.textContent = id ? `[role="treeitem"][data-row-key="${CSS.escape(`session:${id}`)}"]{display:none!important}` : "";
    };
    update();
    const unsubscribe = navigation.subscribe(update);
    window.addEventListener("storage", update);
    document.head.append(style);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", update);
      style.remove();
    };
  });
  ctx.slots.inject("main", () => [
    ctx.slots.register({ name: "main", key: panelId }, GatewayPanel),
    ctx.slots.register({ name: "main", key: catalogPanelId }, CatalogPanel)
  ]);
  ctx.slots.inject("sidebar.panellist", () => [
    ctx.slots.register({ name: "sidebar.panellist", id: panelId, order: -1e3, label: "TheOne \xB7 \u4E3B\u804A\u5929" }, SidebarEntry),
    ctx.slots.register({ name: "sidebar.panellist", id: catalogPanelId, order: -999, label: "\u8BDD\u9898\u5DE5\u4F5C\u533A" }, ({ size }) => (0, import_react.createElement)("span", { className: "theone-catalog-entry" }, (0, import_react.createElement)("span", null, "\u25A6"), size === 16 ? (0, import_react.createElement)("span", null, "\u8BDD\u9898\u5DE5\u4F5C\u533A") : null))
  ]);
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
var catalogCss = `
button:has(.theone-catalog-entry)>span:not(:has(.theone-catalog-entry)){display:none}
.theone-catalog{padding:32px;max-width:1180px;margin:auto;box-sizing:border-box;height:100%;overflow:auto;color:var(--dsw-alias-label-primary)}
.theone-catalog-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.theone-catalog h1{font-size:24px;margin:0 0 8px}.theone-catalog-header p,.theone-catalog-status,.theone-group-summary{opacity:.65;margin:0 0 18px;line-height:1.6}.theone-catalog button{border:1px solid #8883;border-radius:9px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer;font:inherit;white-space:nowrap}.theone-catalog button:disabled{opacity:.5;cursor:default}.theone-catalog-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:20px}.theone-topic-group{border:1px solid #8882;border-radius:16px;padding:20px;background:#88805}.theone-topic-group h2{font-size:18px;margin:0 0 8px}.theone-topic-group h2 span{font-size:13px;opacity:.5}.theone-topic-card{border-top:1px solid #8882;padding:16px 0}.theone-topic-card:last-child{padding-bottom:0}.theone-topic-card h3{font-size:15px;line-height:1.5;margin:0 0 7px}.theone-topic-card p{font-size:13px;line-height:1.7;opacity:.75;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.theone-topic-actions{display:flex;gap:8px;flex-wrap:wrap}.theone-topic-actions button{font-size:12px}.theone-topic-actions .theone-source-link{border-color:transparent;opacity:.6}.theone-catalog-warning{background:#ff900011;padding:12px;border-radius:10px;font-size:13px}.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}.theone-catalog-empty{padding:40px 0;opacity:.65;line-height:1.8}@media(max-width:640px){.theone-catalog{padding:20px}.theone-catalog-header{align-items:flex-start}.theone-catalog-header h1{font-size:21px}}
`;
return module.exports;}});
