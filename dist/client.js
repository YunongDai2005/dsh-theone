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
var import_react2 = require("react");

// src/settings-types.ts
var EDITABLE_SETTINGS_KEYS = [
  "workerProvider",
  "workerModel",
  "routerMode",
  "historyCatalog",
  "catalogIntervalMs",
  "maxDescriptorChars",
  "maxResponseChars",
  "linkScope",
  "routeNotice",
  "contextsPath",
  "notices",
  "factLinks",
  "factExtraction"
];

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
      const known = await this.host.current().catch(() => void 0);
      id = known && await this.host.exists(known) ? known : this.uuid();
      this.storage.setItem(this.key, id);
      for (const listener of this.listeners) listener();
    }
    if (!await this.host.exists(id)) await this.host.create(id);
    await this.host.prepare(id);
    return id;
  }
};

// src/client-locales.ts
var zh = {
  "tasks.title": "\u6301\u7EED\u4EFB\u52A1",
  "tasks.help": "\u5728\u672C\u673A\u5B9A\u671F\u67E5\u770B\u516C\u5F00 GitHub PR \u548C CI \u6458\u8981\u3002\u6709\u65B0\u5931\u8D25\u3001\u901A\u8FC7\u6216\u5173\u95ED\u65F6\u901A\u77E5\u4E3B\u804A\u5929\u3002DSH \u5173\u95ED\u671F\u95F4\u6682\u505C\uFF0C\u542F\u52A8\u540E\u7EE7\u7EED\uFF1B\u4E0D\u4F1A\u6539\u4EE3\u7801\u3002\u5931\u8D25\u5206\u6790\u4F1A\u4F7F\u7528\u5F53\u524D\u540E\u53F0\u6A21\u578B\u3002",
  "tasks.objective": "\u60F3\u8DDF\u8FDB\u4EC0\u4E48",
  "tasks.url": "\u516C\u5F00 PR \u94FE\u63A5",
  "tasks.interval": "\u68C0\u67E5\u95F4\u9694\uFF08\u5206\u949F\uFF09",
  "tasks.budget": "\u6700\u591A\u68C0\u67E5\u6B21\u6570\uFF08\u542B\u5931\u8D25\u5C1D\u8BD5\uFF09",
  "tasks.hours": "\u6700\u591A\u6301\u7EED\u5C0F\u65F6\u6570",
  "tasks.completion": "\u5B8C\u6210\u6761\u4EF6",
  "tasks.closed": "PR \u5408\u5E76\u6216\u5173\u95ED",
  "tasks.passed": "\u5DF2\u8BFB\u53D6\u7684\u68C0\u67E5\u5168\u90E8\u901A\u8FC7\uFF0C\u6216 PR \u5173\u95ED",
  "tasks.create": "\u5F00\u59CB\u8DDF\u8FDB",
  "tasks.empty": "\u8FD8\u6CA1\u6709\u6301\u7EED\u4EFB\u52A1\u3002",
  "tasks.loadError": "\u4EFB\u52A1\u5217\u8868\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u3002",
  "tasks.actionError": "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5 PR \u94FE\u63A5\u3001\u65F6\u95F4\u548C\u6B21\u6570\u8BBE\u7F6E\uFF1B\u4EFB\u52A1\u72B6\u6001\u53EF\u80FD\u5DF2\u53D8\u5316\u3002",
  "tasks.openMain": "\u8BF7\u5148\u6253\u5F00 TheOne \u4E3B\u804A\u5929\uFF0C\u518D\u91CD\u8BD5\u3002",
  "tasks.used": "\u5DF2\u7528\u68C0\u67E5\u6B21\u6570",
  "tasks.deadline": "\u6700\u665A\u7ED3\u675F",
  "tasks.next": "\u4E0B\u6B21\u68C0\u67E5",
  "tasks.checked": "\u6700\u8FD1\u68C0\u67E5",
  "tasks.exhausted": "\u5DF2\u8FBE\u5230\u6B21\u6570\u6216\u65F6\u95F4\u4E0A\u9650\u3002\u9700\u8981\u7EE7\u7EED\u65F6\uFF0C\u8BF7\u65B0\u5EFA\u4EFB\u52A1\u3002",
  "tasks.failure": "\u672C\u6B21\u8BFB\u53D6\u6216\u5206\u6790\u5931\u8D25\u3002\u7CFB\u7EDF\u6700\u591A\u81EA\u52A8\u91CD\u8BD5\u4E24\u6B21\uFF1B\u4ECD\u5931\u8D25\u65F6\u53EF\u624B\u52A8\u6062\u590D\u3002\u516C\u5F00\u63A5\u53E3\u53EF\u80FD\u6682\u65F6\u9650\u6D41\u3002",
  "tasks.pause": "\u6682\u505C",
  "tasks.resume": "\u6062\u590D",
  "tasks.check": "\u73B0\u5728\u68C0\u67E5",
  "tasks.cancel": "\u53D6\u6D88",
  "tasks.review": "\u5230\u4E3B\u804A\u5929\u8BA8\u8BBA\u65B9\u6848",
  "tasks.state.queued": "\u7B49\u5F85\u68C0\u67E5",
  "tasks.state.running": "\u6B63\u5728\u68C0\u67E5",
  "tasks.state.paused": "\u5DF2\u6682\u505C",
  "tasks.state.waiting": "\u7B49\u5F85\u4F60\u5904\u7406",
  "tasks.state.completed": "\u5DF2\u5B8C\u6210",
  "tasks.state.failed": "\u68C0\u67E5\u5931\u8D25",
  "tasks.state.cancelled": "\u5DF2\u53D6\u6D88",
  "gateway.title": "TheOne \xB7 \u4E3B\u804A\u5929",
  "gateway.label": "\u4E3B\u804A\u5929",
  "gateway.subtitle": "\u4ECE\u8FD9\u91CC\u7EE7\u7EED\u804A",
  "gateway.opening": "\u6B63\u5728\u6253\u5F00 TheOne \u4E3B\u804A\u5929\u2026",
  "gateway.error": "\u4E3B\u804A\u5929\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u548C TheOne \u63D2\u4EF6\u72B6\u6001\u3002",
  "retry": "\u91CD\u8BD5",
  "settings.other": "\u5176\u4ED6",
  "settings.notices": "\u663E\u793A\u516C\u544A",
  "settings.factLinks": "\u5171\u4EAB\u5DF2\u786E\u8BA4\u7684\u8981\u70B9\uFF08\u5B9E\u9A8C\uFF09",
  "settings.help.factLinks": "\u8BDD\u9898\u4E4B\u95F4\u53EA\u5171\u4EAB\u7528\u6237\u4EB2\u81EA\u786E\u8BA4\u8FC7\u7684\u8981\u70B9\uFF08\u6570\u5B57\u3001\u51B3\u5B9A\u3001\u6587\u4EF6\u4F4D\u7F6E\uFF09\uFF0C\u5E26\u7248\u672C\u548C\u51FA\u5904\uFF1B\u8981\u70B9\u6539\u4E86\u6216\u64A4\u56DE\u4E86\uFF0C\u7528\u5230\u5B83\u7684\u8BDD\u9898\u4F1A\u6536\u5230\u63D0\u793A\u3002\u9ED8\u8BA4\u5173\u95ED\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
  "settings.factExtraction": "\u81EA\u52A8\u8BB0\u5F55\u8981\u70B9\uFF08\u5B9E\u9A8C\uFF09",
  "settings.help.factExtraction": "\u5F00\u542F\u300C\u5171\u4EAB\u5DF2\u786E\u8BA4\u7684\u8981\u70B9\u300D\u540E\uFF0C\u6BCF\u8F6E\u7ED3\u675F\u591A\u7528\u4E00\u6B21\u5C0F\u6A21\u578B\u8C03\u7528\uFF0C\u8865\u8BB0\u540E\u53F0\u4F1A\u8BDD\u6CA1\u8BB0\u4E0B\u7684\u8981\u70B9\uFF1B\u540C\u6837\u53EA\u6709\u7528\u6237\u786E\u8BA4\u8FC7\u7684\u624D\u4F1A\u5171\u4EAB\u3002\u9ED8\u8BA4\u5173\u95ED\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
  "settings.help.notices": "\u663E\u793A TheOne \u4F5C\u8005\u53D1\u5E03\u7684\u516C\u544A\uFF08\u65B0\u7248\u672C\u3001\u91CD\u8981\u63D0\u9192\u7B49\uFF09\u3002\u53EA\u4ECE yulid.org \u8BFB\u53D6\u4E00\u4E2A\u516C\u544A\u6587\u4EF6\uFF0C\u4E0D\u53D1\u9001\u4EFB\u4F55\u4F60\u7684\u6570\u636E\u3002",
  "notice.label": "\u516C\u544A",
  "notice.more": "\u67E5\u770B\u8BE6\u60C5",
  "notice.ok": "\u77E5\u9053\u4E86",
  "notice.close": "\u5173\u95ED\u8FD9\u6761\u516C\u544A",
  "bg.label": "\u540E\u53F0",
  "bg.follow": "\u9ED8\u8BA4",
  "bg.title": "\u540E\u53F0\u6A21\u578B\uFF1A\u5206\u914D\u8BDD\u9898\u548C\u5E72\u6D3B\u90FD\u7528\u5B83",
  "bg.followItem": "\u8DDF\u968F DSH \u9ED8\u8BA4\u6A21\u578B",
  "bg.hint": "\u540E\u53F0\u6A21\u578B\uFF1A{model}\u3002TheOne \u5206\u914D\u8BDD\u9898\u548C\u540E\u53F0\u5E72\u6D3B\u90FD\u7528\u8FD9\u4E2A\u6A21\u578B\u3002",
  "bg.hintFollow": "\u540E\u53F0\u6A21\u578B\uFF1A{model}\uFF08\u8DDF\u968F DSH \u9ED8\u8BA4\u6A21\u578B\uFF09\u3002\u70B9\u51FB\u53EF\u4EE5\u56FA\u5B9A\u4E3A\u5176\u4ED6\u6A21\u578B\u3002",
  "bg.search": "\u641C\u7D22\u6A21\u578B",
  "bg.none": "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B",
  "bg.error": "\u540E\u53F0\u6A21\u578B\u6CA1\u6709\u5207\u6362\u6210\u529F\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "update.available": "\u66F4\u65B0",
  "update.installing": "\u66F4\u65B0\u4E2D\u2026",
  "update.restart": "\u91CD\u542F\u751F\u6548",
  "update.waiting": "\u65B0\u7248\u672C",
  "update.waitingHint": "\u6709\u65B0\u7248\u672C {latest}\uFF0C\u53D1\u5E03\u8FD8\u4E0D\u6EE1 24 \u5C0F\u65F6\u3002\u70B9\u51FB\u67E5\u770B\u5982\u4F55\u73B0\u5728\u5B89\u88C5\u3002",
  "age.title": "\u65B0\u7248\u672C\u53D1\u5E03\u8FD8\u4E0D\u6EE1 24 \u5C0F\u65F6",
  "age.why": "DSH \u7528 pnpm \u5B89\u88C5\u63D2\u4EF6\uFF0C\u5B83\u9ED8\u8BA4\u53EA\u5B89\u88C5\u53D1\u5E03\u6EE1 24 \u5C0F\u65F6\u7684\u7248\u672C\uFF0C\u7528\u6765\u9632\u8303\u88AB\u7BE1\u6539\u7684\u65B0\u5305\u3002TheOne {version} \u521A\u53D1\u5E03\u4E0D\u4E45\uFF0C\u6240\u4EE5\u6682\u65F6\u88C5\u4E0D\u4E0A\u3002",
  "age.allowHow": "\u4F60\u53EF\u4EE5\u53EA\u4E3A TheOne \u653E\u884C\uFF1A\u5728\u8FD9\u4E2A DSH \u914D\u7F6E\u7684 pnpm \u8BBE\u7F6E\uFF08pnpm-workspace.yaml\uFF09\u91CC\u628A dsh-theone \u52A0\u5165\u4F8B\u5916\uFF0C\u7136\u540E\u7ACB\u5373\u5B89\u88C5\u3002\u5176\u4ED6\u63D2\u4EF6\u4ECD\u7136\u53D7 24 \u5C0F\u65F6\u89C4\u5219\u4FDD\u62A4\u3002",
  "age.cannot": "\u5F53\u524D\u65E0\u6CD5\u81EA\u52A8\u4FEE\u6539\u8FD9\u4E2A DSH \u914D\u7F6E\u7684 pnpm \u8BBE\u7F6E\u3002\u53EF\u4EE5\u7B49\u5B83\u6EE1 24 \u5C0F\u65F6\uFF0C\u6216\u6539\u7528 GitHub \u5730\u5740\u91CD\u65B0\u5B89\u88C5\u3002",
  "age.readyAt": "\u4E0D\u653E\u884C\u7684\u8BDD\uFF0C{time} \u4E4B\u540E\u5C31\u80FD\u76F4\u63A5\u66F4\u65B0\u3002",
  "age.wait": "\u7B49\u6EE1 24 \u5C0F\u65F6",
  "age.allow": "\u653E\u884C\u5E76\u66F4\u65B0",
  "age.ok": "\u77E5\u9053\u4E86",
  "update.reloading": "\u6B63\u5728\u91CD\u65B0\u52A0\u8F7D\u2026",
  "update.reloadingHint": "TheOne \u6B63\u5728\u7528\u65B0\u7248\u672C\u91CD\u65B0\u52A0\u8F7D\uFF0CDSH \u4E0D\u9700\u8981\u91CD\u542F\uFF1B\u5B8C\u6210\u540E\u9875\u9762\u4F1A\u81EA\u52A8\u5237\u65B0\u3002",
  "update.busy": "\u6709\u56DE\u590D\u6B63\u5728\u8FDB\u884C\uFF0C\u7B49\u5B83\u7ED3\u675F\u540E\u518D\u70B9\u66F4\u65B0\u3002",
  "update.tooNew": "DSH \u7684\u5B89\u5168\u7B56\u7565\u53EA\u5141\u8BB8\u5B89\u88C5\u53D1\u5E03\u6EE1 24 \u5C0F\u65F6\u7684\u7248\u672C\uFF0C\u8FD9\u4E00\u7248\u8FD8\u592A\u65B0\u3002\u8FC7\u4E00\u9635\u518D\u70B9\u4E00\u6B21\u5373\u53EF\u3002",
  "update.network": "\u8FDE\u4E0D\u4E0A\u4E0B\u8F7D\u6E90\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u70B9\u51FB\u91CD\u8BD5\u3002",
  "update.otherAge": "pnpm \u62D2\u7EDD\u5B89\u88C5\uFF1A{names} \u4E5F\u662F\u53D1\u5E03\u4E0D\u6EE1 24 \u5C0F\u65F6\u7684\u7248\u672C\uFF0C\u4E0D\u5F52 TheOne \u653E\u884C\u3002\u7B49\u5B83\u6EE1 24 \u5C0F\u65F6\u540E\u518D\u70B9\u4E00\u6B21\u3002",
  "update.ageStill": "\u5DF2\u4E3A TheOne \u653E\u884C\uFF0Cpnpm \u4ECD\u7136\u62D2\u7EDD\uFF1A{detail}\u3002\u5B8C\u6574\u65E5\u5FD7\u5728 DSH \u914D\u7F6E\u76EE\u5F55\u7684 .plugin-manager/logs \u91CC\u3002",
  "update.failed": "\u66F4\u65B0\u5931\u8D25",
  "update.hint": "\u5F53\u524D {current}\uFF0C\u53EF\u66F4\u65B0\u5230 {latest}\u3002\u70B9\u51FB\u4E00\u952E\u66F4\u65B0\uFF0C\u4E0D\u7528\u91CD\u542F DSH\u3002",
  "update.manualHint": "\u5F53\u524D {current}\uFF0C\u6700\u65B0 {latest}\u3002\u8FD9\u4EFD\u63D2\u4EF6\u4E0D\u662F\u4ECE GitHub \u6216 npm \u5B89\u88C5\u7684\uFF0C\u8BF7\u5728\u300C\u63D2\u4EF6\u300D\u9875\u9762\u91CD\u65B0\u5B89\u88C5\u3002",
  "update.restartHint": "\u5DF2\u66F4\u65B0\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
  "update.failedHint": "\u66F4\u65B0\u6CA1\u6709\u5B8C\u6210\uFF08{error}\uFF09\u3002\u70B9\u51FB\u91CD\u8BD5\uFF0C\u6216\u5728\u300C\u63D2\u4EF6\u300D\u9875\u9762\u91CD\u65B0\u5B89\u88C5\u3002",
  "settings.title": "TheOne \u8BBE\u7F6E",
  "settings.update": "\u66F4\u65B0",
  "settings.updateCurrent": "\u5F53\u524D\u7248\u672C {current}",
  "settings.updateLatest": "\u5DF2\u662F\u6700\u65B0\u7248\u672C\u3002DSH \u542F\u52A8\u65F6\u548C\u4E4B\u540E\u6BCF 6 \u5C0F\u65F6\u4E5F\u4F1A\u81EA\u52A8\u68C0\u67E5\u4E00\u6B21\u3002",
  "settings.updateUnknown": "\u8FD8\u6CA1\u6709\u68C0\u67E5\u8FC7\u3002",
  "settings.updateChecking": "\u6B63\u5728\u68C0\u67E5\u2026",
  "settings.updateCheckFailed": "\u68C0\u67E5\u5931\u8D25\uFF1A\u8FDE\u4E0D\u4E0A\u66F4\u65B0\u6E90\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002",
  "settings.updateCheck": "\u68C0\u67E5\u66F4\u65B0",
  "settings.updateInstall": "\u66F4\u65B0",
  "settings.weixin": "\u5FAE\u4FE1",
  "settings.weixinIntro": "\u626B\u7801\u7ED1\u5B9A\u4F60\u81EA\u5DF1\u7684\u5FAE\u4FE1\u3002\u4E4B\u540E\u5728\u5FAE\u4FE1\u91CC\u7ED9\u5B83\u53D1\u6D88\u606F\uFF0C\u5C31\u548C\u5728\u4E3B\u804A\u5929\u91CC\u8BF4\u8BDD\u4E00\u6837\uFF1A\u7167\u5E38\u5206\u5230\u8BDD\u9898\u3001\u5728\u540E\u53F0\u5E72\u6D3B\uFF0C\u56DE\u590D\u53D1\u56DE\u5FAE\u4FE1\u3002\u53EA\u8BA4\u626B\u7801\u7684\u672C\u4EBA\uFF0C\u522B\u4EBA\u53D1\u7684\u6D88\u606F\u4E0D\u4F1A\u8FDB\u4E3B\u804A\u5929\u3002",
  "settings.weixinNote": "\u7528\u7684\u662F\u817E\u8BAF iLink \u63A5\u53E3\uFF08\u548C OpenClaw \u5FAE\u4FE1\u63D2\u4EF6\u540C\u4E00\u5957\uFF09\u3002DSH \u5F00\u7740\u624D\u80FD\u6536\u5230\u6D88\u606F\uFF0C\u7535\u8111\u7761\u7720\u6216 DSH \u9000\u51FA\u65F6\u6536\u4E0D\u5230\u3002",
  "settings.weixinBind": "\u626B\u7801\u7ED1\u5B9A",
  "settings.weixinScan": "\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u8FD9\u4E2A\u7801\u3002",
  "settings.weixinScanned": "\u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u3002",
  "settings.weixinVerify": "\u624B\u673A\u4E0A\u663E\u793A\u4E86\u4E00\u4E2A\u9A8C\u8BC1\u7801\uFF0C\u8BF7\u586B\u5728\u8FD9\u91CC\uFF1A",
  "settings.weixinVerifySubmit": "\u63D0\u4EA4",
  "settings.weixinCancel": "\u53D6\u6D88",
  "settings.weixinFailed": "\u7ED1\u5B9A\u6CA1\u6709\u6210\u529F\uFF08{reason}\uFF09\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002",
  "settings.remoteOnline": "\u5DF2\u8FDE\u63A5 \xB7 \u8D26\u53F7 {account}",
  "settings.remoteConnecting": "\u6B63\u5728\u8FDE\u63A5 \xB7 \u8D26\u53F7 {account}",
  "settings.remotePaused": "\u670D\u52A1\u5668\u6682\u65F6\u62D2\u7EDD\u4E86\u767B\u5F55\uFF0C{minutes} \u5206\u949F\u540E\u81EA\u52A8\u91CD\u8BD5 \xB7 \u8D26\u53F7 {account}",
  "settings.weixinExpired": "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801\u3002",
  "settings.remoteOff": "\u5DF2\u6682\u505C\u63A5\u6536 \xB7 \u8D26\u53F7 {account}",
  "settings.remotePause": "\u6682\u505C\u63A5\u6536",
  "settings.remoteResume": "\u6062\u590D\u63A5\u6536",
  "settings.remoteLogout": "\u9000\u51FA\u767B\u5F55",
  "settings.weixinRescan": "\u91CD\u65B0\u626B\u7801",
  "settings.remoteError": "\u8BFB\u4E0D\u5230\u8FDE\u63A5\u72B6\u6001\u3002",
  "settings.remoteLastError": "\u6700\u8FD1\u4E00\u6B21\u51FA\u9519\uFF1A{error}",
  "settings.remoteConnect": "\u8FDE\u63A5",
  "settings.telegram": "Telegram",
  "settings.telegramIntro": "\u7ED1\u5B9A\u4E00\u4E2A\u4F60\u81EA\u5DF1\u7684 Telegram \u673A\u5668\u4EBA\uFF0C\u4E4B\u540E\u7ED9\u5B83\u53D1\u6D88\u606F\u5C31\u548C\u5728\u4E3B\u804A\u5929\u91CC\u8BF4\u8BDD\u4E00\u6837\uFF0C\u56DE\u590D\u4F1A\u53D1\u56DE Telegram\u3002\u53EA\u8BA4\u5B8C\u6210\u914D\u5BF9\u7684\u672C\u4EBA\u3002",
  "settings.telegramToken": "\u5728 Telegram \u91CC\u627E @BotFather\uFF0C\u53D1\u9001 /newbot \u5EFA\u4E00\u4E2A\u673A\u5668\u4EBA\uFF0C\u628A\u5B83\u7ED9\u7684 token \u7C98\u8D34\u5230\u8FD9\u91CC\uFF1A",
  "settings.telegramTokenInvalid": "\u8FD9\u4E2A token \u4E0D\u5BF9\uFF0C\u8BF7\u4ECE @BotFather \u91CD\u65B0\u590D\u5236\u3002",
  "settings.telegramUnreachable": "\u8FDE\u4E0D\u4E0A Telegram\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\uFF08\u53EF\u80FD\u9700\u8981\u4EE3\u7406\uFF09\u540E\u91CD\u8BD5\u3002",
  "settings.telegramPair": "\u7528\u624B\u673A\u626B\u8FD9\u4E2A\u7801\u6253\u5F00 {bot} \u5E76\u70B9\u300C\u5F00\u59CB\u300D\uFF1B\u6216\u8005\u5728 Telegram \u91CC\u7ED9 {bot} \u53D1\u9001 /start {code}\u3002\u7B2C\u4E00\u4E2A\u53D1\u6765\u914D\u5BF9\u7801\u7684\u4EBA\u4F1A\u6210\u4E3A\u5B83\u7684\u4E3B\u4EBA\u3002",
  "settings.telegramPairScan": "\u626B\u7801\u6253\u5F00\u673A\u5668\u4EBA",
  "settings.telegramWaiting": "\u7B49\u5F85\u914D\u5BF9 \xB7 \u673A\u5668\u4EBA {account}",
  "settings.telegramExpired": "\u673A\u5668\u4EBA\u7684 token \u5DF2\u5931\u6548\uFF08\u53EF\u80FD\u5728 @BotFather \u91CC\u91CD\u7F6E\u8FC7\uFF09\uFF0C\u8BF7\u91CD\u65B0\u586B\u5199\u3002",
  "settings.telegramNote": "token \u53EA\u5B58\u5728\u8FD9\u53F0\u7535\u8111\u4E0A\u3002DSH \u5F00\u7740\u624D\u80FD\u6536\u5230\u6D88\u606F\u3002",
  "settings.imessage": "iMessage",
  "settings.imessageIntro": "\u5728 Mac \u4E0A\uFF0C\u7528\u4F60\u81EA\u5DF1\u7684\u624B\u673A\u53F7\u6216 Apple ID \u53D1 iMessage \u7ED9\u8FD9\u53F0 Mac\uFF0C\u5C31\u548C\u5728\u4E3B\u804A\u5929\u91CC\u8BF4\u8BDD\u4E00\u6837\uFF0C\u56DE\u590D\u4F1A\u7528\u300C\u4FE1\u606F\u300D\u53D1\u56DE\u53BB\u3002\u53EA\u8BA4\u4F60\u586B\u7684\u8FD9\u4E2A\u53F7\u7801\u3002",
  "settings.imessageUnsupported": "iMessage \u53EA\u80FD\u5728 macOS \u4E0A\u7528\uFF1ADSH \u9700\u8981\u8FD0\u884C\u5728\u767B\u5F55\u4E86\u300C\u4FE1\u606F\u300D\u7684 Mac \u4E0A\u3002",
  "settings.imessageHandle": "\u4F60\u53D1\u6D88\u606F\u7528\u7684\u624B\u673A\u53F7\u6216 Apple ID\uFF1A",
  "settings.imessageHandleInvalid": "\u8BF7\u586B\u624B\u673A\u53F7\u6216\u90AE\u7BB1\u5F62\u5F0F\u7684 Apple ID\u3002",
  "settings.imessageNoAccess": "\u8BFB\u4E0D\u5230\u300C\u4FE1\u606F\u300D\u7684\u6570\u636E\uFF1A\u8BF7\u5728\u300C\u7CFB\u7EDF\u8BBE\u7F6E \u2192 \u9690\u79C1\u4E0E\u5B89\u5168\u6027 \u2192 \u5B8C\u5168\u78C1\u76D8\u8BBF\u95EE\u6743\u9650\u300D\u91CC\u5141\u8BB8\u8FD0\u884C DSH \u7684\u7A0B\u5E8F\uFF0C\u7136\u540E\u91CD\u8BD5\u3002",
  "settings.imessageNote": "\u7B2C\u4E00\u6B21\u56DE\u590D\u65F6 macOS \u4F1A\u8BE2\u95EE\u662F\u5426\u5141\u8BB8\u63A7\u5236\u300C\u4FE1\u606F\u300D\uFF0C\u8BF7\u70B9\u5141\u8BB8\u3002Mac \u7761\u7720\u6216 DSH \u9000\u51FA\u65F6\u6536\u4E0D\u5230\u6D88\u606F\u3002",
  "settings.menu": "\u8BBE\u7F6E",
  "settings.subtitle": "\u67E5\u770B\u5F53\u524D\u751F\u6548\u7684\u914D\u7F6E\u548C\u5404\u9879\u7528\u9014\u3002",
  "settings.readOnly": "\u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\uFF1B\u53EA\u6709\u300C\u81EA\u52A8\u6574\u7406\u5386\u53F2\u300D\u548C\u300C\u5386\u53F2\u8865\u626B\u95F4\u9694\u300D\u9700\u8981\u91CD\u542F DSH\u3002\u6570\u636E\u5E93\u4F4D\u7F6E\u548C\u4E3B\u5165\u53E3\u6807\u8BC6\u53EA\u80FD\u901A\u8FC7\u73AF\u5883\u53D8\u91CF\u4FEE\u6539\uFF0C\u89C1\u5404\u9879\u8BF4\u660E\u3002",
  "settings.save": "\u4FDD\u5B58\u8BBE\u7F6E",
  "settings.saving": "\u6B63\u5728\u4FDD\u5B58\u2026",
  "settings.saved": "\u5DF2\u4FDD\u5B58\u3002",
  "settings.restart": "\u5DF2\u4FDD\u5B58\u3002\u5386\u53F2\u6574\u7406\u7684\u8BBE\u7F6E\u5728\u91CD\u542F DSH \u540E\u751F\u6548\uFF0C\u5176\u4F59\u5DF2\u751F\u6548\u3002",
  "settings.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539",
  "settings.reset": "\u64A4\u9500\u4FEE\u6539",
  "settings.saveError": "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165\u548C DSH \u8FDE\u63A5\u540E\u91CD\u8BD5\u3002",
  "settings.conflict": "\u914D\u7F6E\u5DF2\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u4FDD\u5B58\u3002",
  "settings.contextsUnreadable": "\u65E0\u6CD5\u8BFB\u53D6\u8FD9\u4E2A\u8BDD\u9898\u76EE\u5F55\u6587\u4EF6\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C JSON \u683C\u5F0F\u3002",
  "settings.reload": "\u91CD\u65B0\u8BFB\u53D6\u914D\u7F6E",
  "settings.llm": "LLM \u667A\u80FD\u5224\u65AD",
  "settings.rules": "\u89C4\u5219\u5224\u65AD",
  "settings.loading": "\u6B63\u5728\u8BFB\u53D6\u914D\u7F6E\u2026",
  "settings.error": "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u914D\u7F6E\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u3002",
  "settings.back": "\u56DE\u5230\u4E3B\u804A\u5929",
  "settings.follow": "\u8DDF\u968F DSH",
  "settings.none": "\u672A\u8BBE\u7F6E",
  "settings.on": "\u5F00\u542F",
  "settings.off": "\u5173\u95ED",
  "settings.seconds": "{count} \u79D2",
  "settings.model": "\u5F53\u524D\u4F7F\u7528\u6A21\u578B",
  "settings.capacity": "\u4E0A\u4E0B\u6587\u5BB9\u91CF",
  "settings.output": "\u9ED8\u8BA4\u8F93\u51FA\u989D\u5EA6",
  "settings.modelUnavailable": "\u6A21\u578B\u4FE1\u606F\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5 DSH \u6A21\u578B\u914D\u7F6E\u3002",
  "settings.inherited": "\u8BED\u8A00\u3001\u4E3B\u9898\u3001API \u51ED\u636E\u548C\u538B\u7F29\u89E6\u53D1\u9608\u503C\u7531 DSH \u7BA1\u7406\u3002\u5165\u53E3\u5BB9\u91CF\u8DDF\u968F\u6A21\u578B\uFF1B\u9F20\u6807\u5149\u6655\u767D\u5929\u6A59\u8272\u3001\u591C\u95F4\u6DE1\u84DD\u8272\u3002",
  "settings.compression": "\u538B\u7F29\u4FDD\u7559\u89C4\u5219\uFF1A\u5F53\u524D\u548C\u8FD1\u671F\u9AD8\u9891\u8BDD\u9898\u4FDD\u7559\u66F4\u591A\u7EC6\u8282\uFF1B30 \u5929\u672A\u4F7F\u7528\u7684\u8BDD\u9898\u4FDD\u7559\u77ED\u6458\u8981\u3002\u539F\u59CB\u804A\u5929\u7EE7\u7EED\u4FDD\u5B58\u5728 DSH\u3002\u8FD9\u4E9B\u89C4\u5219\u76EE\u524D\u4E0D\u53EF\u5355\u72EC\u8C03\u6574\u3002",
  "settings.models": "\u6A21\u578B\u4E0E\u8DEF\u7531",
  "settings.history": "\u5386\u53F2\u6574\u7406",
  "settings.limits": "\u5185\u5BB9\u9650\u5236",
  "settings.linkage": "\u8BDD\u9898\u8054\u52A8",
  "settings.linkScope": "\u8054\u52A8\u8303\u56F4",
  "settings.help.linkScope": "\u76F8\u5173\u8BDD\u9898\u4E4B\u95F4\u5171\u4EAB\u8FDB\u5C55\u7684\u8303\u56F4\uFF1A\u5173\u95ED\u3001\u4EC5\u540C\u4E00\u8BDD\u9898\u5DE5\u4F5C\u533A\uFF0C\u6216\u6839\u636E\u4F7F\u7528\u60C5\u51B5\u81EA\u52A8\u5B66\u4E60\u3002\u624B\u52A8\u5173\u8054\u548C\u201C\u4E0D\u5171\u4EAB\u201D\u59CB\u7EC8\u4F18\u5148\u3002",
  "settings.routeNotice": "\u8BDD\u9898\u63D0\u793A",
  "settings.help.routeNotice": "\u4E3B\u804A\u5929\u91CC\u663E\u793A\u8BDD\u9898\u5207\u6362\u7684\u65B9\u5F0F\uFF1A\u9690\u85CF\u3001\u4EC5\u5207\u6362\u8BDD\u9898\u65F6\u663E\u793A\u4E00\u884C\uFF0C\u6216\u6BCF\u6761\u6D88\u606F\u90FD\u663E\u793A\u3002",
  "settings.scope.off": "\u5173\u95ED",
  "settings.scope.workspace": "\u4EC5\u540C\u4E00\u5DE5\u4F5C\u533A",
  "settings.scope.auto": "\u81EA\u52A8\u5B66\u4E60",
  "settings.notice.hidden": "\u9690\u85CF",
  "settings.notice.switch": "\u4EC5\u5207\u6362\u65F6\u663E\u793A",
  "settings.notice.all": "\u5168\u90E8\u663E\u793A",
  "settings.storage": "\u6570\u636E\u4E0E\u5165\u53E3",
  "settings.workerProvider": "\u56FA\u5B9A\u6A21\u578B\u670D\u52A1\u5546",
  "settings.workerModel": "\u56FA\u5B9A\u6A21\u578B\u540D\u79F0",
  "settings.routerMode": "\u8DEF\u7531\u5224\u65AD\u65B9\u5F0F",
  "settings.historyCatalog": "\u81EA\u52A8\u6574\u7406\u5386\u53F2",
  "settings.catalogIntervalMs": "\u5386\u53F2\u8865\u626B\u95F4\u9694",
  "settings.maxDescriptorChars": "\u8BDD\u9898\u6458\u8981\u957F\u5EA6\u4E0A\u9650",
  "settings.maxResponseChars": "\u5355\u6B65\u56DE\u590D\u957F\u5EA6\u4E0A\u9650",
  "settings.databasePath": "\u8BDD\u9898\u76EE\u5F55\u6570\u636E\u5E93\u4F4D\u7F6E",
  "settings.contextsPath": "\u4EBA\u5DE5\u8BDD\u9898\u76EE\u5F55\u6587\u4EF6",
  "settings.gatewayKey": "\u4E3B\u5165\u53E3\u6807\u8BC6",
  "settings.help.workerProvider": "\u9009\u62E9\u670D\u52A1\u5546\u540E\u53EF\u56FA\u5B9A\u540E\u53F0\u6A21\u578B\uFF1B\u7559\u7A7A\u65F6\u8DDF\u968F\u4E3B\u804A\u5929\u548C DSH \u7684\u9009\u62E9\u3002\u5217\u8868\u5305\u542B DSH \u4E2D\u914D\u7F6E\u7684\u5168\u90E8\u6A21\u578B\u3002",
  "settings.help.workerModel": "\u56FA\u5B9A\u8DEF\u7531\u3001\u5DE5\u4F5C\u4F1A\u8BDD\u53CA\u5165\u53E3\u5BB9\u91CF\u6240\u4F7F\u7528\u7684\u6A21\u578B\u3002",
  "settings.help.routerMode": "llm \u4F7F\u7528\u6A21\u578B\u5224\u65AD\u8BDD\u9898\uFF1Brules \u4F7F\u7528\u89C4\u5219\u5224\u65AD\u3002",
  "settings.help.historyCatalog": "\u4ECE\u5DF2\u6709\u4F1A\u8BDD\u63D0\u53D6\u8BDD\u9898\u76EE\u5F55\uFF0C\u5E76\u81EA\u52A8\u5206\u7EC4\u3002\u5173\u95ED\u540E\u5DF2\u6709\u76EE\u5F55\u4ECD\u4FDD\u7559\u3002",
  "settings.help.catalogIntervalMs": "\u5B9A\u671F\u68C0\u67E5\u5386\u53F2\u53D8\u5316\u7684\u95F4\u9694\uFF0C\u6700\u5C11 10 \u79D2\u3002",
  "settings.help.maxDescriptorChars": "\u6302\u8F7D\u5230\u5DE5\u4F5C\u4F1A\u8BDD\u7684\u8BDD\u9898\u8BF4\u660E\u5B57\u7B26\u4E0A\u9650\uFF0C\u6700\u5C11 128\u3002",
  "settings.help.maxResponseChars": "\u540E\u53F0\u6BCF\u4E00\u6B65\u56DE\u590D\uFF08\u542B\u601D\u8003\uFF09\u7684\u5B57\u7B26\u4E0A\u9650\uFF0C\u6700\u5C11 128\uFF1B\u591A\u6B65\u4EFB\u52A1\u4E0D\u6309\u603B\u957F\u5EA6\u8BA1\u7B97\u3002",
  "settings.help.databasePath": "\u4FDD\u5B58\u76EE\u5F55\u3001\u5206\u7EC4\u3001\u5173\u8054\u4E0E\u8DEF\u7531\u8BB0\u5F55\uFF1B\u539F\u59CB\u804A\u5929\u7531 DSH \u4FDD\u5B58\u3002\u6539\u52A8\u4F1A\u8BA9 TheOne \u6362\u7528\u53E6\u4E00\u4EFD\u6570\u636E\uFF0C\u56E0\u6B64\u4E0D\u5728\u8FD9\u91CC\u4FEE\u6539\uFF1A\u5982\u9700\u66F4\u6362\uFF0C\u7528\u73AF\u5883\u53D8\u91CF THEONE_DATABASE_PATH \u6307\u5B9A\u5E76\u91CD\u542F DSH\u3002",
  "settings.help.contextsPath": "\u53EF\u9009 JSON \u6587\u4EF6\uFF0C\u7528\u4E8E\u5BFC\u5165\u4EBA\u5DE5\u51C6\u5907\u7684\u8BDD\u9898\u76EE\u5F55\u3002\u4FDD\u5B58\u65F6\u8BFB\u53D6\u5E76\u5BFC\u5165\uFF1B\u5DF2\u5BFC\u5165\u7684\u8BDD\u9898\u4E0D\u4F1A\u56E0\u6E05\u7A7A\u6B64\u9879\u800C\u5220\u9664\u3002",
  "settings.help.gatewayKey": "\u533A\u5206\u4E0D\u540C\u7684\u4E3B\u804A\u5929\u5165\u53E3\u72B6\u6001\uFF08\u5F53\u524D\u8BDD\u9898\u3001\u8DEF\u7531\u8BB0\u5F55\u3001\u8BBE\u7F6E\uFF09\u3002\u6539\u52A8\u76F8\u5F53\u4E8E\u6362\u4E00\u4E2A\u65B0\u7684\u5165\u53E3\uFF0C\u56E0\u6B64\u53EA\u80FD\u7528\u73AF\u5883\u53D8\u91CF THEONE_GATEWAY_KEY \u4FEE\u6539\uFF0C\u901A\u5E38\u4FDD\u7559 default\u3002",
  "catalog.title": "\u8BDD\u9898\u5DE5\u4F5C\u533A",
  "catalog.subtitle": "\u76F8\u5173\u7684\u4E8B\u60C5\u653E\u5728\u4E00\u8D77\uFF0C\u968F\u65F6\u56DE\u5230\u4E3B\u804A\u5929\u7EE7\u7EED\u3002",
  "catalog.figTopics": "\u8BDD\u9898",
  "catalog.figGroups": "\u5DE5\u4F5C\u533A",
  "catalog.figKept": "\u6CA1\u88AB\u66F4\u6B63",
  "catalog.refresh": "\u6574\u7406\u5386\u53F2",
  "link.label": "\u5173\u8054\uFF1A",
  "link.none": "\u6682\u65E0\u5173\u8054\u8BDD\u9898",
  "link.add": "\uFF0B \u5173\u8054\u8BDD\u9898",
  "link.remove": "\u89E3\u9664\u5173\u8054\uFF08\u4EE5\u540E\u4E0D\u518D\u81EA\u52A8\u5173\u8054\uFF09",
  "link.private": "\u4E0D\u5171\u4EAB",
  "link.privateHint": "\u8FD9\u4E2A\u8BDD\u9898\u7684\u5185\u5BB9\u4E0D\u4F1A\u4F5C\u4E3A\u53C2\u8003\u63D0\u4F9B\u7ED9\u5176\u4ED6\u8BDD\u9898",
  "link.clearLearned": "\u6E05\u7A7A\u5B66\u5230\u7684\u5173\u8054",
  "link.clearLearnedHint": "\u5FD8\u8BB0\u81EA\u52A8\u5B66\u5230\u7684\u5173\u8054\uFF0C\u4FDD\u7559\u4F60\u624B\u52A8\u8BBE\u7F6E\u7684\u5173\u8054\u548C\u89E3\u9664",
  "link.off": "\u8BDD\u9898\u8054\u52A8\u5DF2\u5173\u95ED\uFF0C\u53EF\u5728 TheOne \u8BBE\u7F6E\u4E2D\u5F00\u542F\u3002",
  "link.error": "\u5173\u8054\u8BBE\u7F6E\u672A\u80FD\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "link.reason.manual": "\u624B\u52A8\u5173\u8054",
  "link.reason.workspace": "\u540C\u4E00\u8BDD\u9898\u5DE5\u4F5C\u533A",
  "link.reason.project": "\u540C\u4E00\u9879\u76EE\u76EE\u5F55",
  "link.reason.entities": "\u6D89\u53CA\u76F8\u540C\u7684\u4E8B\u7269",
  "link.reason.learned": "\u7ECF\u5E38\u4E00\u8D77\u4F7F\u7528",
  "link.reason.request": "\u540C\u65F6\u88AB\u63D0\u5230",
  "catalog.reading": "\u6B63\u5728\u8BFB\u53D6\u8BDD\u9898\u2026",
  "catalog.counts": "{topics} \u4E2A\u8BDD\u9898 \xB7 {groups} \u4E2A\u5206\u7EC4",
  "catalog.indexing": "\u6B63\u5728\u6574\u7406\u5386\u53F2\u2026",
  "catalog.pending": "\u8FD8\u6709 {count} \u4E2A\u4F1A\u8BDD\u5F85\u6574\u7406",
  "catalog.updated": "\u5386\u53F2\u76EE\u5F55\u5DF2\u66F4\u65B0",
  "catalog.failed": "{count} \u4E2A\u4F1A\u8BDD\u6682\u65F6\u672A\u80FD\u6574\u7406\uFF0C\u7A0D\u540E\u4F1A\u91CD\u8BD5\u3002\u5DF2\u6709\u8BDD\u9898\u4ECD\u53EF\u67E5\u770B\u3002",
  "catalog.searchUnavailable": "\u90E8\u5206\u5386\u53F2\u6682\u65F6\u65E0\u6CD5\u68C0\u7D22\uFF0C\u4ECD\u53EF\u4ECE\u8BDD\u9898\u76EE\u5F55\u7EE7\u7EED\u804A\u5929\u3002",
  "catalog.loadError": "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u8BDD\u9898\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u3002",
  "catalog.continueError": "\u6682\u65F6\u65E0\u6CD5\u7EE7\u7EED\u8FD9\u4E2A\u8BDD\u9898\uFF0C\u8BF7\u7B49\u5F53\u524D\u804A\u5929\u7ED3\u675F\u540E\u91CD\u8BD5\u3002",
  "catalog.refreshError": "\u6682\u65F6\u65E0\u6CD5\u6574\u7406\u5386\u53F2\uFF0C\u8BF7\u68C0\u67E5 DSH \u6A21\u578B\u914D\u7F6E\u3002",
  "catalog.consentOverline": "\u4EE5\u524D\u7684\u804A\u5929",
  "catalog.consentTitle": "\u8981\u4E0D\u8981\u6574\u7406\u4EE5\u524D\u7684\u804A\u5929\uFF1F",
  "catalog.consentBody": "\u4F60\u5728 DSH \u91CC\u6709 {count} \u4E2A\u4EE5\u524D\u7684\u4F1A\u8BDD\u3002\u6574\u7406\u597D\u4E4B\u540E\uFF0C\u4F60\u5728\u4E3B\u804A\u5929\u91CC\u63D0\u5230\u4EE5\u524D\u7684\u4E8B\uFF0CTheOne \u5C31\u80FD\u627E\u5230\uFF0C\u63A5\u7740\u5F80\u4E0B\u505A\u3002",
  "catalog.consentKeep": "\u539F\u6765\u7684\u4F1A\u8BDD\u4E00\u4E2A\u90FD\u4E0D\u5220\uFF0C\u4E5F\u4E0D\u6539\u3002",
  "catalog.consentQuota": "\u4F1A\u7528\u4F60\u5728 DSH \u91CC\u9009\u7684\u6A21\u578B\u8BFB\u4E00\u904D\uFF0C\u8981\u82B1\u4E00\u70B9\u989D\u5EA6\u3002",
  "catalog.consentChoose": "\u4E0D\u60F3\u8BA9\u5B83\u770B\u7684\uFF0C\u53EF\u4EE5\u5148\u6311\u51FA\u6765\u3002",
  "catalog.startCount": "\u6574\u7406 {count} \u4E2A\u4F1A\u8BDD",
  "catalog.chooseFirst": "\u5148\u6311\u4E00\u6311",
  "catalog.doneChoosing": "\u6311\u597D\u4E86",
  "catalog.notNow": "\u4EE5\u540E\u518D\u8BF4",
  "catalog.declined": "\u4EE5\u524D\u7684\u804A\u5929\u8FD8\u6CA1\u6574\u7406\u3002",
  "catalog.reconsider": "\u73B0\u5728\u6574\u7406",
  "catalog.chooseChats": "\u9009\u62E9\u8981\u6574\u7406\u7684\u4F1A\u8BDD",
  "catalog.chooseHint": "\u52FE\u6389\u7684\u4F1A\u8BDD\u4E0D\u4F1A\u88AB\u8BFB\uFF0C\u4E5F\u4E0D\u4F1A\u8FDB\u76EE\u5F55\uFF0C\u968F\u65F6\u53EF\u4EE5\u6539\u56DE\u6765\u3002",
  "catalog.pickerLoading": "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD\u5217\u8868\u2026",
  "catalog.wholeFolder": "\u6574\u4E2A\u6587\u4EF6\u5939",
  "catalog.otherChats": "\u5176\u4ED6\u4F1A\u8BDD",
  "catalog.untitledChat": "\u672A\u547D\u540D\u4F1A\u8BDD",
  "topic.hiddenExcluded": "\u8FD9\u4E2A\u8BDD\u9898\u6765\u81EA\u4F60\u6392\u9664\u7684\u4F1A\u8BDD\uFF0C\u4E0D\u4F1A\u518D\u88AB\u7528\u5230\u3002",
  "catalog.emptyIndexing": "\u6B63\u5728\u4ECE\u4EE5\u524D\u7684\u804A\u5929\u4E2D\u6574\u7406\u8BDD\u9898\u3002\u4F60\u4E5F\u53EF\u4EE5\u5148\u56DE\u5230\u4E3B\u804A\u5929\u3002",
  "catalog.empty": "\u76EE\u524D\u8FD8\u6CA1\u6709\u6574\u7406\u51FA\u8BDD\u9898\u3002\u5F00\u59CB\u804A\u5929\u540E\uFF0C\u5B83\u4EEC\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  "catalog.unassigned": "\u5F85\u6574\u7406",
  "catalog.unassignedSummary": "\u8FD9\u4E9B\u8BDD\u9898\u8FD8\u5728\u7B49\u5F85\u81EA\u52A8\u5F52\u7C7B\u3002",
  "topic.opening": "\u6B63\u5728\u6253\u5F00\u2026",
  "topic.continue": "\u7EE7\u7EED\u804A\u5929",
  "topic.continueHidden": "\u8FD9\u4E2A\u8BDD\u9898\u7684\u539F\u4F1A\u8BDD\u5DF2\u4ECE\u78C1\u76D8\u4E0A\u6D88\u5931\uFF0C\u6CA1\u6709\u53EF\u4EE5\u63A5\u7740\u804A\u7684\u5185\u5BB9\u3002",
  "topic.source": "\u67E5\u770B\u539F\u4F1A\u8BDD",
  "topic.state": "\u8FDB\u5C55\uFF1A",
  "topic.constraints": "\u7EA6\u675F\uFF1A",
  "topic.project": "\u9879\u76EE\uFF1A",
  "topic.status.waiting": "\u5728\u7B49\u4F60",
  "topic.status.dormant": "\u6401\u7F6E",
  "topic.status.done": "\u5DF2\u5B8C\u6210",
  "topic.markDone": "\u6807\u4E3A\u5B8C\u6210",
  "topic.reopen": "\u91CD\u65B0\u6253\u5F00",
  "topic.hiddenOrphaned": "\u6765\u6E90\u4F1A\u8BDD\u5DF2\u4ECE\u78C1\u76D8\u4E0A\u6D88\u5931\uFF1A\u672C\u8BDD\u9898\u4E0D\u518D\u53C2\u4E0E\u8DEF\u7531\uFF0C\u5220\u9664\u5373\u53EF\u4ECE\u76EE\u5F55\u79FB\u9664\u3002",
  "topic.hiddenArchived": "\u6765\u6E90\u4F1A\u8BDD\u5DF2\u5F52\u6863\uFF1A\u8BDD\u9898\u53EA\u662F\u6536\u8D77\u6765\u4E86\uFF0C\u63D0\u5230\u5B83\u65F6\u4ECD\u4F1A\u7167\u5E38\u63A5\u4E0A\u3002",
  "manage.open": "\u7BA1\u7406",
  "manage.close": "\u6536\u8D77",
  "manage.title": "\u6807\u9898",
  "manage.summary": "\u6458\u8981",
  "manage.constraintsLabel": "\u7EA6\u675F\uFF08\u76F8\u5173\u8BDD\u9898\u4F7F\u7528\u8FD9\u91CC\u7684\u4FE1\u606F\u65F6\u5FC5\u987B\u9075\u5B88\uFF09",
  "manage.constraintsPlaceholder": "\u4F8B\u5982\uFF1A\u9884\u7B97\u6570\u5B57\u53EA\u7528\u4E8E\u91C7\u8D2D\uFF0C\u4E0D\u8981\u5199\u8FDB\u8BBA\u6587",
  "manage.save": "\u4FDD\u5B58\u4FEE\u6539",
  "manage.workspace": "\u6240\u5728\u5DE5\u4F5C\u533A",
  "manage.unassigned": "\u4E0D\u5F52\u5165\u5DE5\u4F5C\u533A",
  "manage.newWorkspace": "\u65B0\u5DE5\u4F5C\u533A\u2026",
  "manage.newWorkspaceName": "\u65B0\u5DE5\u4F5C\u533A\u540D\u79F0",
  "manage.move": "\u79FB\u52A8",
  "manage.attach": "\u5173\u8054\u5DF2\u6709\u4F1A\u8BDD",
  "manage.attachPick": "\u9009\u62E9\u4E00\u4E2A DSH \u4F1A\u8BDD",
  "manage.loadingSessions": "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD\u2026",
  "manage.attachButton": "\u5173\u8054",
  "manage.attachHint": "\u6574\u6BB5\u4F1A\u8BDD\u4F1A\u6210\u4E3A\u8FD9\u4E2A\u8BDD\u9898\u53EF\u4EE5\u68C0\u7D22\u7684\u5386\u53F2\uFF0C\u539F\u4F1A\u8BDD\u4E0D\u53D7\u5F71\u54CD\u3002",
  "manage.merge": "\u5408\u5E76\u5230\u53E6\u4E00\u4E2A\u8BDD\u9898",
  "manage.mergePick": "\u9009\u62E9\u76EE\u6807\u8BDD\u9898",
  "manage.mergeButton": "\u5408\u5E76",
  "manage.confirm": "\u786E\u8BA4\u5408\u5E76",
  "manage.mergeHint": "\u8FD9\u4E2A\u8BDD\u9898\u7684\u5386\u53F2\u3001\u8FDB\u5C55\u3001\u7EA6\u675F\u548C\u5173\u8054\u4F1A\u5E76\u5165\u76EE\u6807\u8BDD\u9898\uFF0C\u8FD9\u4E2A\u8BDD\u9898\u4ECE\u76EE\u5F55\u91CC\u6536\u8D77\u3002\u4E4B\u540E\u53EF\u4EE5\u5728\u76EE\u6807\u8BDD\u9898\u4E0A\u64A4\u9500\u5408\u5E76\uFF1B\u539F\u4F1A\u8BDD\u4ECD\u4FDD\u7559\u5728 DSH\u3002",
  "topic.mergedFrom": "\u5408\u5E76\u81EA\u300C{title}\u300D",
  "topic.unmerge": "\u64A4\u9500\u5408\u5E76",
  "manage.delete": "\u5220\u9664\u8BDD\u9898",
  "manage.deleteConfirm": "\u786E\u8BA4\u5220\u9664",
  "manage.deleteHint": "\u53EA\u5220\u9664 TheOne \u7684\u76EE\u5F55\u8BB0\u5F55\uFF0C\u539F\u59CB\u4F1A\u8BDD\u4ECD\u4FDD\u7559\u5728 DSH\uFF0C\u4E4B\u540E\u4E5F\u4E0D\u4F1A\u88AB\u91CD\u65B0\u6574\u7406\u51FA\u6765\u3002",
  "manage.error": "\u64CD\u4F5C\u672A\u80FD\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165\u540E\u91CD\u8BD5\u3002",
  "manage.busy": "\u6709\u56DE\u590D\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7B49\u5B83\u7ED3\u675F\u540E\u518D\u8BD5\u3002",
  "manage.create": "\uFF0B \u65B0\u8BDD\u9898",
  "manage.createButton": "\u521B\u5EFA",
  "manage.cancel": "\u53D6\u6D88",
  "routes.title": "\u6700\u8FD1\u7684\u8BDD\u9898\u5206\u914D",
  "routes.hint": "\u5206\u9519\u65F6\u53EF\u4EE5\u5728\u8FD9\u91CC\u6539\u5230\u6B63\u786E\u7684\u8BDD\u9898\uFF1ATheOne \u4F1A\u8BB0\u4F4F\uFF0C\u7C7B\u4F3C\u7684\u6D88\u606F\u4EE5\u540E\u5206\u5230\u90A3\u91CC\uFF0C\u4E0B\u4E00\u6761\u6D88\u606F\u4E5F\u63A5\u7740\u90A3\u4E2A\u8BDD\u9898\u3002\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u4E3B\u804A\u5929\u91CC\u8BF4\u300C\u5206\u9519\u4E86\uFF0C\u662F \u67D0\u67D0 \u7684\u300D\uFF0C\u4E0A\u4E00\u6761\u4F1A\u4EA4\u7ED9\u6B63\u786E\u7684\u8BDD\u9898\u91CD\u65B0\u5904\u7406\u3002",
  "routes.stats": "\u6700\u8FD1 {total} \u6761\uFF1A{rate}% \u6CA1\u6709\u88AB\u66F4\u6B63\uFF0C\u8FFD\u95EE {clarified} \u6B21",
  "routes.empty": "\u8FD8\u6CA1\u6709\u5206\u914D\u8BB0\u5F55\u3002",
  "routes.move": "\u6539\u5230\u2026",
  "routes.corrected": "\u5DF2\u6539\u5230 {title}",
  "routes.moveTo": "\u6362\u5230 {title}",
  "routes.undo": "\u64A4\u9500",
  "routes.clarify": "? \u8FFD\u95EE",
  "routes.error": "\u5206\u7C7B\u51FA\u9519\uFF1A{code}",
  "routes.rules": "\u89C4\u5219\u5224\u65AD",
  "routes.removed": "\uFF08\u5DF2\u5220\u9664\u7684\u8BDD\u9898\uFF09",
  "routes.report": "\u62A5\u544A\u95EE\u9898",
  "feedback.open": "\u53CD\u9988\u95EE\u9898",
  "feedback.title": "\u53CD\u9988\u95EE\u9898",
  "feedback.titleMessage": "\u62A5\u544A\u8FD9\u6761\u56DE\u590D\u7684\u95EE\u9898",
  "feedback.intro": "\u8BF4\u8BF4\u53D1\u751F\u4E86\u4EC0\u4E48\u3002\u4E0B\u9762\u80FD\u770B\u5230\u8981\u53D1\u51FA\u7684\u5168\u90E8\u5185\u5BB9\uFF0C\u70B9\u300C\u53D1\u9001\u300D\u4E4B\u524D\u4EC0\u4E48\u90FD\u4E0D\u4F1A\u53D1\u51FA\u3002",
  "feedback.description": "\u53D1\u751F\u4E86\u4EC0\u4E48\uFF1F\u6BD4\u5982\uFF1A\u56DE\u590D\u91CC\u51FA\u73B0\u4E71\u7801\u3001\u5206\u9519\u4E86\u8BDD\u9898\u3001\u67D0\u4E2A\u6309\u94AE\u6CA1\u53CD\u5E94",
  "feedback.contact": "\u8054\u7CFB\u65B9\u5F0F\uFF08\u9009\u586B\uFF09\uFF1A\u90AE\u7BB1\u3001QQ \u6216\u5FAE\u4FE1\uFF0C\u65B9\u4FBF\u4F5C\u8005\u56DE\u590D\u4F60",
  "feedback.includeReply": "\u9644\u4E0A\u8FD9\u6761\u6D88\u606F\u548C\u56DE\u590D\u7684\u539F\u6587\uFF08\u6392\u67E5\u4E71\u7801\u8FD9\u7C7B\u95EE\u9898\u65F6\u9700\u8981\uFF09",
  "feedback.preview": "\u8981\u53D1\u9001\u7684\u5185\u5BB9",
  "feedback.privacy": "\u53D1\u9001\u5230 feedback.yulid.org\uFF0C\u53EA\u7528\u4E8E\u6392\u67E5\u95EE\u9898\uFF0C\u7531 TheOne \u4F5C\u8005\u4FDD\u5B58 90 \u5929\u540E\u81EA\u52A8\u5220\u9664\u3002\u9ED8\u8BA4\u53EA\u542B\u7248\u672C\u3001\u8BBE\u7F6E\u548C\u8DEF\u7531\u7684\u9519\u8BEF\u7801\u4E0E\u8017\u65F6\uFF0C\u4E0D\u542B\u804A\u5929\u5185\u5BB9\u3002",
  "feedback.loading": "\u6B63\u5728\u6574\u7406\u8BCA\u65AD\u4FE1\u606F\u2026",
  "feedback.loadError": "\u8BCA\u65AD\u4FE1\u606F\u6CA1\u6709\u6574\u7406\u51FA\u6765\uFF0C\u4F60\u4ECD\u7136\u53EF\u4EE5\u5199\u4E0B\u95EE\u9898\uFF0C\u590D\u5236\u540E\u53D1\u90AE\u4EF6\u5230 {email}\u3002",
  "feedback.send": "\u53D1\u9001",
  "feedback.sending": "\u6B63\u5728\u53D1\u9001\u2026",
  "feedback.copy": "\u590D\u5236\u5185\u5BB9",
  "feedback.copied": "\u5DF2\u590D\u5236",
  "feedback.email": "\u53D1\u90AE\u4EF6",
  "feedback.cancel": "\u53D6\u6D88",
  "feedback.close": "\u5173\u95ED",
  "feedback.sent": "\u5DF2\u53D1\u9001\uFF0C\u7F16\u53F7 {id}\u3002\u5728\u8BC4\u8BBA\u6216\u90AE\u4EF6\u91CC\u63D0\u5230\u8FD9\u4E2A\u7F16\u53F7\uFF0C\u4F5C\u8005\u5C31\u80FD\u627E\u5230\u5B83\u3002\u8C22\u8C22\uFF01",
  "feedback.fallback": "\u4E5F\u53EF\u4EE5\u70B9\u300C\u590D\u5236\u5185\u5BB9\u300D\uFF0C\u53D1\u90AE\u4EF6\u5230 {email}\u3002",
  "feedback.error.UNREACHABLE": "\u8FDE\u4E0D\u4E0A\u53CD\u9988\u670D\u52A1\u5668\u3002",
  "feedback.error.RATE_LIMITED": "\u53D1\u9001\u5F97\u592A\u9891\u7E41\u4E86\uFF0C\u8BF7\u4E00\u5C0F\u65F6\u540E\u518D\u8BD5\u3002",
  "feedback.error.REJECTED": "\u53CD\u9988\u670D\u52A1\u5668\u6CA1\u6709\u63A5\u6536\u8FD9\u4EFD\u62A5\u544A\u3002",
  "feedback.error.SERVER_ERROR": "\u53CD\u9988\u670D\u52A1\u5668\u6682\u65F6\u51FA\u4E86\u95EE\u9898\u3002",
  "feedback.error.DESCRIPTION_REQUIRED": "\u5148\u5199\u4E00\u53E5\u53D1\u751F\u4E86\u4EC0\u4E48\u3002",
  "feedback.error.TOO_LARGE": "\u5185\u5BB9\u592A\u957F\u4E86\uFF0C\u8BF7\u7F29\u77ED\u63CF\u8FF0\uFF0C\u6216\u53BB\u6389\u56DE\u590D\u539F\u6587\u3002",
  "feedback.error.DIRECT_OFF": "\u8FD9\u4E2A DSH \u5173\u95ED\u4E86\u76F4\u63A5\u53D1\u9001\u3002",
  "feedback.error.other": "\u6CA1\u6709\u53D1\u9001\u6210\u529F\u3002",
  "route.reason.steering": "\u56DE\u590D\u4E2D\u8865\u5145",
  "route.reason.short-continuation": "\u63A5\u7740\u8BF4",
  "route.reason.attachment-only": "\u53EA\u6709\u9644\u4EF6",
  "route.reason.correction": "\u6309\u4F60\u7684\u66F4\u6B63",
  "route.reason.correction-unclear": "\u66F4\u6B63\u65F6\u6CA1\u8BF4\u6E05\u76EE\u6807",
  "route.reason.explicit-new-topic": "\u660E\u786E\u7684\u65B0\u8BDD\u9898",
  "route.reason.no-history-evidence": "\u65B0\u7684\u95EE\u9898",
  "route.reason.unclear-settled": "\u6700\u63A5\u8FD1\u7684\u8BDD\u9898",
  "route.reason.unclear-new": "\u65B0\u7684\u95EE\u9898",
  "route.reason.handback": "\u539F\u8BDD\u9898\u4EA4\u56DE\u540E\u91CD\u65B0\u5206\u914D",
  "route.reason.entity-or-keyword": "\u63D0\u5230\u4E86\u8FD9\u4E2A\u8BDD\u9898",
  "route.reason.keyword-only-switch": "\u63D0\u5230\u4E86\u8FD9\u4E2A\u8BDD\u9898",
  "route.reason.current-reference": "\u63A5\u7740\u5F53\u524D\u8BDD\u9898",
  "route.reason.combined-contexts": "\u7ED3\u5408\u591A\u4E2A\u8BDD\u9898",
  "route.reason.insufficient-evidence": "\u6CA1\u6709\u5339\u914D\u7684\u65E7\u8BDD\u9898",
  "route.reason.multiple-contexts": "\u591A\u4E2A\u8BDD\u9898\u90FD\u53EF\u80FD",
  "route.reason.weak-keyword-match": "\u65B0\u7684\u95EE\u9898",
  "route.reason.no-history-match": "\u65B0\u7684\u95EE\u9898",
  "route.reason.CATALOG_NOT_READY": "\u5386\u53F2\u8FD8\u5728\u6574\u7406",
  "route.reason.CATALOG_REVIEW_LIMIT": "\u6CA1\u6709\u627E\u5230\u660E\u786E\u76F8\u5173\u7684\u65E7\u8BDD\u9898",
  "route.reason.HISTORY_SEARCH_UNAVAILABLE": "\u5386\u53F2\u68C0\u7D22\u6682\u4E0D\u53EF\u7528",
  "route.reason.router-fallback": "\u5206\u7C7B\u6682\u4E0D\u53EF\u7528\uFF0C\u6309\u89C4\u5219\u5224\u65AD"
};
var en = {
  "tasks.title": "Ongoing tasks",
  "tasks.help": "Check public GitHub PRs and CI summaries on this computer. New failures, passes and closure notify main chat. Checks resume when DSH reopens; no code is changed. Failure analysis uses the selected background model.",
  "tasks.objective": "What to follow",
  "tasks.url": "Public PR URL",
  "tasks.interval": "Interval (minutes)",
  "tasks.budget": "Maximum checks (including failed attempts)",
  "tasks.hours": "Maximum hours",
  "tasks.completion": "Completion condition",
  "tasks.closed": "PR merged or closed",
  "tasks.passed": "All retrieved checks pass, or PR closes",
  "tasks.create": "Start following",
  "tasks.empty": "No ongoing tasks yet.",
  "tasks.loadError": "Tasks unavailable. Check your DSH connection.",
  "tasks.actionError": "Could not complete this action. Check the PR URL and limits; the task state may have changed.",
  "tasks.openMain": "Open TheOne main chat first, then retry.",
  "tasks.used": "Checks used",
  "tasks.deadline": "Deadline",
  "tasks.next": "Next check",
  "tasks.checked": "Last checked",
  "tasks.exhausted": "Time or check limit reached. Create a new task to continue.",
  "tasks.failure": "Reading or analysis failed. Up to two retries are automatic; resume manually after that. The public API may be rate limited.",
  "tasks.pause": "Pause",
  "tasks.resume": "Resume",
  "tasks.check": "Check now",
  "tasks.cancel": "Cancel",
  "tasks.review": "Discuss in main chat",
  "tasks.state.queued": "Waiting to check",
  "tasks.state.running": "Checking",
  "tasks.state.paused": "Paused",
  "tasks.state.waiting": "Needs attention",
  "tasks.state.completed": "Completed",
  "tasks.state.failed": "Failed",
  "tasks.state.cancelled": "Cancelled",
  "gateway.title": "TheOne \xB7 Main chat",
  "gateway.label": "Main chat",
  "gateway.subtitle": "Pick up the conversation",
  "gateway.opening": "Opening TheOne main chat\u2026",
  "gateway.error": "Main chat could not open. Check your DSH connection and TheOne plugin status.",
  "retry": "Retry",
  "settings.other": "Other",
  "settings.notices": "Show notices",
  "settings.factLinks": "Share confirmed facts (experimental)",
  "settings.help.factLinks": "Topics share only facts the user confirmed (figures, decisions, file locations), with version and source; when one changes or is withdrawn, topics that used it are told. Off by default; takes effect after DSH restarts.",
  "settings.factExtraction": "Record facts automatically (experimental)",
  "settings.help.factExtraction": "With shared facts on, one small model call after each turn records facts the topic session left out; again only facts the user confirmed are shared. Off by default; takes effect after DSH restarts.",
  "settings.help.notices": "Show notices from TheOne's author (new versions, important reminders). TheOne only reads one notice file from yulid.org and sends none of your data.",
  "notice.label": "Notice",
  "notice.more": "Read more",
  "notice.ok": "Got it",
  "notice.close": "Close this notice",
  "bg.label": "Background",
  "bg.follow": "Default",
  "bg.title": "Background model: routes and does the work",
  "bg.followItem": "Follow DSH's default model",
  "bg.hint": "Background model: {model}. TheOne routes and does the background work with it.",
  "bg.hintFollow": "Background model: {model} (following DSH's default). Click to pin another model.",
  "bg.search": "Search models",
  "bg.none": "No matching models",
  "bg.error": "The background model was not switched. Try again.",
  "update.available": "Update",
  "update.installing": "Updating\u2026",
  "update.restart": "Restart to apply",
  "update.waiting": "New version",
  "update.waitingHint": "{latest} is out but less than 24 hours old. Click to see how to install it now.",
  "age.title": "This version is less than 24 hours old",
  "age.why": "DSH installs plugins with pnpm, which by default only installs versions published at least 24 hours ago, as a guard against tampered packages. TheOne {version} was published recently, so it cannot be installed yet.",
  "age.allowHow": "You can exempt TheOne only: dsh-theone is added to the exceptions in this DSH profile's pnpm settings (pnpm-workspace.yaml) and installed now. Other plugins keep the 24-hour rule.",
  "age.cannot": "This DSH profile's pnpm settings cannot be changed from here. Wait 24 hours, or reinstall from the GitHub address.",
  "age.readyAt": "Without the exemption, you can update after {time}.",
  "age.wait": "Wait 24 hours",
  "age.allow": "Exempt and update",
  "age.ok": "OK",
  "update.reloading": "Reloading\u2026",
  "update.reloadingHint": "TheOne is reloading with the new version; DSH keeps running, and the page refreshes when it is done.",
  "update.busy": "A reply is in progress. Update once it finishes.",
  "update.tooNew": "DSH only installs versions published at least 24 hours ago, as a safety policy, and this one is newer. Try again later.",
  "update.network": "Could not reach the download source. Check the network and click to retry.",
  "update.otherAge": "pnpm refused: {names} is also less than 24 hours old, and only TheOne is exempted. Try again once it is a day old.",
  "update.ageStill": "TheOne is exempted, but pnpm still refused: {detail}. The full log is in .plugin-manager/logs in the DSH profile folder.",
  "update.failed": "Update failed",
  "update.hint": "You have {current}; {latest} is available. Click to update without restarting DSH.",
  "update.manualHint": "You have {current}; {latest} is available. This copy was not installed from GitHub or npm, so reinstall it from the Plugins page.",
  "update.restartHint": "Updated. Restart DSH to apply it.",
  "update.failedHint": "The update did not finish ({error}). Click to retry, or reinstall from the Plugins page.",
  "settings.title": "TheOne settings",
  "settings.update": "Updates",
  "settings.updateCurrent": "Version {current}",
  "settings.updateLatest": "You have the latest version. TheOne also checks when DSH starts and every 6 hours after.",
  "settings.updateUnknown": "Not checked yet.",
  "settings.updateChecking": "Checking\u2026",
  "settings.updateCheckFailed": "Could not check: the update source is unreachable. Check the network and try again.",
  "settings.updateCheck": "Check for updates",
  "settings.updateInstall": "Update",
  "settings.weixin": "WeChat",
  "settings.weixinIntro": "Scan to bind your own WeChat. Messages you send it there work like talking in main chat: they go to their topics and run in the background, and the reply comes back to WeChat. Only the person who scanned is listened to; nobody else reaches main chat.",
  "settings.weixinNote": "Uses Tencent's iLink interface (the same one as the OpenClaw WeChat plugin). Messages arrive only while DSH is running, not while the computer sleeps or DSH is closed.",
  "settings.weixinBind": "Scan to bind",
  "settings.weixinScan": "Scan this code with WeChat on your phone.",
  "settings.weixinScanned": "Scanned. Confirm on your phone.",
  "settings.weixinVerify": "Your phone shows a verification code. Enter it here:",
  "settings.weixinVerifySubmit": "Submit",
  "settings.weixinCancel": "Cancel",
  "settings.weixinFailed": "Binding did not work ({reason}). You can try again.",
  "settings.remoteOnline": "Connected \xB7 account {account}",
  "settings.remoteConnecting": "Connecting \xB7 account {account}",
  "settings.remotePaused": "The server refused the login for now; retrying in {minutes} min \xB7 account {account}",
  "settings.weixinExpired": "The login has expired. Scan again.",
  "settings.remoteOff": "Receiving paused \xB7 account {account}",
  "settings.remotePause": "Pause receiving",
  "settings.remoteResume": "Resume receiving",
  "settings.remoteLogout": "Log out",
  "settings.weixinRescan": "Scan again",
  "settings.remoteError": "Could not read the connection status.",
  "settings.remoteLastError": "Last error: {error}",
  "settings.remoteConnect": "Connect",
  "settings.telegram": "Telegram",
  "settings.telegramIntro": "Bind a Telegram bot of your own. Messages you send it work like talking in main chat, and the replies come back to Telegram. Only the person who completes pairing is listened to.",
  "settings.telegramToken": "In Telegram, message @BotFather, send /newbot to make a bot, and paste the token it gives you here:",
  "settings.telegramTokenInvalid": "That token does not work. Copy it again from @BotFather.",
  "settings.telegramUnreachable": "Could not reach Telegram. Check the network (a proxy may be needed) and try again.",
  "settings.telegramPair": "Scan this code to open {bot} and tap Start, or send {bot} the message /start {code} in Telegram. The first person to send the code becomes its owner.",
  "settings.telegramPairScan": "Scan to open the bot",
  "settings.telegramWaiting": "Waiting for pairing \xB7 bot {account}",
  "settings.telegramExpired": "The bot's token no longer works (it may have been reset in @BotFather). Enter it again.",
  "settings.telegramNote": "The token stays on this computer. Messages arrive only while DSH is running.",
  "settings.imessage": "iMessage",
  "settings.imessageIntro": "On a Mac: iMessage this Mac from your own phone number or Apple ID, and it works like talking in main chat; replies go back through Messages. Only the number you enter is listened to.",
  "settings.imessageUnsupported": "iMessage works only on macOS: DSH has to run on a Mac signed in to Messages.",
  "settings.imessageHandle": "The phone number or Apple ID you text from:",
  "settings.imessageHandleInvalid": "Enter a phone number or an Apple ID email.",
  "settings.imessageNoAccess": "Messages' data cannot be read. Allow the app running DSH under System Settings \u2192 Privacy & Security \u2192 Full Disk Access, then try again.",
  "settings.imessageNote": "The first reply makes macOS ask whether DSH may control Messages; allow it. Nothing arrives while the Mac sleeps or DSH is closed.",
  "settings.menu": "Settings",
  "settings.subtitle": "Review active configuration and what each option does.",
  "settings.readOnly": "Changes apply when saved; only History catalog and Rescan interval need a DSH restart. The database location and entry identifier can only be changed through environment variables; see their descriptions.",
  "settings.save": "Save settings",
  "settings.saving": "Saving\u2026",
  "settings.saved": "Saved.",
  "settings.restart": "Saved. History catalog settings apply after DSH restarts; everything else already applies.",
  "settings.unsaved": "Unsaved changes",
  "settings.reset": "Discard changes",
  "settings.saveError": "Settings could not save. Check the inputs and DSH connection, then retry.",
  "settings.conflict": "Another page changed these settings. Reload before saving.",
  "settings.contextsUnreadable": "Cannot read this topic catalog file. Check the path and JSON format.",
  "settings.reload": "Reload settings",
  "settings.llm": "LLM decision",
  "settings.rules": "Rule-based decision",
  "settings.loading": "Loading configuration\u2026",
  "settings.error": "Configuration could not load. Check your DSH connection.",
  "settings.back": "Back to main chat",
  "settings.follow": "Follow DSH",
  "settings.none": "Not set",
  "settings.on": "On",
  "settings.off": "Off",
  "settings.seconds": "{count} seconds",
  "settings.model": "Current model",
  "settings.capacity": "Context window",
  "settings.output": "Default output allowance",
  "settings.modelUnavailable": "Model information is unavailable. Check your DSH model settings.",
  "settings.inherited": "DSH manages language, theme, API credentials and compaction thresholds. Entry capacity follows the model; the pointer glow is orange in light mode and pale blue in dark mode.",
  "settings.compression": "Retention policy: current and recently frequent topics keep more detail; topics unused for 30 days keep short summaries. Original chats remain in DSH. These rules are not individually configurable yet.",
  "settings.models": "Models and routing",
  "settings.history": "History organization",
  "settings.limits": "Content limits",
  "settings.linkage": "Topic linking",
  "settings.linkScope": "Linking scope",
  "settings.help.linkScope": 'Where related topics share progress: off, within a topic workspace only, or learned from use. Manual links and "Do not share" always take precedence.',
  "settings.routeNotice": "Topic notices",
  "settings.help.routeNotice": "How main chat shows topic changes: hidden, one line when the topic changes, or on every message.",
  "settings.scope.off": "Off",
  "settings.scope.workspace": "Same workspace only",
  "settings.scope.auto": "Learn automatically",
  "settings.notice.hidden": "Hidden",
  "settings.notice.switch": "Only on topic changes",
  "settings.notice.all": "Always",
  "settings.storage": "Data and entry",
  "settings.workerProvider": "Fixed model provider",
  "settings.workerModel": "Fixed model name",
  "settings.routerMode": "Routing decision method",
  "settings.historyCatalog": "Organize history automatically",
  "settings.catalogIntervalMs": "History scan interval",
  "settings.maxDescriptorChars": "Topic descriptor character limit",
  "settings.maxResponseChars": "Per-step reply limit",
  "settings.databasePath": "Topic database location",
  "settings.contextsPath": "Manual topic catalog file",
  "settings.gatewayKey": "Main entry identifier",
  "settings.help.workerProvider": "Pick a provider to pin the background model; leave empty to follow main chat and DSH. Lists every model configured in DSH.",
  "settings.help.workerModel": "Pin the model used for routing, workers and entry capacity.",
  "settings.help.routerMode": "llm uses the model to choose topics; rules uses rule-based decisions.",
  "settings.help.historyCatalog": "Extract and group topics from existing sessions. Turning this off keeps the current catalog.",
  "settings.help.catalogIntervalMs": "Time between checks for history changes; minimum 10 seconds.",
  "settings.help.maxDescriptorChars": "Maximum characters in the topic descriptor mounted in a worker; minimum 128.",
  "settings.help.maxResponseChars": "Maximum characters, thinking included, in one background step; minimum 128. Multi-step tasks are not limited by their total length.",
  "settings.help.databasePath": "Stores the catalog, groups, links and routing records; DSH keeps the original chats. Changing it switches TheOne to a different set of data, so it is not editable here: set THEONE_DATABASE_PATH and restart DSH.",
  "settings.help.contextsPath": "Optional JSON file with a hand-written topic catalog. It is read and imported when saved; clearing it does not remove topics already imported.",
  "settings.help.gatewayKey": "Separates main-chat entry state (current topic, routing records, settings). Changing it amounts to a new entry, so it can only be set through THEONE_GATEWAY_KEY; usually leave it as default.",
  "catalog.title": "Topic workspaces",
  "catalog.subtitle": "Keep related topics together and pick up the conversation in main chat.",
  "catalog.figTopics": "Topics",
  "catalog.figGroups": "Workspaces",
  "catalog.figKept": "Kept as routed",
  "catalog.refresh": "Organize history",
  "link.label": "Related:",
  "link.none": "No related topics",
  "link.add": "+ Link a topic",
  "link.remove": "Unlink (never link automatically again)",
  "link.private": "Do not share",
  "link.privateHint": "This topic is never given to other topics as reference",
  "link.clearLearned": "Clear learned links",
  "link.clearLearnedHint": "Forget automatically learned links; your own links and unlinks stay",
  "link.off": "Topic linking is off. Turn it on in TheOne settings.",
  "link.error": "The link change was not saved. Try again.",
  "link.reason.manual": "Linked by you",
  "link.reason.workspace": "Same topic workspace",
  "link.reason.project": "Same project folder",
  "link.reason.entities": "Mentions the same things",
  "link.reason.learned": "Often used together",
  "link.reason.request": "Mentioned together",
  "catalog.reading": "Loading topics\u2026",
  "catalog.counts": "{topics} topic{topicSuffix} \xB7 {groups} group{groupSuffix}",
  "catalog.indexing": "Organizing history\u2026",
  "catalog.pending": "{count} session{sessionSuffix} left to organize",
  "catalog.updated": "History catalog is up to date",
  "catalog.failed": "{count} session{sessionSuffix} could not be organized yet. We\u2019ll retry later. Existing topics are still available.",
  "catalog.searchUnavailable": "Some history is temporarily unavailable for search. You can still continue from the topic catalog.",
  "catalog.loadError": "Topics could not load. Check your DSH connection.",
  "catalog.continueError": "This topic could not open. Wait for the current conversation to finish, then try again.",
  "catalog.refreshError": "History could not be organized. Check your DSH model settings.",
  "catalog.consentOverline": "Earlier chats",
  "catalog.consentTitle": "Sort out your earlier chats?",
  "catalog.consentBody": "You have {count} earlier chat{sessionSuffix} in DSH. Once they're sorted, TheOne can find them when you bring something up in main chat, and carry on from there.",
  "catalog.consentKeep": "Nothing is deleted or changed.",
  "catalog.consentQuota": "It reads them once with the model you picked in DSH, which uses a little of your quota.",
  "catalog.consentChoose": "Anything you'd rather keep to yourself, you can leave out first.",
  "catalog.startCount": "Sort {count} chat{sessionSuffix}",
  "catalog.chooseFirst": "Choose chats first",
  "catalog.doneChoosing": "Done",
  "catalog.notNow": "Not now",
  "catalog.declined": "Your earlier chats aren't sorted yet.",
  "catalog.reconsider": "Sort them now",
  "catalog.chooseChats": "Choose chats to sort",
  "catalog.chooseHint": "Unticked chats won't be read or added to the directory. You can change this any time.",
  "catalog.pickerLoading": "Loading chats\u2026",
  "catalog.wholeFolder": "Whole folder",
  "catalog.otherChats": "Other chats",
  "catalog.untitledChat": "Untitled chat",
  "topic.hiddenExcluded": "This topic comes from chats you left out, so it won't be used.",
  "catalog.emptyIndexing": "Organizing topics from your earlier chats. You can return to main chat while this runs.",
  "catalog.empty": "No topics yet. They\u2019ll appear here as you chat.",
  "catalog.unassigned": "To organize",
  "catalog.unassignedSummary": "These topics are waiting to be grouped.",
  "topic.opening": "Opening\u2026",
  "topic.continue": "Continue chatting",
  "topic.continueHidden": "This topic\u2019s conversations are gone from disk, so there is nothing to continue.",
  "topic.source": "View original chat",
  "topic.state": "Progress:",
  "topic.constraints": "Constraints:",
  "topic.project": "Project:",
  "topic.status.waiting": "Waiting on you",
  "topic.status.dormant": "Set aside",
  "topic.status.done": "Done",
  "topic.markDone": "Mark done",
  "topic.reopen": "Reopen",
  "topic.hiddenOrphaned": "Its conversations are gone from disk: this topic no longer takes part in routing. Delete it to remove it from the directory.",
  "topic.hiddenArchived": "Its conversations are archived: the topic is only put away, and picks up again when you mention it.",
  "manage.open": "Manage",
  "manage.close": "Close",
  "manage.title": "Title",
  "manage.summary": "Summary",
  "manage.constraintsLabel": "Constraints (related topics must follow them when using this information)",
  "manage.constraintsPlaceholder": "For example: budget figures are for purchasing only, keep them out of the paper",
  "manage.save": "Save changes",
  "manage.workspace": "Topic workspace",
  "manage.unassigned": "No workspace",
  "manage.newWorkspace": "New workspace\u2026",
  "manage.newWorkspaceName": "New workspace name",
  "manage.move": "Move",
  "manage.attach": "Attach an existing session",
  "manage.attachPick": "Choose a DSH session",
  "manage.loadingSessions": "Reading sessions\u2026",
  "manage.attachButton": "Attach",
  "manage.attachHint": "The whole session becomes history this topic can search; the session itself is unchanged.",
  "manage.merge": "Merge into another topic",
  "manage.mergePick": "Choose the target topic",
  "manage.mergeButton": "Merge",
  "manage.confirm": "Confirm merge",
  "manage.mergeHint": "This topic's history, progress, constraints and links move into the target topic, and this topic leaves the directory. You can undo the merge from the target topic; DSH keeps the original sessions.",
  "topic.mergedFrom": "Merged from \u201C{title}\u201D",
  "topic.unmerge": "Undo merge",
  "manage.delete": "Delete topic",
  "manage.deleteConfirm": "Confirm delete",
  "manage.deleteHint": "Removes only TheOne's catalog entry. DSH keeps the original sessions, and the catalog will not extract this topic again.",
  "manage.error": "The change could not be made. Check the input and try again.",
  "manage.busy": "A reply is in progress. Try again when it finishes.",
  "manage.create": "+ New topic",
  "manage.createButton": "Create",
  "manage.cancel": "Cancel",
  "routes.title": "Recent topic routing",
  "routes.hint": 'Move a misrouted message to the right topic here: TheOne remembers, routes similar messages there from now on, and continues the next message in that topic. You can also say "wrong topic, it is the X one" in main chat, and the previous message is redone in the right topic.',
  "routes.stats": "Last {total}: {rate}% kept as routed, {clarified} asked back",
  "routes.empty": "No routing records yet.",
  "routes.move": "Move to\u2026",
  "routes.corrected": "Moved to {title}",
  "routes.moveTo": "Move to {title}",
  "routes.undo": "Undo",
  "routes.clarify": "? Asked",
  "routes.error": "Classifier error: {code}",
  "routes.rules": "rules",
  "routes.removed": "(deleted topic)",
  "routes.report": "Report a problem",
  "feedback.open": "Report a problem",
  "feedback.title": "Report a problem",
  "feedback.titleMessage": "Report a problem with this reply",
  "feedback.intro": "Tell us what happened. Everything that would be sent is shown below; nothing leaves this computer until you press Send.",
  "feedback.description": "What happened? For example: garbled text in a reply, the wrong topic, a button that does nothing",
  "feedback.contact": "Contact (optional): email or any handle, so the author can reply",
  "feedback.includeReply": "Include this message and its reply as text (needed for problems like garbled replies)",
  "feedback.preview": "What will be sent",
  "feedback.privacy": "Sent to feedback.yulid.org, used only to look into the problem, and deleted by TheOne's author after 90 days. By default it holds versions, settings and routing error codes and timings, no chat content.",
  "feedback.loading": "Gathering diagnostics\u2026",
  "feedback.loadError": "Diagnostics could not be gathered. You can still describe the problem, copy it and email {email}.",
  "feedback.send": "Send",
  "feedback.sending": "Sending\u2026",
  "feedback.copy": "Copy",
  "feedback.copied": "Copied",
  "feedback.email": "Email",
  "feedback.cancel": "Cancel",
  "feedback.close": "Close",
  "feedback.sent": "Sent as {id}. Mention this id in a comment or email and the author can find it. Thank you!",
  "feedback.fallback": "You can also press Copy and email {email}.",
  "feedback.error.UNREACHABLE": "The feedback server cannot be reached.",
  "feedback.error.RATE_LIMITED": "Too many reports in a short time; try again in an hour.",
  "feedback.error.REJECTED": "The feedback server did not accept this report.",
  "feedback.error.SERVER_ERROR": "The feedback server has a problem right now.",
  "feedback.error.DESCRIPTION_REQUIRED": "Say in a sentence what happened first.",
  "feedback.error.TOO_LARGE": "Too long; shorten the description or leave out the reply text.",
  "feedback.error.DIRECT_OFF": "Sending directly is turned off in this DSH.",
  "feedback.error.other": "The report was not sent.",
  "route.reason.steering": "Added during a reply",
  "route.reason.short-continuation": "Continuation",
  "route.reason.attachment-only": "Attachment only",
  "route.reason.correction": "Your correction",
  "route.reason.correction-unclear": "Correction without a target",
  "route.reason.explicit-new-topic": "Explicit new topic",
  "route.reason.no-history-evidence": "New question",
  "route.reason.unclear-settled": "Closest topic",
  "route.reason.unclear-new": "New question",
  "route.reason.handback": "Handed back by the first topic",
  "route.reason.entity-or-keyword": "Mentions this topic",
  "route.reason.keyword-only-switch": "Mentions this topic",
  "route.reason.current-reference": "Continues the current topic",
  "route.reason.combined-contexts": "Combines topics",
  "route.reason.insufficient-evidence": "No matching topic",
  "route.reason.multiple-contexts": "Several topics possible",
  "route.reason.weak-keyword-match": "New question",
  "route.reason.no-history-match": "New question",
  "route.reason.CATALOG_NOT_READY": "History still being catalogued",
  "route.reason.CATALOG_REVIEW_LIMIT": "No clearly related topic found",
  "route.reason.HISTORY_SEARCH_UNAVAILABLE": "History search unavailable",
  "route.reason.router-fallback": "Classifier unavailable; routed by rules"
};

// node_modules/qrcode-generator/dist/qrcode.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = (function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row = 0; row < moduleCount; row += 1) {
        modules[row] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row][col] = null;
        }
      }
      return modules;
    })(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
        if (_modules[row][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark = !dark;
            }
            _modules[row][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
      throw row + "," + col;
    }
    return _modules[row][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc, r, mr, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg += ">";
    qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg += "M" + mc + "," + mr + rect;
        }
      }
    }
    qrSvg += '" stroke="transparent" fill="black"/>';
    qrSvg += "</svg>";
    return qrSvg;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "\u2588\u2588": "\u2588",
      "\u2588 ": "\u2580",
      " \u2588": "\u2584",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "\u2588\u2588": "\u2580",
      "\u2588 ": "\u2580",
      " \u2588": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "\u2588";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "\u2588";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("\u2588\u2588");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row, col) ? "black" : "white";
        context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = (function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read();
      const b2 = read();
      const b3 = read();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  })();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = (function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark = qrcode2.isDark(row, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrcode2.isDark(row + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row = 0; row < moduleCount - 1; row += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row, col)) count += 1;
        if (qrcode2.isDark(row + 1, col)) count += 1;
        if (qrcode2.isDark(row, col + 1)) count += 1;
        if (qrcode2.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount - 6; row += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount; row += 1) {
        if (qrcode2.isDark(row, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
})();
var QRMath = (function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n) {
    if (n < 1) {
      throw "glog(" + n + ")";
    }
    return LOG_TABLE[n];
  };
  _this.gexp = function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  };
  return _this;
})();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = (function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  })();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = (function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
})();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes2 = qrcode.stringToBytes;
  !(function(c, code) {
    const test = stringToBytes2(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  })("\u53CB", 38726);
  const _bytes = stringToBytes2(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
  };
  const encode = function(n) {
    if (n < 0) {
      throw "n:" + n;
    } else if (n < 26) {
      return 65 + n;
    } else if (n < 52) {
      return 97 + (n - 26);
    } else if (n < 62) {
      return 48 + (n - 52);
    } else if (n == 62) {
      return 43;
    } else if (n == 63) {
      return 47;
    } else {
      throw "n:" + n;
    }
  };
  _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// src/client-work.ts
var import_react = require("react");
function createWorkPanel(useText, lifetime, openMain) {
  return function WorkPanel() {
    const t = useText();
    const [tasks, setTasks] = (0, import_react.useState)([]);
    const [error, setError] = (0, import_react.useState)("");
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [objective, setObjective] = (0, import_react.useState)("");
    const [url, setUrl] = (0, import_react.useState)("");
    const [interval, setIntervalValue] = (0, import_react.useState)(15);
    const [maxChecks, setMaxChecks] = (0, import_react.useState)(96);
    const [completion, setCompletion] = (0, import_react.useState)("closed");
    const [hours, setHours] = (0, import_react.useState)(24);
    const mounted = (0, import_react.useRef)(lifetime);
    const reload = (0, import_react.useRef)(async () => {
    });
    const requestId = (0, import_react.useRef)();
    const submitting = (0, import_react.useRef)(false);
    (0, import_react.useEffect)(() => {
      const local = new AbortController();
      const signal = AbortSignal.any([local.signal, lifetime]);
      mounted.current = signal;
      let loading;
      reload.current = () => loading ??= (async () => {
        try {
          const response = await fetch("/api/theone/tasks", { signal: AbortSignal.any([signal, AbortSignal.timeout(15e3)]), cache: "no-store" });
          if (!response.ok) throw new Error("unavailable");
          const value = await response.json();
          if (!signal.aborted) {
            setTasks(value);
            setError((current) => current === t("tasks.loadError") ? "" : current);
          }
        } catch {
          if (!signal.aborted) setError(t("tasks.loadError"));
        }
      })().finally(() => {
        loading = void 0;
      });
      void reload.current();
      const timer = setInterval(() => {
        void reload.current();
      }, 5e3);
      return () => {
        local.abort();
        clearInterval(timer);
      };
    }, [t]);
    async function act(body) {
      if (submitting.current || mounted.current.aborted) return;
      submitting.current = true;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/theone/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any([mounted.current, AbortSignal.timeout(15e3)])
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error === "OPEN_MAIN_CHAT_FIRST" ? t("tasks.openMain") : t("tasks.actionError"));
        if (mounted.current.aborted) return;
        if (body.action === "create") {
          requestId.current = void 0;
          setObjective("");
          setUrl("");
        }
        if (body.action === "review") openMain();
        await reload.current();
        await reload.current();
      } catch (cause) {
        if (!mounted.current.aborted) setError(cause instanceof Error ? cause.message : t("tasks.actionError"));
      } finally {
        submitting.current = false;
        if (!mounted.current.aborted) setBusy(false);
      }
    }
    const label = (key, control) => (0, import_react.createElement)("label", { className: "theone-task-field" }, t(key), control);
    const button = (title, action, id) => (0, import_react.createElement)("button", { type: "button", disabled: busy, onClick: () => void act({ action, id }) }, title);
    return (0, import_react.createElement)(
      "section",
      { className: "theone-tasks" },
      (0, import_react.createElement)("h2", null, t("tasks.title")),
      (0, import_react.createElement)("p", null, t("tasks.help")),
      error ? (0, import_react.createElement)("p", { role: "alert" }, error) : null,
      (0, import_react.createElement)(
        "form",
        { onSubmit: (event) => {
          event.preventDefault();
          requestId.current ??= crypto.randomUUID();
          void act({ action: "create", requestId: requestId.current, objective, url, intervalMinutes: interval, maxChecks, completion, deadline: Date.now() + hours * 36e5 });
        } },
        label("tasks.objective", (0, import_react.createElement)("input", { required: true, maxLength: 1e3, value: objective, disabled: busy, onChange: (e) => {
          setObjective(e.target.value);
          requestId.current = void 0;
        } })),
        label("tasks.url", (0, import_react.createElement)("input", {
          type: "url",
          required: true,
          maxLength: 1e3,
          placeholder: "https://github.com/owner/repo/pull/123",
          value: url,
          disabled: busy,
          onChange: (e) => {
            setUrl(e.target.value);
            requestId.current = void 0;
          }
        })),
        label("tasks.interval", (0, import_react.createElement)("input", { type: "number", required: true, min: 5, max: 1440, value: interval, disabled: busy, onChange: (e) => {
          setIntervalValue(Number(e.target.value));
          requestId.current = void 0;
        } })),
        label("tasks.budget", (0, import_react.createElement)("input", { type: "number", required: true, min: 1, max: 1e3, value: maxChecks, disabled: busy, onChange: (e) => {
          setMaxChecks(Number(e.target.value));
          requestId.current = void 0;
        } })),
        label("tasks.hours", (0, import_react.createElement)("input", { type: "number", required: true, min: 1, max: 720, value: hours, disabled: busy, onChange: (e) => {
          setHours(Number(e.target.value));
          requestId.current = void 0;
        } })),
        label("tasks.completion", (0, import_react.createElement)(
          "select",
          { value: completion, disabled: busy, onChange: (e) => {
            setCompletion(e.target.value);
            requestId.current = void 0;
          } },
          (0, import_react.createElement)("option", { value: "closed" }, t("tasks.closed")),
          (0, import_react.createElement)("option", { value: "checks-passed" }, t("tasks.passed"))
        )),
        (0, import_react.createElement)("button", { type: "submit", disabled: busy }, t("tasks.create"))
      ),
      !tasks.length ? (0, import_react.createElement)("p", null, t("tasks.empty")) : null,
      ...tasks.slice().reverse().map((job) => (0, import_react.createElement)(
        "article",
        { key: job.id, className: "theone-task" },
        (0, import_react.createElement)("h3", null, job.task.objective),
        (0, import_react.createElement)("p", null, t(`tasks.state.${job.state}`)),
        (0, import_react.createElement)("a", { href: job.task.url, target: "_blank", rel: "noopener noreferrer" }, job.task.url),
        (0, import_react.createElement)("p", null, `${t("tasks.used")}: ${Math.min(job.runs, job.task.maxChecks)} / ${job.task.maxChecks} \xB7 ${t("tasks.deadline")}: ${new Date(job.task.deadline).toLocaleString()}`),
        job.state === "queued" ? (0, import_react.createElement)("p", null, `${t("tasks.next")}: ${new Date(job.due).toLocaleString()}`) : null,
        job.result?.summary ? (0, import_react.createElement)("p", null, job.result.summary) : null,
        job.result?.nextStep ? (0, import_react.createElement)("p", null, job.result.nextStep) : null,
        job.result?.checkedAt ? (0, import_react.createElement)("small", null, `${t("tasks.checked")}: ${new Date(job.result.checkedAt).toLocaleString()} \xB7 ${job.result.snapshot?.sha?.slice(0, 8) ?? ""}`) : null,
        job.error ? (0, import_react.createElement)("p", { role: "status" }, job.error === "WORK_BUDGET_REACHED" ? t("tasks.exhausted") : t("tasks.failure")) : null,
        (0, import_react.createElement)(
          "div",
          { className: "theone-task-actions" },
          ["queued", "running"].includes(job.state) ? button(t("tasks.pause"), "pause", job.id) : null,
          ["paused", "failed"].includes(job.state) ? button(t("tasks.resume"), "resume", job.id) : null,
          job.state === "queued" ? button(t("tasks.check"), "wake", job.id) : null,
          !["completed", "cancelled"].includes(job.state) ? button(t("tasks.cancel"), "cancel", job.id) : null,
          job.result ? button(t("tasks.review"), "review", job.id) : null
        )
      ))
    );
  };
}
var workCss = `.theone-tasks{padding:24px;max-width:900px;margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}.theone-tasks form{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px}.theone-task-field{display:flex;flex-direction:column;gap:4px}.theone-tasks input,.theone-tasks select{color:inherit;background:transparent;padding:8px;border:1px solid #8887;border-radius:6px;min-width:0}.theone-tasks button{font:inherit;color:inherit;background:var(--dsw-specific-sidebar-fill,#8882);padding:6px 12px;border:1px solid #8886;border-radius:6px;cursor:pointer}.theone-tasks button:disabled{opacity:.5;cursor:default}.theone-task{padding:16px;margin-top:16px;border:1px solid #8885;border-radius:12px;overflow-wrap:anywhere}.theone-task h3{margin-top:0}.theone-task-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.theone-task p{white-space:pre-wrap}.theone-tasks a{color:var(--dsw-alias-label-link,#529bdb)}`;

// src/client.ts
var inject = ["slots", "locale", "sessions", "workspaces", "layout", "uiWorkspace", "modelDirectories", "remote.session"];
var panelId = "theone-gateway";
var catalogPanelId = "theone-catalog";
var settingsPanelId = "theone-settings";
var tasksPanelId = "theone-tasks";
function apply(ctx) {
  const lifetime = new AbortController();
  ctx.effect(() => ctx.locale.register("theone", { zh, en }));
  const t = ctx.locale.bind("theone");
  const subscribeLocale = ctx.locale.subscribe.bind(ctx.locale);
  const localeSnapshot = ctx.locale.getSnapshot.bind(ctx.locale);
  function useText() {
    (0, import_react2.useSyncExternalStore)(subscribeLocale, localeSnapshot);
    return t;
  }
  async function createGateway(id) {
    const response = await fetch("/api/theone/gateway", { signal: lifetime.signal, cache: "no-store" });
    if (!response.ok) throw new Error("Global gateway directory unavailable");
    const { cwd } = await response.json();
    await ctx.sessions.create({ sessionId: id, cwd });
  }
  const navigation = new GatewayNavigation({
    async current() {
      const response = await fetch("/api/theone/gateway", { signal: lifetime.signal, cache: "no-store" });
      return response.ok ? (await response.json()).current ?? void 0 : void 0;
    },
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
        await fetch("/api/theone/gateway/hold", { method: "POST", signal: lifetime.signal }).catch(() => void 0);
        const selected = await ctx.modelDirectories.directoryFor(target).select({ provider: "theone", model: "gateway" });
        if (!selected.ok) throw selected.error;
        const renamed = await reference.binding.session.rename(t("gateway.title"));
        if (!renamed.ok) throw renamed.error;
      });
      const prepared = await fetch("/api/theone/gateway/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id, locale: localeSnapshot().active }),
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
  ctx.effect(() => {
    let active = localeSnapshot().active;
    let pending = Promise.resolve();
    return subscribeLocale(() => {
      if (active === localeSnapshot().active) return;
      active = localeSnapshot().active;
      pending = pending.catch(() => {
      }).then(async () => {
        const id = navigation.getSnapshot();
        if (!id || lifetime.signal.aborted || !ctx.sessions.list.getSnapshot().byId[id]) return;
        await ctx.sessions.using(id, { source: "controllerOperation", signal: lifetime.signal }, async (reference) => {
          await reference.ready;
          lifetime.signal.throwIfAborted();
          const result = await reference.binding.session.rename(t("gateway.title"));
          if (!result.ok) throw result.error;
        });
      });
      void pending.catch(() => {
      });
    });
  });
  let update;
  const updateListeners = /* @__PURE__ */ new Set();
  const setUpdate = (value) => {
    if (lifetime.signal.aborted) return;
    update = value;
    for (const listener of updateListeners) listener();
  };
  const subscribeUpdate = (listener) => {
    updateListeners.add(listener);
    return () => {
      updateListeners.delete(listener);
    };
  };
  const readUpdate = async (method = "GET", body, force = false) => {
    try {
      const response = await fetch(force ? "/api/theone/update?force" : "/api/theone/update", {
        method,
        signal: lifetime.signal,
        cache: "no-store",
        ...body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}
      });
      if (response.ok || response.status === 409 || response.status === 400) setUpdate(await response.json());
      if (update?.state === "reloading") void awaitReload(update.current);
      return response.ok;
    } catch {
      return false;
    }
  };
  function startUpdate(status) {
    if (status.state === "installing" || status.state === "reloading" || status.state === "restart") return;
    const waiting = !!status.waiting && !status.available && !status.state;
    if (!status.exempt && (waiting || status.state === "failed" && status.error === "MINIMUM_RELEASE_AGE")) {
      openReleaseAgeDialog(status);
      return;
    }
    if (!status.installable) {
      window.open("https://github.com/YunongDai2005/dsh-theone#readme", "_blank", "noopener");
      return;
    }
    setUpdate({ ...status, state: "installing" });
    void readUpdate("POST");
  }
  function updateHint(status) {
    const waiting = !!status.waiting && !status.available && !status.state;
    return waiting ? t("update.waitingHint", { latest: status.waiting.version }) : status.error === "GATEWAY_BUSY" ? t("update.busy") : status.state === "reloading" ? t("update.reloadingHint") : status.state === "restart" ? t("update.restartHint") : status.state === "failed" ? status.error === "OTHER_RELEASE_AGE" ? t("update.otherAge", { names: status.detail ?? "" }) : status.error === "MINIMUM_RELEASE_AGE" ? status.exempt ? t("update.ageStill", { detail: status.detail ?? "" }) : t("update.tooNew") : status.error === "NETWORK" ? t("update.network") : t("update.failedHint", { error: status.detail ?? status.error ?? "" }) : status.installable ? t("update.hint", { current: status.current, latest: status.latest ?? "" }) : t("update.manualHint", { current: status.current, latest: status.latest ?? "" });
  }
  let reloadPending = false;
  async function awaitReload(previous) {
    if (reloadPending || lifetime.signal.aborted) return;
    reloadPending = true;
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(12e4)]);
    try {
      while (!signal.aborted) {
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 1500);
          signal.addEventListener("abort", finish, { once: true });
        });
        if (signal.aborted) break;
        try {
          const response = await fetch("/api/theone/update", { cache: "no-store", signal });
          if (response.ok) {
            const status = await response.json();
            if (signal.aborted) break;
            if (status.current !== previous) {
              setUpdate(status);
              return;
            }
          }
        } catch {
        }
      }
      if (update) setUpdate({ ...update, state: "restart" });
    } finally {
      reloadPending = false;
    }
  }
  ctx.effect(() => {
    void readUpdate();
    const timer = setInterval(() => {
      void readUpdate();
    }, 6 * 36e5);
    return () => clearInterval(timer);
  });
  function openReleaseAgeDialog(status) {
    const backdrop = document.createElement("div");
    backdrop.className = "theone-dialog-backdrop";
    backdrop.setAttribute("translate", "no");
    const card = document.createElement("div");
    card.className = "theone-dialog";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.id = "theone-dialog-title";
    title.textContent = t("age.title");
    card.setAttribute("aria-labelledby", title.id);
    const paragraph = (text, className) => {
      const p = document.createElement("p");
      p.textContent = text;
      if (className) p.className = className;
      return p;
    };
    const version = status.waiting?.version ?? status.latest ?? "";
    card.append(title, paragraph(t("age.why", { version })), paragraph(t(status.canExempt ? "age.allowHow" : "age.cannot")));
    if (status.waiting) card.append(paragraph(t("age.readyAt", { time: new Date(status.waiting.readyAt).toLocaleString(localeSnapshot().active, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) }), "theone-dialog-note"));
    const footer = document.createElement("div");
    footer.className = "theone-dialog-actions";
    const button = (text, primary, act) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      if (primary) element.className = "theone-dialog-primary";
      element.addEventListener("click", act);
      footer.append(element);
      return element;
    };
    const close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", keydown, true);
    };
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    button(t(status.canExempt ? "age.wait" : "age.ok"), !status.canExempt, close);
    const allow = status.canExempt ? button(t("age.allow"), true, () => {
      close();
      setUpdate({ ...status, state: "installing", error: void 0 });
      void readUpdate("POST", { allowFresh: true });
    }) : void 0;
    card.append(footer);
    backdrop.append(card);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", keydown, true);
    document.body.append(backdrop);
    (allow ?? footer.querySelector("button"))?.focus();
  }
  function openFeedbackDialog(messageId) {
    if (document.querySelector(".theone-dialog-backdrop")) return;
    const backdrop = document.createElement("div");
    backdrop.className = "theone-dialog-backdrop";
    backdrop.setAttribute("translate", "no");
    const card = document.createElement("div");
    card.className = "theone-dialog theone-feedback";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.id = "theone-feedback-title";
    title.textContent = t(messageId ? "feedback.titleMessage" : "feedback.title");
    card.setAttribute("aria-labelledby", title.id);
    const intro = document.createElement("p");
    intro.textContent = t("feedback.intro");
    const description = document.createElement("textarea");
    description.maxLength = 4e3;
    description.rows = 4;
    description.placeholder = t("feedback.description");
    description.setAttribute("aria-label", t("feedback.description"));
    const contact = document.createElement("input");
    contact.maxLength = 200;
    contact.placeholder = t("feedback.contact");
    contact.setAttribute("aria-label", t("feedback.contact"));
    const include = document.createElement("input");
    include.type = "checkbox";
    const includeLabel = document.createElement("label");
    includeLabel.className = "theone-feedback-check";
    includeLabel.append(include, " ", t("feedback.includeReply"));
    const preview = document.createElement("details");
    preview.className = "theone-feedback-preview";
    const summary = document.createElement("summary");
    summary.textContent = t("feedback.preview");
    const pre = document.createElement("pre");
    preview.append(summary, pre);
    const privacy = document.createElement("p");
    privacy.className = "theone-dialog-note";
    privacy.textContent = t("feedback.privacy");
    const status = document.createElement("p");
    status.className = "theone-dialog-note";
    status.setAttribute("role", "status");
    status.textContent = t("feedback.loading");
    const footer = document.createElement("div");
    footer.className = "theone-dialog-actions";
    const button = (text2, primary, act) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text2;
      if (primary) element.className = "theone-dialog-primary";
      element.addEventListener("click", act);
      footer.append(element);
      return element;
    };
    let draft;
    let email = "theone@yulid.org";
    let direct = false;
    let sentId;
    let sending = false;
    const language = () => localeSnapshot().active.startsWith("zh") ? "zh" : "en";
    const report = () => ({ description: description.value.trim(), ...contact.value.trim() ? { contact: contact.value.trim() } : {}, lang: language(), ...draft ?? {} });
    const render = () => {
      pre.textContent = JSON.stringify(report(), null, 2);
      send.disabled = sending || !!sentId || !direct || !draft || !description.value.trim();
      send.textContent = t(sending ? "feedback.sending" : "feedback.send");
    };
    const load = async () => {
      status.textContent = t("feedback.loading");
      draft = void 0;
      render();
      try {
        const response = await fetch("/api/theone/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: lifetime.signal,
          body: JSON.stringify({ action: "draft", ...messageId ? { messageId, includeReply: include.checked } : {} })
        });
        const body = await response.json();
        if (!response.ok || !body.draft) throw new Error("draft");
        draft = body.draft;
        email = body.email ?? email;
        direct = body.direct === true;
        status.textContent = direct ? "" : t("feedback.fallback", { email });
      } catch {
        status.textContent = t("feedback.loadError", { email });
      }
      render();
    };
    const close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", keydown, true);
    };
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const text = () => sentId ? sentId : JSON.stringify(report(), null, 2);
    button(t("feedback.cancel"), false, close);
    const copy = button(t("feedback.copy"), false, () => {
      void navigator.clipboard?.writeText(text()).then(() => {
        copy.textContent = t("feedback.copied");
        setTimeout(() => {
          copy.textContent = t("feedback.copy");
        }, 2e3);
      }, () => {
      });
    });
    button(t("feedback.email"), false, () => {
      const subject = `TheOne ${String(draft?.version ?? "")} ${description.value.trim().split("\n")[0].slice(0, 40)}`.trim();
      window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text().slice(0, 1800))}`, "_self");
    });
    const send = button(t("feedback.send"), true, () => {
      if (send.disabled) return;
      sending = true;
      render();
      void (async () => {
        try {
          const response = await fetch("/api/theone/feedback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: lifetime.signal,
            body: JSON.stringify({ action: "send", draft, description: description.value, contact: contact.value, lang: language() })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || !body.id) throw new Error(body.error ?? "other");
          sentId = body.id;
          status.textContent = t("feedback.sent", { id: body.id });
          description.disabled = contact.disabled = include.disabled = true;
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const known = ["UNREACHABLE", "RATE_LIMITED", "REJECTED", "SERVER_ERROR", "DESCRIPTION_REQUIRED", "TOO_LARGE", "DIRECT_OFF"].includes(code);
          status.textContent = `${t(known ? `feedback.error.${code}` : "feedback.error.other")} ${t("feedback.fallback", { email })}`;
        } finally {
          sending = false;
          render();
        }
      })();
    });
    description.addEventListener("input", render);
    contact.addEventListener("input", render);
    include.addEventListener("change", () => {
      void load();
    });
    card.append(title, intro, description, contact, ...messageId ? [includeLabel] : [], preview, privacy, status, footer);
    backdrop.append(card);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop && !description.value.trim()) close();
    });
    document.addEventListener("keydown", keydown, true);
    document.body.append(backdrop);
    description.focus();
    void load();
  }
  const ICONS = {
    download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    restart: ["M20 12a8 8 0 1 1-2.34-5.66L20 8.5", "M20 4v4.5h-4.5"],
    alert: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 7.5v5.5", "M12 16.5h.01"],
    notice: ["M4 10v4h3l6 4V6L7 10H4z", "M16.5 9a4 4 0 0 1 0 6", "M19 6.5a7.5 7.5 0 0 1 0 11"],
    external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    layers: ["M12 3.5l8.5 4.5-8.5 4.5L3.5 8z", "M3.5 12.5l8.5 4.5 8.5-4.5", "M3.5 16.5l8.5 4.5 8.5-4.5"],
    chevron: ["M6 15l6-6 6 6"],
    grid: ["M4 4h6.5v6.5H4z", "M13.5 4H20v6.5h-6.5z", "M4 13.5h6.5V20H4z", "M13.5 13.5H20V20h-6.5z"]
  };
  const icon = (name, size = 16) => (0, import_react2.createElement)(
    "svg",
    {
      className: "theone-icon",
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      focusable: false
    },
    ...ICONS[name].map((d) => (0, import_react2.createElement)("path", { key: d, d }))
  );
  function UpdateButton() {
    const t2 = useText();
    const status = (0, import_react2.useSyncExternalStore)(subscribeUpdate, () => update);
    const waiting = !!status?.waiting && !status.available && !status.state;
    if (!status || !status.available && !status.state && !waiting) return null;
    const label2 = waiting ? t2("update.waiting") : status.state === "installing" ? t2("update.installing") : status.state === "reloading" ? t2("update.reloading") : status.state === "restart" ? t2("update.restart") : status.state === "failed" ? t2("update.failed") : t2("update.available");
    const hint = updateHint(status);
    const title = `${label2} \xB7 ${hint}`;
    const act = (event) => {
      event.preventDefault();
      event.stopPropagation();
      startUpdate(status);
    };
    return (0, import_react2.createElement)(
      "span",
      {
        className: "theone-update",
        role: "button",
        tabIndex: 0,
        title,
        "aria-label": title,
        "data-state": waiting ? "waiting" : status.state ?? "available",
        onClick: act,
        onPointerDown: (event) => event.stopPropagation(),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") act(event);
        }
      },
      status.state === "installing" || status.state === "reloading" ? (0, import_react2.createElement)("span", { className: "theone-update-spin", "aria-hidden": true }) : icon(status.state === "restart" ? "restart" : status.state === "failed" ? "alert" : "download", 15)
    );
  }
  const symbol = () => (0, import_react2.createElement)(
    "svg",
    { className: "theone-symbol", viewBox: "0 0 20 20", width: 20, height: 20, "aria-hidden": true, focusable: false },
    (0, import_react2.createElement)("circle", { cx: 10, cy: 10, r: 8.6, fill: "none", stroke: "currentColor", strokeWidth: 1.4 }),
    (0, import_react2.createElement)("circle", { cx: 10, cy: 10, r: 2.4, fill: "currentColor" })
  );
  function SidebarEntry({ size }) {
    const t2 = useText();
    const marker = (0, import_react2.useRef)(null);
    const pending = (0, import_react2.useSyncExternalStore)(subscribeUpdate, () => !!update?.available && !update.state);
    const id = (0, import_react2.useSyncExternalStore)(navigation.subscribe, navigation.getSnapshot);
    const sessions = (0, import_react2.useSyncExternalStore)(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot);
    const panel = (0, import_react2.useSyncExternalStore)(ctx.layout.panelInfo.subscribe, ctx.layout.panelInfo.getSnapshot);
    const active = panel.activePanelId === panelId || panel.activePanelId === null && !!id && !!sessions.byId[id]?.retainedBy.mainView;
    (0, import_react2.useEffect)(() => {
      const button = marker.current?.closest("button");
      if (!button) return;
      let menu;
      const close = () => {
        menu?.remove();
        menu = void 0;
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", keydown, true);
        window.removeEventListener("resize", close);
        window.removeEventListener("scroll", close, true);
        window.removeEventListener("blur", close);
      };
      const outside = (event) => {
        if (!menu?.contains(event.target)) close();
      };
      const keydown = (event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          close();
          button.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          menu?.querySelector("button")?.focus();
        }
      };
      const open = (x, y) => {
        close();
        menu = document.createElement("div");
        menu.className = "theone-context-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", t2("settings.title"));
        menu.setAttribute("translate", "no");
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.textContent = t2("settings.menu");
        item.addEventListener("click", () => {
          close();
          ctx.layout.selectPanel(settingsPanelId);
        });
        menu.append(item);
        document.body.append(menu);
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", keydown, true);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        window.addEventListener("blur", close);
        item.focus();
      };
      const contextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const bounds = button.getBoundingClientRect();
        open(event.clientX || bounds.left, event.clientY || bounds.bottom);
      };
      const keyboard = (event) => {
        if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
          event.preventDefault();
          const bounds = button.getBoundingClientRect();
          open(bounds.left, bounds.bottom);
        }
      };
      button.addEventListener("contextmenu", contextmenu);
      button.addEventListener("keydown", keyboard);
      return () => {
        close();
        button.removeEventListener("contextmenu", contextmenu);
        button.removeEventListener("keydown", keyboard);
      };
    }, [size]);
    (0, import_react2.useEffect)(() => {
      const button = marker.current?.closest("button");
      if (!button || !active) return;
      const move = (event) => {
        if (event.pointerType === "touch") return;
        const bounds = button.getBoundingClientRect();
        button.style.setProperty("--one-pointer-x", `${event.clientX - bounds.left}px`);
        button.style.setProperty("--one-pointer-y", `${event.clientY - bounds.top}px`);
        button.dataset.oneTracking = "true";
      };
      const leave = () => {
        delete button.dataset.oneTracking;
      };
      button.addEventListener("pointermove", move, { passive: true });
      button.addEventListener("pointerleave", leave);
      button.addEventListener("pointercancel", leave);
      return () => {
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerleave", leave);
        button.removeEventListener("pointercancel", leave);
        leave();
        button.style.removeProperty("--one-pointer-x");
        button.style.removeProperty("--one-pointer-y");
      };
    }, [active, size]);
    return (0, import_react2.createElement)(
      "span",
      { ref: marker, className: "theone-nav", translate: "no", "data-wide": size === 16, "data-active": active },
      (0, import_react2.createElement)("span", { className: "theone-symbol-wrap" }, symbol(), size !== 16 && pending ? (0, import_react2.createElement)("span", { className: "theone-update-dot", "aria-hidden": true }) : null),
      size === 16 && (0, import_react2.createElement)(
        "span",
        { className: "theone-entry-copy" },
        (0, import_react2.createElement)(
          "span",
          { className: "theone-entry-title" },
          (0, import_react2.createElement)(
            "span",
            { className: "theone-wordmark", translate: "no" },
            (0, import_react2.createElement)("span", { className: "theone-word-the" }, "The"),
            (0, import_react2.createElement)("span", { className: "theone-word-one" }, "One", (0, import_react2.createElement)("span", { className: "theone-word-dot" }))
          ),
          (0, import_react2.createElement)("span", { className: "theone-entry-label" }, t2("gateway.label"))
        ),
        (0, import_react2.createElement)("span", { className: "theone-entry-sub" }, t2("gateway.subtitle"))
      ),
      size === 16 && (0, import_react2.createElement)(UpdateButton)
    );
  }
  const readSettings = async () => {
    const response = await fetch("/api/theone/settings", { signal: lifetime.signal, cache: "no-store" });
    if (!response.ok) throw new Error("Settings unavailable");
    return await response.json();
  };
  const saveBackgroundModel = async (choice) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await readSettings();
      const response = await fetch("/api/theone/settings", {
        method: "PUT",
        signal: lifetime.signal,
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: current.revision, values: { ...current.savedValues, workerProvider: choice?.provider ?? null, workerModel: choice?.model ?? null } })
      });
      if (response.ok) return await response.json();
      if (response.status !== 409) break;
    }
    throw new Error("Background model not saved");
  };
  function BackgroundModel({ directory }) {
    const t2 = useText();
    const state = (0, import_react2.useSyncExternalStore)((listener) => directory.subscribe(listener), () => directory.getSnapshot());
    const selection = state.pending ?? state.current;
    const theone = selection?.provider === "theone";
    const [settings, setSettings] = (0, import_react2.useState)();
    const [failed, setFailed] = (0, import_react2.useState)(false);
    const [saving, setSaving] = (0, import_react2.useState)(false);
    const button = (0, import_react2.useRef)(null);
    const closeMenu = (0, import_react2.useRef)();
    (0, import_react2.useEffect)(() => {
      if (!theone) return;
      let alive = true;
      readSettings().then((value) => {
        if (alive) setSettings(value);
      }, () => {
      });
      return () => {
        alive = false;
        closeMenu.current?.();
      };
    }, [theone]);
    if (!theone) return null;
    const pinned = settings?.values.workerProvider && settings.values.workerModel ? { provider: settings.values.workerProvider, model: settings.values.workerModel } : null;
    const nameOf = (provider, model) => settings?.models.find((item) => item.provider === provider && item.id === model)?.name ?? model;
    const effective = settings?.model ? nameOf(settings.model.provider, settings.model.model) : void 0;
    const label2 = pinned ? nameOf(pinned.provider, pinned.model) : effective ?? t2("bg.follow");
    const choose = async (choice) => {
      closeMenu.current?.();
      setSaving(true);
      setFailed(false);
      try {
        setSettings(await saveBackgroundModel(choice));
      } catch {
        setFailed(true);
      } finally {
        setSaving(false);
      }
    };
    const open = () => {
      const anchor = button.current;
      if (!anchor || closeMenu.current) {
        closeMenu.current?.();
        return;
      }
      const menu = document.createElement("div");
      menu.className = "theone-bg-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("translate", "no");
      menu.setAttribute("aria-label", t2("bg.title"));
      const heading = document.createElement("div");
      heading.className = "theone-bg-heading";
      heading.textContent = t2("bg.title");
      const list = document.createElement("div");
      list.className = "theone-bg-list";
      const models = (settings?.models ?? []).filter((item2) => item2.provider !== "theone");
      const item = (text, sub, checked, pick) => {
        const row = document.createElement("button");
        row.type = "button";
        row.setAttribute("role", "menuitemradio");
        row.setAttribute("aria-checked", String(checked));
        row.className = "theone-bg-item";
        const name = document.createElement("span");
        name.textContent = text;
        row.append(name);
        if (sub) {
          const small = document.createElement("small");
          small.textContent = sub;
          row.append(small);
        }
        const mark = document.createElement("span");
        mark.className = "theone-bg-check";
        mark.textContent = checked ? "\u2713" : "";
        row.append(mark);
        row.addEventListener("click", pick);
        return row;
      };
      const render = (query) => {
        list.replaceChildren(item(t2("bg.followItem"), !pinned && effective ? effective : void 0, !pinned, () => {
          void choose(null);
        }));
        const needle = query.trim().toLowerCase();
        const matched = models.filter((model) => !needle || `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(needle));
        for (const provider of [...new Set(matched.map((model) => model.provider))]) {
          const group = document.createElement("div");
          group.className = "theone-bg-group";
          group.textContent = provider;
          list.append(group);
          for (const model of matched.filter((entry) => entry.provider === provider))
            list.append(item(model.name, model.name !== model.id ? model.id : void 0, pinned?.provider === model.provider && pinned.model === model.id, () => {
              void choose({ provider: model.provider, model: model.id });
            }));
        }
        if (!matched.length && needle) {
          const empty = document.createElement("p");
          empty.className = "theone-bg-empty";
          empty.textContent = t2("bg.none");
          list.append(empty);
        }
      };
      menu.append(heading);
      let search;
      if (models.length > 8) {
        search = document.createElement("input");
        search.type = "search";
        search.className = "theone-bg-search";
        search.placeholder = t2("bg.search");
        search.addEventListener("input", () => render(search.value));
        menu.append(search);
      }
      menu.append(list);
      render("");
      document.body.append(menu);
      anchor.setAttribute("aria-expanded", "true");
      const place = () => {
        const bounds = anchor.getBoundingClientRect(), size = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(bounds.right - size.width, window.innerWidth - size.width - 8))}px`;
        menu.style.top = `${Math.max(8, bounds.top - size.height - 8)}px`;
      };
      place();
      const rows = () => [...menu.querySelectorAll(".theone-bg-item")];
      const outside = (event) => {
        if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
      };
      const keydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          anchor.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const all = rows(), index = all.indexOf(document.activeElement);
          all[(index + (event.key === "ArrowDown" ? 1 : all.length - 1) + (index < 0 && event.key === "ArrowUp" ? 1 : 0)) % all.length]?.focus();
        }
      };
      const close = () => {
        menu.remove();
        closeMenu.current = void 0;
        anchor.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", keydown, true);
        window.removeEventListener("resize", close);
        window.removeEventListener("blur", close);
      };
      closeMenu.current = close;
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", keydown, true);
      window.addEventListener("resize", close);
      window.addEventListener("blur", close);
      (search ?? rows().find((row) => row.getAttribute("aria-checked") === "true") ?? rows()[0])?.focus();
    };
    const title = failed ? t2("bg.error") : t2(pinned ? "bg.hint" : "bg.hintFollow", { model: label2 });
    return (0, import_react2.createElement)(
      "button",
      {
        ref: button,
        type: "button",
        className: "theone-bg",
        title,
        "aria-label": title,
        "aria-haspopup": "menu",
        "data-failed": failed,
        disabled: saving,
        onClick: () => {
          if (settings) open();
          else readSettings().then((value) => {
            setSettings(value);
          }, () => setFailed(true));
        }
      },
      (0, import_react2.createElement)("span", { className: "theone-bg-caption", "aria-hidden": true }, icon("layers", 15)),
      (0, import_react2.createElement)("span", { className: "theone-bg-text" }, label2),
      (0, import_react2.createElement)("span", { className: "theone-bg-chevron", "aria-hidden": true }, saving ? "\u2026" : icon("chevron", 12))
    );
  }
  let notices = [];
  const noticeListeners = /* @__PURE__ */ new Set();
  const setNotices = (value) => {
    notices = value;
    for (const listener of noticeListeners) listener();
  };
  const subscribeNotices = (listener) => {
    noticeListeners.add(listener);
    return () => {
      noticeListeners.delete(listener);
    };
  };
  const localized = (value) => localeSnapshot().active.startsWith("zh") ? value.zh ?? value.en ?? "" : value.en ?? value.zh ?? "";
  const shownDialogs = /* @__PURE__ */ new Set();
  const dismissNotice = (id) => {
    setNotices(notices.filter((notice) => notice.id !== id));
    void fetch("/api/theone/notices", {
      method: "POST",
      signal: lifetime.signal,
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dismiss: id })
    }).catch(() => {
    });
  };
  function openNoticeDialog(notice) {
    shownDialogs.add(notice.id);
    const backdrop = document.createElement("div");
    backdrop.className = "theone-dialog-backdrop";
    backdrop.setAttribute("translate", "no");
    const card = document.createElement("div");
    card.className = "theone-dialog";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.id = "theone-notice-title";
    title.textContent = localized(notice.title);
    card.setAttribute("aria-labelledby", title.id);
    const body = document.createElement("p");
    body.className = "theone-dialog-body";
    body.textContent = localized(notice.body);
    const footer = document.createElement("div");
    footer.className = "theone-dialog-actions";
    const close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", keydown, true);
      dismissNotice(notice.id);
    };
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    if (notice.link) {
      const more = document.createElement("button");
      more.type = "button";
      more.textContent = t("notice.more");
      more.addEventListener("click", () => {
        window.open(notice.link, "_blank", "noopener");
        close();
      });
      footer.append(more);
    }
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "theone-dialog-primary";
    ok.textContent = t("notice.ok");
    ok.addEventListener("click", close);
    footer.append(ok);
    card.append(title, body, footer);
    backdrop.append(card);
    document.addEventListener("keydown", keydown, true);
    document.body.append(backdrop);
    ok.focus();
  }
  const readNotices = async () => {
    try {
      const response = await fetch("/api/theone/notices", { signal: lifetime.signal, cache: "no-store" });
      if (!response.ok) return;
      setNotices((await response.json()).notices);
      const important = notices.find((notice) => notice.level === "important" && !shownDialogs.has(notice.id));
      if (important && !document.querySelector(".theone-dialog-backdrop")) openNoticeDialog(important);
    } catch {
    }
  };
  ctx.effect(() => {
    void readNotices();
    const timer = setInterval(() => {
      void readNotices();
    }, 3 * 36e5);
    return () => clearInterval(timer);
  });
  function NoticeStrip({ directory }) {
    const t2 = useText();
    const state = (0, import_react2.useSyncExternalStore)((listener) => directory.subscribe(listener), () => directory.getSnapshot());
    const list = (0, import_react2.useSyncExternalStore)(subscribeNotices, () => notices);
    const notice = list.find((item) => item.level === "info");
    if ((state.pending ?? state.current)?.provider !== "theone" || !notice) return null;
    const title = localized(notice.title), body = localized(notice.body);
    return (0, import_react2.createElement)(
      "div",
      { className: "theone-notice", role: "status", translate: "no" },
      (0, import_react2.createElement)("span", { className: "theone-notice-tag", title: t2("notice.label"), "aria-label": t2("notice.label"), role: "img" }, icon("notice", 14)),
      (0, import_react2.createElement)("span", { className: "theone-notice-text", title: `${title}
${body}` }, (0, import_react2.createElement)("strong", null, title), " ", body),
      notice.link ? (0, import_react2.createElement)("button", {
        type: "button",
        className: "theone-notice-link",
        "aria-label": t2("notice.more"),
        title: t2("notice.more"),
        onClick: () => {
          window.open(notice.link, "_blank", "noopener");
        }
      }, icon("external", 14)) : null,
      (0, import_react2.createElement)("button", { type: "button", className: "theone-notice-close", "aria-label": t2("notice.close"), title: t2("notice.close"), onClick: () => dismissNotice(notice.id) }, icon("close", 14))
    );
  }
  ctx.inject(["slots", "modelDirectories"], (scope) => {
    const slots = scope.slots;
    slots.inject("conversation.input.right", () => slots.register({
      name: "conversation.input.right",
      id: "theone.background-model",
      order: 100,
      inject: (sessionId) => ({ directory: scope.modelDirectories.directoryFor(sessionId).store })
    }, BackgroundModel));
    slots.inject("conversation.composer.dock", () => slots.register({
      name: "conversation.composer.dock",
      id: "theone.notice",
      order: 100,
      inject: (sessionId) => ({ directory: scope.modelDirectories.directoryFor(sessionId).store })
    }, NoticeStrip));
  });
  function GatewayPanel() {
    const t2 = useText();
    const [error, setError] = (0, import_react2.useState)();
    const [attempt, setAttempt] = (0, import_react2.useState)(0);
    (0, import_react2.useEffect)(() => {
      let mounted = true;
      setError(void 0);
      void navigation.open().catch((error2) => {
        console.warn("TheOne gateway navigation failed:", error2 instanceof Error ? error2.message : "Unknown navigation error");
        if (mounted) setError("gateway.error");
      });
      return () => {
        mounted = false;
      };
    }, [attempt]);
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-opening", "aria-live": "polite" },
      (0, import_react2.createElement)("p", null, t2(error ?? "gateway.opening")),
      error && (0, import_react2.createElement)("button", { type: "button", onClick: () => setAttempt((value) => value + 1) }, t2("retry"))
    );
  }
  function UpdateSection() {
    const t2 = useText();
    const status = (0, import_react2.useSyncExternalStore)(subscribeUpdate, () => update);
    const [checking, setChecking] = (0, import_react2.useState)(false);
    const [failed, setFailed] = (0, import_react2.useState)(false);
    const check = async () => {
      setChecking(true);
      setFailed(false);
      setFailed(!await readUpdate("GET", void 0, true));
      setChecking(false);
    };
    const waiting = !!status?.waiting && !status.available && !status.state;
    const busy = status?.state === "installing" || status?.state === "reloading";
    const pending = !!status && (status.available || waiting || !!status.state);
    const line = checking ? t2("settings.updateChecking") : failed ? t2("settings.updateCheckFailed") : !status ? t2("settings.updateUnknown") : pending ? updateHint(status) : t2("settings.updateLatest");
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-settings-group theone-settings-update" },
      (0, import_react2.createElement)("h2", null, t2("settings.update")),
      status && !pending ? (0, import_react2.createElement)("p", { className: "theone-settings-update-version" }, t2("settings.updateCurrent", { current: status.current })) : null,
      (0, import_react2.createElement)("p", { role: "status" }, line),
      (0, import_react2.createElement)(
        "div",
        { className: "theone-settings-update-actions" },
        (0, import_react2.createElement)("button", { type: "button", disabled: checking || busy, onClick: () => {
          void check();
        } }, t2("settings.updateCheck")),
        (0, import_react2.createElement)("button", {
          type: "button",
          className: "theone-settings-save",
          disabled: checking || busy || !status || !pending || status.state === "restart",
          onClick: () => {
            if (status) startUpdate(status);
          }
        }, t2(status?.state === "installing" ? "update.installing" : status?.state === "reloading" ? "update.reloading" : "settings.updateInstall"))
      )
    );
  }
  function useRemote(name, fast) {
    const [status, setStatus] = (0, import_react2.useState)();
    const [failed, setFailed] = (0, import_react2.useState)(false);
    const [busy, setBusy] = (0, import_react2.useState)(false);
    const [error, setError] = (0, import_react2.useState)();
    const call = async (body) => {
      try {
        const response = await fetch(`/api/theone/${name}`, {
          signal: lifetime.signal,
          cache: "no-store",
          ...body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}
        });
        const value = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (body && value.error) {
            setError(value.error);
            return;
          }
          throw new Error("Status unavailable");
        }
        setStatus(value);
        setFailed(false);
        if (body) setError(void 0);
      } catch {
        if (!lifetime.signal.aborted) setFailed(true);
      }
    };
    const act = async (body) => {
      setBusy(true);
      try {
        await call(body);
      } finally {
        setBusy(false);
      }
    };
    const quick = fast(status);
    (0, import_react2.useEffect)(() => {
      void call();
      const timer = setInterval(() => {
        void call();
      }, quick ? 1500 : 15e3);
      return () => clearInterval(timer);
    }, [quick]);
    return { status, failed, busy, error, act };
  }
  function qrImage(url, alt) {
    const qr = qrcode_default(0, "M");
    qr.addData(url);
    qr.make();
    return (0, import_react2.createElement)("img", { className: "theone-weixin-qr", src: qr.createDataURL(6, 3), alt, width: 220, height: 220 });
  }
  function remoteState(t2, remote, expiredKey, explain = (code) => code) {
    const { status, failed } = remote;
    const account = status?.account ?? "";
    const line = !status ? failed ? t2("settings.remoteError") : t2("settings.loading") : status.state === "online" ? t2("settings.remoteOnline", { account }) : status.state === "connecting" ? t2("settings.remoteConnecting", { account }) : status.state === "paused" ? t2("settings.remotePaused", { account, minutes: Math.max(1, Math.ceil(((status.pausedUntil ?? Date.now()) - Date.now()) / 6e4)) }) : status.state === "expired" ? t2(expiredKey) : account ? t2("settings.remoteOff", { account }) : "";
    return [
      line ? (0, import_react2.createElement)("p", { role: "status", key: "line" }, line) : null,
      status?.lastError && status.state !== "off" ? (0, import_react2.createElement)("p", { className: "theone-settings-update-version", key: "error" }, t2("settings.remoteLastError", { error: explain(status.lastError) })) : null
    ];
  }
  function remoteButton(t2, busy, act, label2, body, primary = false) {
    return (0, import_react2.createElement)("button", { type: "button", key: label2, disabled: busy, className: primary ? "theone-settings-save" : void 0, onClick: () => act(body) }, t2(label2));
  }
  function remoteControls(t2, remote) {
    const { status, busy, act } = remote;
    if (!status?.account || status.state === "expired") return [];
    return [
      status.state === "off" ? remoteButton(t2, busy, act, "settings.remoteResume", { action: "enable" }, true) : remoteButton(t2, busy, act, "settings.remotePause", { action: "disable" }),
      remoteButton(t2, busy, act, "settings.remoteLogout", { action: "logout" })
    ];
  }
  function WeixinSection() {
    const t2 = useText();
    const remote = useRemote("weixin", (status2) => !!status2?.login && status2.login.step !== "failed");
    const { status, busy } = remote;
    const act = (body) => {
      void remote.act(body);
    };
    const [code, setCode] = (0, import_react2.useState)("");
    const login = status?.login;
    const waiting = !!login && login.step !== "failed";
    const button = (label2, body, primary = false) => remoteButton(t2, busy, act, label2, body, primary);
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-settings-group theone-settings-update theone-weixin" },
      (0, import_react2.createElement)("h2", null, t2("settings.weixin")),
      (0, import_react2.createElement)("p", null, t2("settings.weixinIntro")),
      ...remoteState(t2, remote, "settings.weixinExpired"),
      login?.step === "qr" ? (0, import_react2.createElement)("div", { className: "theone-weixin-login" }, qrImage(login.url, t2("settings.weixinScan")), (0, import_react2.createElement)("p", null, t2("settings.weixinScan"))) : null,
      login?.step === "scanned" ? (0, import_react2.createElement)("p", { role: "status" }, t2("settings.weixinScanned")) : null,
      login?.step === "verify" ? (0, import_react2.createElement)(
        "form",
        { className: "theone-settings-update-actions", onSubmit: (event) => {
          event.preventDefault();
          if (code.trim()) {
            act({ action: "verify", code });
            setCode("");
          }
        } },
        (0, import_react2.createElement)("label", { htmlFor: "theone-weixin-code" }, t2("settings.weixinVerify")),
        (0, import_react2.createElement)("input", { id: "theone-weixin-code", value: code, maxLength: 16, autoComplete: "one-time-code", onChange: (event) => setCode(event.target.value) }),
        (0, import_react2.createElement)("button", { type: "submit", disabled: busy || !code.trim() }, t2("settings.weixinVerifySubmit"))
      ) : null,
      login?.step === "failed" ? (0, import_react2.createElement)("p", { role: "alert" }, t2("settings.weixinFailed", { reason: login.reason })) : null,
      (0, import_react2.createElement)(
        "div",
        { className: "theone-settings-update-actions" },
        waiting ? button("settings.weixinCancel", { action: "cancel" }) : !status?.account ? button("settings.weixinBind", { action: "login" }, true) : status.state === "expired" ? button("settings.weixinRescan", { action: "login" }, true) : null,
        ...waiting ? [] : remoteControls(t2, { ...remote, act })
      ),
      (0, import_react2.createElement)("p", { className: "theone-settings-update-version" }, t2("settings.weixinNote"))
    );
  }
  function TelegramSection() {
    const t2 = useText();
    const remote = useRemote("telegram", (status2) => !!status2?.pairing);
    const { status, busy, error } = remote;
    const act = (body) => {
      void remote.act(body);
    };
    const [token, setToken] = (0, import_react2.useState)("");
    const pairing = status?.pairing;
    const asking = !status?.account || status.state === "expired";
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-settings-group theone-settings-update theone-weixin" },
      (0, import_react2.createElement)("h2", null, t2("settings.telegram")),
      (0, import_react2.createElement)("p", null, t2("settings.telegramIntro")),
      ...pairing ? [(0, import_react2.createElement)("p", { role: "status", key: "line" }, t2("settings.telegramWaiting", { account: `@${pairing.bot}` }))] : remoteState(t2, remote, "settings.telegramExpired"),
      pairing ? (0, import_react2.createElement)(
        "div",
        { className: "theone-weixin-login" },
        qrImage(`https://t.me/${pairing.bot}?start=${pairing.code}`, t2("settings.telegramPairScan")),
        (0, import_react2.createElement)("p", null, t2("settings.telegramPair", { bot: `@${pairing.bot}`, code: pairing.code }))
      ) : null,
      asking ? (0, import_react2.createElement)(
        "form",
        { className: "theone-settings-update-actions", onSubmit: (event) => {
          event.preventDefault();
          if (token.trim()) {
            act({ action: "connect", token });
            setToken("");
          }
        } },
        (0, import_react2.createElement)("label", { htmlFor: "theone-telegram-token" }, t2("settings.telegramToken")),
        (0, import_react2.createElement)("input", {
          id: "theone-telegram-token",
          type: "password",
          value: token,
          maxLength: 200,
          autoComplete: "off",
          spellCheck: false,
          placeholder: "123456789:AA\u2026",
          onChange: (event) => setToken(event.target.value)
        }),
        (0, import_react2.createElement)("button", { type: "submit", className: "theone-settings-save", disabled: busy || !token.trim() }, t2("settings.remoteConnect"))
      ) : null,
      error ? (0, import_react2.createElement)("p", { role: "alert" }, t2(error === "TELEGRAM_TOKEN_INVALID" ? "settings.telegramTokenInvalid" : "settings.telegramUnreachable")) : null,
      (0, import_react2.createElement)("div", { className: "theone-settings-update-actions" }, ...remoteControls(t2, { ...remote, act })),
      (0, import_react2.createElement)("p", { className: "theone-settings-update-version" }, t2("settings.telegramNote"))
    );
  }
  function IMessageSection() {
    const t2 = useText();
    const remote = useRemote("imessage", () => false);
    const { status, busy, error } = remote;
    const act = (body) => {
      void remote.act(body);
    };
    const [handle, setHandle] = (0, import_react2.useState)("");
    const explain = (code) => code === "IMESSAGE_NO_ACCESS" ? t2("settings.imessageNoAccess") : code;
    const asking = status?.supported && !status.account;
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-settings-group theone-settings-update theone-weixin" },
      (0, import_react2.createElement)("h2", null, t2("settings.imessage")),
      (0, import_react2.createElement)("p", null, t2("settings.imessageIntro")),
      status && !status.supported && !status.account ? (0, import_react2.createElement)("p", { role: "status" }, t2("settings.imessageUnsupported")) : null,
      ...remoteState(t2, remote, "settings.imessageNoAccess", explain),
      asking ? (0, import_react2.createElement)(
        "form",
        { className: "theone-settings-update-actions", onSubmit: (event) => {
          event.preventDefault();
          if (handle.trim()) act({ action: "connect", handle });
        } },
        (0, import_react2.createElement)("label", { htmlFor: "theone-imessage-handle" }, t2("settings.imessageHandle")),
        (0, import_react2.createElement)("input", {
          id: "theone-imessage-handle",
          value: handle,
          maxLength: 200,
          autoComplete: "off",
          placeholder: "+86 138 0000 0000",
          onChange: (event) => setHandle(event.target.value)
        }),
        (0, import_react2.createElement)("button", { type: "submit", className: "theone-settings-save", disabled: busy || !handle.trim() }, t2("settings.remoteConnect"))
      ) : null,
      error ? (0, import_react2.createElement)("p", { role: "alert" }, error === "IMESSAGE_NO_ACCESS" ? t2("settings.imessageNoAccess") : t2(error === "IMESSAGE_HANDLE_INVALID" ? "settings.imessageHandleInvalid" : "settings.imessageUnsupported")) : null,
      (0, import_react2.createElement)("div", { className: "theone-settings-update-actions" }, ...remoteControls(t2, { ...remote, act })),
      status?.supported ? (0, import_react2.createElement)("p", { className: "theone-settings-update-version" }, t2("settings.imessageNote")) : null
    );
  }
  function SettingsPanel() {
    const t2 = useText();
    const heading = (0, import_react2.useRef)(null);
    const [snapshot, setSnapshot] = (0, import_react2.useState)();
    const [draft, setDraft] = (0, import_react2.useState)();
    const [saving, setSaving] = (0, import_react2.useState)(false);
    const [message, setMessage] = (0, import_react2.useState)();
    const saveRequest = (0, import_react2.useRef)();
    (0, import_react2.useEffect)(() => () => saveRequest.current?.abort(), []);
    const [error, setError] = (0, import_react2.useState)(false);
    const [attempt, setAttempt] = (0, import_react2.useState)(0);
    (0, import_react2.useEffect)(() => {
      heading.current?.focus();
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, lifetime.signal]);
      setError(false);
      void (async () => {
        try {
          const response = await fetch("/api/theone/settings", { signal, cache: "no-store" });
          if (!response.ok) throw new Error("Settings unavailable");
          const value = await response.json();
          if (!signal.aborted) {
            setSnapshot(value);
            setDraft(value.savedValues);
            setMessage(void 0);
          }
        } catch {
          if (!signal.aborted) setError(true);
        }
      })();
      return () => controller.abort();
    }, [attempt]);
    const groups = [
      ["models", ["workerProvider", "workerModel", "routerMode"]],
      ["history", ["historyCatalog", "catalogIntervalMs"]],
      ["linkage", ["linkScope", "routeNotice", "factLinks", "factExtraction"]],
      ["limits", ["maxDescriptorChars", "maxResponseChars"]],
      ["storage", ["contextsPath", "databasePath", "gatewayKey"]],
      ["other", ["notices"]]
    ];
    const display = (key) => {
      const value = snapshot.values[key];
      if (value === null) return t2(key === "workerProvider" || key === "workerModel" ? "settings.follow" : "settings.none");
      if (typeof value === "boolean") return t2(value ? "settings.on" : "settings.off");
      if (key === "linkScope") return t2(`settings.scope.${value}`);
      if (key === "routeNotice") return t2(`settings.notice.${value}`);
      if (key === "catalogIntervalMs") return t2("settings.seconds", { count: Number(value) / 1e3 });
      return typeof value === "number" ? value.toLocaleString(localeSnapshot().active) : value || t2("settings.none");
    };
    const dirty = !!snapshot && !!draft && EDITABLE_SETTINGS_KEYS.some((key) => draft[key] !== snapshot.savedValues[key]);
    const change = (key, value) => {
      setDraft((current) => current && { ...current, [key]: value });
      setMessage(void 0);
    };
    const save = async () => {
      if (!snapshot || !draft || saving) return;
      const controller = new AbortController();
      saveRequest.current = controller;
      const signal = AbortSignal.any([controller.signal, lifetime.signal]);
      setSaving(true);
      setMessage(void 0);
      try {
        const response = await fetch("/api/theone/settings", {
          method: "PUT",
          signal,
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: draft, revision: snapshot.revision })
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          if (!signal.aborted) setMessage(response.status === 409 ? "settings.conflict" : failure.error === "CONTEXTS_UNREADABLE" ? "settings.contextsUnreadable" : "settings.saveError");
          return;
        }
        const value = await response.json();
        if (!signal.aborted) {
          setSnapshot(value);
          setDraft(value.savedValues);
          setMessage(value.restartRequired ? "settings.restart" : "settings.saved");
        }
      } catch {
        if (!signal.aborted) setMessage("settings.saveError");
      } finally {
        if (!signal.aborted) setSaving(false);
      }
    };
    const control = (key) => {
      if (!draft || !snapshot || !EDITABLE_SETTINGS_KEYS.includes(key)) return display(key);
      const field = key;
      const props = { "aria-label": t2(`settings.${key}`), disabled: saving, id: `theone-setting-${key}` };
      const select = (value, choices, selectValue) => (0, import_react2.createElement)(
        "select",
        { ...props, value, required: field === "workerModel" && !!draft.workerProvider, onChange: (event) => selectValue(event.target.value) },
        ...choices.map((choice) => (0, import_react2.createElement)("option", { key: choice.value, value: choice.value }, choice.label))
      );
      if (field === "historyCatalog" || field === "notices" || field === "factLinks" || field === "factExtraction") return select(String(draft[field]), [{ value: "true", label: t2("settings.on") }, { value: "false", label: t2("settings.off") }], (v) => change(field, v === "true"));
      if (field === "linkScope" || field === "routeNotice") {
        const values = field === "linkScope" ? ["auto", "workspace", "off"] : ["switch", "hidden", "all"];
        return select(draft[field], values.map((value) => ({ value, label: t2(`settings.${field === "linkScope" ? "scope" : "notice"}.${value}`) })), (v) => change(field, v));
      }
      if (field === "routerMode")
        return select(draft.routerMode, ["llm", "rules"].map((value) => ({ value, label: t2(`settings.${value}`) })), (v) => change(field, v));
      const offered = (provider) => snapshot.models.filter((model) => model.provider === provider);
      if (field === "workerProvider") {
        const providers = [...new Set([...snapshot.models.map((model) => model.provider), snapshot.savedValues.workerProvider].filter((value) => !!value && value !== "theone"))];
        return select(draft.workerProvider ?? "", [{ value: "", label: t2("settings.follow") }, ...providers.map((value) => ({ value, label: value }))], (v) => {
          const model = v === snapshot.savedValues.workerProvider ? snapshot.savedValues.workerModel : v === snapshot.model?.provider ? snapshot.model.model : offered(v)[0]?.id;
          setDraft((current) => current && { ...current, workerProvider: v || null, workerModel: v ? model ?? null : null });
          setMessage(void 0);
        });
      }
      if (field === "workerModel") {
        const models = offered(draft.workerProvider).map((model) => ({ value: model.id, label: model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id }));
        if (draft.workerModel && !models.some((model) => model.value === draft.workerModel)) models.unshift({ value: draft.workerModel, label: draft.workerModel });
        return select(draft.workerModel ?? "", [{ value: "", label: t2(draft.workerProvider ? "settings.none" : "settings.follow") }, ...models], (v) => change(field, v || null));
      }
      if (field === "catalogIntervalMs" || field === "maxDescriptorChars" || field === "maxResponseChars") {
        const interval = field === "catalogIntervalMs";
        return (0, import_react2.createElement)("input", {
          ...props,
          type: "number",
          required: true,
          step: 1,
          min: interval ? 10 : 128,
          max: interval ? 86400 : field === "maxDescriptorChars" ? 1e6 : 1e7,
          value: Number.isFinite(draft[field]) ? draft[field] / (interval ? 1e3 : 1) : "",
          onChange: (event) => change(field, event.target.valueAsNumber * (interval ? 1e3 : 1))
        });
      }
      return (0, import_react2.createElement)("input", {
        ...props,
        type: "text",
        value: draft.contextsPath ?? "",
        maxLength: 4096,
        placeholder: t2("settings.none"),
        onChange: (event) => change("contextsPath", event.target.value.trim() ? event.target.value : null)
      });
    };
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-settings", translate: "no" },
      (0, import_react2.createElement)(
        "header",
        { className: "theone-settings-header" },
        (0, import_react2.createElement)("div", null, (0, import_react2.createElement)("h1", { ref: heading, tabIndex: -1 }, t2("settings.title")), (0, import_react2.createElement)("p", null, t2("settings.subtitle"))),
        (0, import_react2.createElement)("button", { type: "button", disabled: saving, onClick: () => ctx.layout.selectPanel(panelId) }, t2("settings.back"))
      ),
      (0, import_react2.createElement)("p", { className: "theone-settings-notice" }, t2("settings.readOnly")),
      (0, import_react2.createElement)(UpdateSection),
      (0, import_react2.createElement)(WeixinSection),
      (0, import_react2.createElement)(TelegramSection),
      (0, import_react2.createElement)(IMessageSection),
      !snapshot && !error ? (0, import_react2.createElement)("p", { role: "status" }, t2("settings.loading")) : null,
      error ? (0, import_react2.createElement)("p", { role: "alert" }, t2("settings.error"), " ", (0, import_react2.createElement)("button", { type: "button", onClick: () => setAttempt((n) => n + 1) }, t2("retry"))) : null,
      snapshot && draft && (0, import_react2.createElement)(
        "form",
        { onSubmit: (event) => {
          event.preventDefault();
          void save();
        } },
        (0, import_react2.createElement)(
          "section",
          { className: "theone-settings-summary" },
          (0, import_react2.createElement)(
            "dl",
            null,
            (0, import_react2.createElement)("div", null, (0, import_react2.createElement)("dt", null, t2("settings.model")), (0, import_react2.createElement)("dd", null, snapshot.model ? `${snapshot.model.provider} / ${snapshot.model.model}` : t2("settings.none"))),
            (0, import_react2.createElement)("div", null, (0, import_react2.createElement)("dt", null, t2("settings.capacity")), (0, import_react2.createElement)("dd", null, snapshot.model?.contextWindow?.toLocaleString(localeSnapshot().active) ?? t2("settings.none"))),
            (0, import_react2.createElement)("div", null, (0, import_react2.createElement)("dt", null, t2("settings.output")), (0, import_react2.createElement)("dd", null, snapshot.model?.defaultMaxTokens?.toLocaleString(localeSnapshot().active) ?? t2("settings.none")))
          ),
          snapshot.modelUnavailable ? (0, import_react2.createElement)("p", { role: "status" }, t2("settings.modelUnavailable")) : null,
          (0, import_react2.createElement)("p", null, t2("settings.inherited")),
          (0, import_react2.createElement)("p", null, t2("settings.compression"))
        ),
        ...groups.map(([group, keys]) => (0, import_react2.createElement)(
          "section",
          { className: "theone-settings-group", key: group },
          (0, import_react2.createElement)("h2", null, t2(`settings.${group}`)),
          (0, import_react2.createElement)("dl", null, ...keys.map((key) => (0, import_react2.createElement)(
            "div",
            { className: "theone-settings-row", key },
            (0, import_react2.createElement)("dt", null, (0, import_react2.createElement)("strong", null, t2(`settings.${key}`)), (0, import_react2.createElement)("p", null, t2(`settings.help.${key}`)), (0, import_react2.createElement)("code", null, key)),
            (0, import_react2.createElement)("dd", null, control(key), key === "catalogIntervalMs" && Number.isFinite(draft.catalogIntervalMs) ? (0, import_react2.createElement)("small", null, t2("settings.seconds", { count: draft.catalogIntervalMs / 1e3 })) : null)
          )))
        )),
        (0, import_react2.createElement)(
          "footer",
          { className: "theone-settings-footer" },
          (0, import_react2.createElement)(
            "p",
            { role: message === "settings.saveError" || message === "settings.conflict" || message === "settings.contextsUnreadable" ? "alert" : "status" },
            message ? t2(message) : dirty ? t2("settings.unsaved") : snapshot.restartRequired ? t2("settings.restart") : ""
          ),
          message === "settings.conflict" ? (0, import_react2.createElement)("button", { type: "button", onClick: () => setAttempt((n) => n + 1) }, t2("settings.reload")) : null,
          (0, import_react2.createElement)("button", { type: "button", disabled: saving || !dirty, onClick: () => {
            setDraft(snapshot.savedValues);
            setMessage(void 0);
          } }, t2("settings.reset")),
          (0, import_react2.createElement)("button", { type: "submit", disabled: saving || !dirty, className: "theone-settings-save" }, t2(saving ? "settings.saving" : "settings.save"))
        )
      )
    );
  }
  const ROUTE_REASONS = /* @__PURE__ */ new Set([
    "steering",
    "short-continuation",
    "attachment-only",
    "correction",
    "correction-unclear",
    "explicit-new-topic",
    "no-history-evidence",
    "unclear-settled",
    "unclear-new",
    "entity-or-keyword",
    "keyword-only-switch",
    "current-reference",
    "combined-contexts",
    "insufficient-evidence",
    "multiple-contexts",
    "weak-keyword-match",
    "no-history-match",
    "CATALOG_NOT_READY",
    "CATALOG_REVIEW_LIMIT",
    "HISTORY_SEARCH_UNAVAILABLE"
  ]);
  const routeReason = (reason) => ROUTE_REASONS.has(reason) ? t(`route.reason.${reason}`) : reason.startsWith("router-fallback:") ? t("route.reason.router-fallback") : reason.startsWith("handback:") ? t("route.reason.handback") : reason;
  function TopicManager({ topic, constraints, groups, contexts, post, busy }) {
    const t2 = useText();
    const [title, setTitle] = (0, import_react2.useState)(topic.title);
    const [summary, setSummary] = (0, import_react2.useState)(topic.summary);
    const [rules, setRules] = (0, import_react2.useState)(constraints);
    const groupOf = groups.find((group2) => group2.contextIds.includes(topic.id))?.id ?? "";
    const [group, setGroup] = (0, import_react2.useState)(groupOf);
    const [groupTitle, setGroupTitle] = (0, import_react2.useState)("");
    const [into, setInto] = (0, import_react2.useState)("");
    const [confirm, setConfirm] = (0, import_react2.useState)();
    const [sessions, setSessions] = (0, import_react2.useState)();
    const [session, setSession] = (0, import_react2.useState)("");
    (0, import_react2.useEffect)(() => {
      const controller = new AbortController();
      fetch("/api/theone/sessions", { signal: AbortSignal.any([controller.signal, lifetime.signal]), cache: "no-store" }).then((response) => response.ok ? response.json() : { sessions: [] }).then((value) => setSessions(value.sessions)).catch(() => {
        if (!controller.signal.aborted) setSessions([]);
      });
      return () => controller.abort();
    }, []);
    const own = new Set(topic.sourceSessionIds);
    const edited = title.trim() !== topic.title || summary.trim() !== topic.summary || rules.trim() !== constraints;
    const field = (label2, control) => (0, import_react2.createElement)("label", { className: "theone-manage-field" }, (0, import_react2.createElement)("span", null, t2(label2)), control);
    return (0, import_react2.createElement)(
      "div",
      { className: "theone-manage" },
      field("manage.title", (0, import_react2.createElement)("input", { value: title, maxLength: 80, disabled: busy, onChange: (event) => setTitle(event.target.value) })),
      field("manage.summary", (0, import_react2.createElement)("textarea", { value: summary, rows: 3, maxLength: 2e3, disabled: busy, onChange: (event) => setSummary(event.target.value) })),
      field("manage.constraintsLabel", (0, import_react2.createElement)("textarea", { value: rules, rows: 2, maxLength: 400, disabled: busy, placeholder: t2("manage.constraintsPlaceholder"), onChange: (event) => setRules(event.target.value) })),
      (0, import_react2.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react2.createElement)("button", {
          type: "button",
          disabled: busy || !edited || !title.trim() || !summary.trim(),
          onClick: () => {
            void post("/api/theone/topics", { action: "edit", id: topic.id, title, summary, constraints: rules });
          }
        }, t2("manage.save"))
      ),
      field("manage.workspace", (0, import_react2.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react2.createElement)(
          "select",
          { value: group, disabled: busy, onChange: (event) => setGroup(event.target.value) },
          (0, import_react2.createElement)("option", { value: "" }, t2("manage.unassigned")),
          ...groups.map((item) => (0, import_react2.createElement)("option", { key: item.id, value: item.id }, item.title)),
          (0, import_react2.createElement)("option", { value: "__new" }, t2("manage.newWorkspace"))
        ),
        group === "__new" ? (0, import_react2.createElement)("input", { value: groupTitle, maxLength: 80, placeholder: t2("manage.newWorkspaceName"), disabled: busy, onChange: (event) => setGroupTitle(event.target.value) }) : null,
        (0, import_react2.createElement)("button", {
          type: "button",
          disabled: busy || group === groupOf || group === "__new" && !groupTitle.trim(),
          onClick: () => {
            void post("/api/theone/topics", { action: "move", id: topic.id, ...group === "__new" ? { groupTitle } : group ? { groupId: group } : {} });
          }
        }, t2("manage.move"))
      )),
      field("manage.attach", (0, import_react2.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react2.createElement)(
          "select",
          { value: session, disabled: busy || !sessions, onChange: (event) => setSession(event.target.value) },
          (0, import_react2.createElement)("option", { value: "" }, sessions ? t2("manage.attachPick") : t2("manage.loadingSessions")),
          ...(sessions ?? []).filter((item) => !own.has(item.id)).map((item) => (0, import_react2.createElement)("option", { key: item.id, value: item.id }, item.title))
        ),
        (0, import_react2.createElement)("button", { type: "button", disabled: busy || !session, onClick: () => {
          void post("/api/theone/topics", { action: "attach", id: topic.id, sessionId: session }).then((ok) => {
            if (ok) setSession("");
          });
        } }, t2("manage.attachButton"))
      )),
      (0, import_react2.createElement)("p", { className: "theone-manage-hint" }, t2("manage.attachHint")),
      field("manage.merge", (0, import_react2.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react2.createElement)(
          "select",
          { value: into, disabled: busy, onChange: (event) => {
            setInto(event.target.value);
            setConfirm(void 0);
          } },
          (0, import_react2.createElement)("option", { value: "" }, t2("manage.mergePick")),
          ...contexts.filter((item) => item.id !== topic.id).map((item) => (0, import_react2.createElement)("option", { key: item.id, value: item.id }, item.title))
        ),
        (0, import_react2.createElement)(
          "button",
          {
            type: "button",
            disabled: busy || !into,
            className: confirm === "merge" ? "theone-danger" : void 0,
            onClick: () => {
              if (confirm !== "merge") setConfirm("merge");
              else void post("/api/theone/topics", { action: "merge", id: topic.id, into });
            }
          },
          t2(confirm === "merge" ? "manage.confirm" : "manage.mergeButton")
        )
      )),
      (0, import_react2.createElement)("p", { className: "theone-manage-hint" }, t2("manage.mergeHint")),
      (0, import_react2.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react2.createElement)(
          "button",
          {
            type: "button",
            disabled: busy,
            className: "theone-danger",
            onClick: () => {
              if (confirm !== "delete") setConfirm("delete");
              else void post("/api/theone/topics", { action: "delete", id: topic.id });
            }
          },
          t2(confirm === "delete" ? "manage.deleteConfirm" : "manage.delete")
        ),
        confirm === "delete" ? (0, import_react2.createElement)("span", { className: "theone-manage-hint" }, t2("manage.deleteHint")) : null
      )
    );
  }
  const label = (text) => text.replace(/\s*[:：]\s*$/, "");
  function RouteList({ routes, stats, contexts, post, busy }) {
    const t2 = useText();
    const titleOf = (id) => contexts.find((context) => context.id === id)?.title ?? t2("routes.removed");
    return (0, import_react2.createElement)(
      "details",
      { className: "theone-routes" },
      (0, import_react2.createElement)(
        "summary",
        null,
        t2("routes.title"),
        (0, import_react2.createElement)("span", null, ` ${routes.length}`),
        stats?.total ? (0, import_react2.createElement)("small", { className: "theone-route-stats" }, t2("routes.stats", {
          total: stats.total,
          corrected: stats.corrected,
          rate: Math.round(100 * (stats.total - stats.corrected) / stats.total),
          clarified: stats.clarified
        })) : null
      ),
      (0, import_react2.createElement)("p", { className: "theone-manage-hint" }, t2("routes.hint")),
      routes.length ? (0, import_react2.createElement)("ol", null, ...routes.map((route) => {
        const target = route.decision.contextId;
        const receipt = route.receipt;
        const details = [
          routeReason(route.decision.reason),
          receipt?.mode === "llm" ? receipt.model : receipt ? t2("routes.rules") : void 0,
          receipt?.elapsedMs !== void 0 ? `${(receipt.elapsedMs / 1e3).toFixed(1)} s` : void 0,
          receipt?.errorCode ? t2("routes.error", { code: receipt.errorCode }) : void 0
        ].filter(Boolean).join(" \xB7 ");
        return (0, import_react2.createElement)(
          "li",
          { key: route.messageId },
          (0, import_react2.createElement)("time", null, new Date(route.at).toLocaleTimeString(localeSnapshot().active, { hour: "2-digit", minute: "2-digit" })),
          (0, import_react2.createElement)("q", null, route.excerpt || "\u2026"),
          (0, import_react2.createElement)(
            "div",
            { className: "theone-route-target" },
            (0, import_react2.createElement)("strong", null, route.decision.action === "CLARIFY" ? t2("routes.clarify") : `\u2192 ${titleOf(target)}`),
            (0, import_react2.createElement)("small", null, details)
          ),
          (0, import_react2.createElement)(
            "div",
            { className: "theone-route-actions" },
            (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", onClick: () => openFeedbackDialog(route.messageId) }, t2("routes.report")),
            route.correctedTo ? (0, import_react2.createElement)(
              "span",
              { className: "theone-route-fixed" },
              t2("routes.corrected", { title: titleOf(route.correctedTo) }),
              " ",
              (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", disabled: busy, onClick: () => void post("/api/theone/routes", { messageId: route.messageId, undo: true }) }, t2("routes.undo"))
            ) : (0, import_react2.createElement)(
              import_react2.Fragment,
              null,
              ...(route.decision.alternateIds ?? []).filter((id) => id !== target && contexts.some((context) => context.id === id)).slice(0, 2).map((id) => (0, import_react2.createElement)("button", { key: id, type: "button", className: "theone-quiet", disabled: busy, onClick: () => void post("/api/theone/routes", { messageId: route.messageId, contextId: id }) }, t2("routes.moveTo", { title: titleOf(id) }))),
              (0, import_react2.createElement)(
                "select",
                {
                  value: "",
                  disabled: busy,
                  "aria-label": t2("routes.move"),
                  onChange: (event) => {
                    if (event.target.value) void post("/api/theone/routes", { messageId: route.messageId, contextId: event.target.value });
                  }
                },
                (0, import_react2.createElement)("option", { value: "" }, t2("routes.move")),
                ...contexts.filter((context) => context.id !== target).map((context) => (0, import_react2.createElement)("option", { key: context.id, value: context.id }, context.title))
              )
            )
          )
        );
      })) : (0, import_react2.createElement)("p", { className: "theone-links-empty" }, t2("routes.empty"))
    );
  }
  function CatalogPanel() {
    const t2 = useText();
    const [snapshot, setSnapshot] = (0, import_react2.useState)();
    const [error, setError] = (0, import_react2.useState)();
    const [busy, setBusy] = (0, import_react2.useState)();
    const [routes, setRoutes] = (0, import_react2.useState)([]);
    const [routeStats, setRouteStats] = (0, import_react2.useState)();
    const [managing, setManaging] = (0, import_react2.useState)();
    const [folded, setFolded] = (0, import_react2.useState)(/* @__PURE__ */ new Set());
    const [creating, setCreating] = (0, import_react2.useState)(false);
    const [newTitle, setNewTitle] = (0, import_react2.useState)("");
    const [choosing, setChoosing] = (0, import_react2.useState)(false);
    const [choices, setChoices] = (0, import_react2.useState)();
    const [reconsidering, setReconsidering] = (0, import_react2.useState)(false);
    const choosingRef = (0, import_react2.useRef)(false);
    const reload = (0, import_react2.useRef)(async () => {
    });
    (0, import_react2.useEffect)(() => {
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
            setError((current) => current === "catalog.loadError" ? void 0 : current);
          }
          if (choosingRef.current) {
            const selected = await fetch("/api/theone/catalog/sessions", { signal, cache: "no-store" });
            if (!selected.ok) throw new Error("Chat choices unavailable");
            const chats = await selected.json();
            if (!signal.aborted) setChoices(chats);
          }
          const recent = await fetch("/api/theone/routes", { signal, cache: "no-store" }).then((r) => r.ok ? r.json() : void 0).catch(() => void 0);
          if (recent && !signal.aborted) {
            setRoutes(recent.routes);
            setRouteStats(recent.stats);
          }
        } catch {
          if (!signal.aborted) setError("catalog.loadError");
        } finally {
          reading = false;
        }
      }
      reload.current = async () => {
        while (reading) await new Promise((resolve) => setTimeout(resolve, 50));
        await load();
      };
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
        setError("catalog.continueError");
      } finally {
        setBusy(void 0);
      }
    }
    const post = async (path, body) => {
      setBusy(path);
      setError(void 0);
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: lifetime.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          setError(failure.error === "GATEWAY_BUSY" ? "manage.busy" : "manage.error");
          return false;
        }
        const value = await response.json().catch(() => ({}));
        if (body.action === "merge" || body.action === "delete") setManaging(void 0);
        if (body.action === "create" && value.id) {
          setCreating(false);
          setNewTitle("");
          setManaging(value.id);
        }
        await reload.current();
        return true;
      } catch {
        setError("manage.error");
        return false;
      } finally {
        setBusy(void 0);
      }
    };
    async function chooseChats() {
      setBusy("choices");
      setError(void 0);
      try {
        const response = await fetch("/api/theone/catalog/sessions", { signal: lifetime.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Chat choices unavailable");
        setChoices(await response.json());
        choosingRef.current = true;
        setChoosing(true);
      } catch {
        setError("manage.error");
      } finally {
        setBusy(void 0);
      }
    }
    async function consent(value) {
      if (await post("/api/theone/catalog/consent", { consent: value })) {
        setReconsidering(false);
        choosingRef.current = false;
        setChoosing(false);
      }
    }
    function closeChoices() {
      choosingRef.current = false;
      setChoosing(false);
    }
    async function toggleChoice(kind, value, excluded) {
      setError(void 0);
      setChoices((current) => current && {
        folders: current.folders.map((folder) => kind === "folder" && folder.path === value ? { ...folder, excluded } : folder),
        sessions: current.sessions.map((session) => (kind === "session" ? session.id === value : session.folder === value) ? { ...session, excluded } : session)
      });
      try {
        const response = await fetch("/api/theone/catalog/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, value, excluded }),
          signal: lifetime.signal,
          cache: "no-store"
        });
        if (!response.ok) throw new Error("Choice not saved");
        setChoices(await response.json());
        void reload.current();
      } catch {
        setError("manage.error");
        void reload.current();
      }
    }
    function chatPicker() {
      if (!choices) return (0, import_react2.createElement)("p", { className: "theone-picker-hint" }, t2("catalog.pickerLoading"));
      const groups2 = [...choices.folders.map((folder) => ({ ...folder, key: folder.path })), { path: null, name: t2("catalog.otherChats"), excluded: false, key: null }].map((folder) => ({ folder, sessions: choices.sessions.filter((session) => session.folder === folder.key) })).filter((group) => group.sessions.length);
      return (0, import_react2.createElement)(
        "div",
        { className: "theone-picker" },
        (0, import_react2.createElement)("p", { className: "theone-picker-hint" }, t2("catalog.chooseHint")),
        (0, import_react2.createElement)("div", { className: "theone-picker-list" }, ...groups2.map(({ folder, sessions }) => (0, import_react2.createElement)(
          "section",
          { key: folder.path ?? "other", className: "theone-picker-group" },
          (0, import_react2.createElement)(
            "header",
            null,
            (0, import_react2.createElement)("span", { className: "theone-picker-folder", title: folder.path ?? void 0 }, folder.name),
            (0, import_react2.createElement)("span", { className: "theone-picker-count" }, `${sessions.filter((session) => !session.excluded).length}/${sessions.length}`),
            folder.path ? (0, import_react2.createElement)(
              "label",
              { className: "theone-picker-whole" },
              (0, import_react2.createElement)("input", {
                type: "checkbox",
                checked: !folder.excluded,
                onChange: (event) => void toggleChoice("folder", folder.path, !event.target.checked)
              }),
              t2("catalog.wholeFolder")
            ) : null
          ),
          (0, import_react2.createElement)("ul", null, ...sessions.map((session) => {
            const title = session.title || t2("catalog.untitledChat");
            return (0, import_react2.createElement)(
              "li",
              { key: session.id, className: session.excluded ? "theone-picker-off" : void 0 },
              (0, import_react2.createElement)(
                "label",
                null,
                (0, import_react2.createElement)("input", {
                  type: "checkbox",
                  checked: !session.excluded,
                  disabled: folder.excluded,
                  onChange: (event) => void toggleChoice("session", session.id, !event.target.checked)
                }),
                (0, import_react2.createElement)("span", { className: "theone-picker-title", title }, title),
                (0, import_react2.createElement)("time", { dateTime: new Date(session.createdAt).toISOString() }, new Date(session.createdAt).toLocaleDateString(localeSnapshot().active))
              )
            );
          }))
        )))
      );
    }
    async function editLinks(body) {
      setBusy("links");
      setError(void 0);
      try {
        const response = await fetch("/api/theone/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: lifetime.signal,
          cache: "no-store"
        });
        if (!response.ok) throw new Error("Links unavailable");
        const linkage = await response.json();
        setSnapshot((current) => current && { ...current, linkage });
      } catch {
        setError("link.error");
      } finally {
        setBusy(void 0);
      }
    }
    function linkRow(id) {
      const linkage = snapshot?.linkage;
      if (!linkage || linkage.scope === "off") return null;
      const own = linkage.topics[id];
      if (!own) return null;
      if (managing !== id) return own.related.length || own.private ? [
        (0, import_react2.createElement)("dt", { key: "dt" }, label(t2("link.label"))),
        (0, import_react2.createElement)("dd", { key: "dd" }, own.related.map((topic) => topic.title).join(" \xB7 "), own.private ? (0, import_react2.createElement)("span", { className: "theone-tag" }, t2("link.private")) : null)
      ] : null;
      const related = new Set(own.related.map((topic) => topic.id));
      const others = snapshot.contexts.filter((context) => context.id !== id && !related.has(context.id));
      return (0, import_react2.createElement)(
        "div",
        { className: "theone-topic-links" },
        (0, import_react2.createElement)("span", { className: "theone-links-label" }, t2("link.label")),
        own.related.length ? null : (0, import_react2.createElement)("span", { className: "theone-links-empty" }, t2("link.none")),
        ...own.related.map((topic) => (0, import_react2.createElement)(
          "span",
          { key: topic.id, className: "theone-link-chip", title: topic.reasons.map((reason) => t2(`link.reason.${reason}`)).join(" \xB7 ") },
          topic.title,
          (0, import_react2.createElement)("button", {
            type: "button",
            "aria-label": t2("link.remove"),
            title: t2("link.remove"),
            disabled: !!busy,
            onClick: () => {
              void editLinks({ action: "unlink", a: id, b: topic.id });
            }
          }, "\xD7")
        )),
        others.length ? (0, import_react2.createElement)(
          "select",
          {
            "aria-label": t2("link.add"),
            value: "",
            disabled: !!busy,
            onChange: (event) => {
              if (event.target.value) void editLinks({ action: "link", a: id, b: event.target.value });
            }
          },
          (0, import_react2.createElement)("option", { value: "" }, t2("link.add")),
          ...others.map((context) => (0, import_react2.createElement)("option", { key: context.id, value: context.id }, context.title))
        ) : null,
        (0, import_react2.createElement)(
          "label",
          { className: "theone-link-private", title: t2("link.privateHint") },
          (0, import_react2.createElement)("input", {
            type: "checkbox",
            checked: own.private,
            disabled: !!busy,
            onChange: (event) => {
              void editLinks({ action: "private", id, value: event.target.checked });
            }
          }),
          t2("link.private")
        )
      );
    }
    async function refresh() {
      setBusy("refresh");
      setError(void 0);
      try {
        const response = await fetch("/api/theone/catalog/refresh", { method: "POST", signal: lifetime.signal });
        if (!response.ok) throw new Error("Refresh unavailable");
      } catch {
        setError("catalog.refreshError");
      } finally {
        setBusy(void 0);
      }
    }
    const assigned = new Set(snapshot?.groups.flatMap((group) => group.contextIds) ?? []);
    const groups = [...snapshot?.groups ?? [], ...snapshot?.contexts.some((c) => !assigned.has(c.id)) ? [{ id: "pending", title: t2("catalog.unassigned"), summary: t2("catalog.unassignedSummary"), contextIds: snapshot.contexts.filter((c) => !assigned.has(c.id)).map((c) => c.id) }] : []];
    const status = snapshot?.status;
    const asking = status?.consent === "ask" || status?.consent === "declined" && reconsidering;
    const unconsented = status?.consent === "ask" || status?.consent === "declined";
    const total = choices ? choices.sessions.length : (status?.waiting ?? 0) + (status?.excluded ?? 0);
    const included = choices ? choices.sessions.filter((session) => !session.excluded).length : status?.waiting ?? 0;
    const kept = routeStats?.total ? Math.round(100 * (routeStats.total - routeStats.corrected) / routeStats.total) : void 0;
    const figure = (value, name) => (0, import_react2.createElement)("div", { key: name }, (0, import_react2.createElement)("dd", null, value), (0, import_react2.createElement)("dt", null, name));
    return (0, import_react2.createElement)(
      "section",
      { className: "theone-catalog", translate: "no" },
      (0, import_react2.createElement)(
        "header",
        { className: "theone-catalog-header" },
        (0, import_react2.createElement)(
          "div",
          { className: "theone-catalog-heading" },
          (0, import_react2.createElement)("p", { className: "theone-overline" }, "TheOne"),
          (0, import_react2.createElement)("h1", null, t2("catalog.title")),
          (0, import_react2.createElement)("p", { className: "theone-catalog-lede" }, t2("catalog.subtitle"))
        ),
        snapshot ? (0, import_react2.createElement)(
          "dl",
          { className: "theone-figures" },
          figure(snapshot.contexts.length, t2("catalog.figTopics")),
          figure(snapshot.groups.length, t2("catalog.figGroups")),
          kept !== void 0 ? figure(`${kept}%`, t2("catalog.figKept")) : null
        ) : null
      ),
      (0, import_react2.createElement)(
        "div",
        { className: "theone-toolbar" },
        (0, import_react2.createElement)("p", { className: "theone-catalog-status", role: "status" }, snapshot ? unconsented ? "" : status?.running ? t2("catalog.indexing") : status?.pending ? t2("catalog.pending", { count: status.pending, sessionSuffix: status.pending === 1 ? "" : "s" }) : t2("catalog.updated") : t2("catalog.reading")),
        (0, import_react2.createElement)(
          "div",
          { className: "theone-catalog-tools" },
          (0, import_react2.createElement)("button", { type: "button", className: "theone-primary", disabled: !!busy, onClick: () => setCreating((open) => !open) }, t2("manage.create")),
          // Before consent there is no history to refresh, so the button would only confuse.
          unconsented ? null : (0, import_react2.createElement)("button", { type: "button", onClick: refresh, disabled: !!busy || status?.running }, t2("catalog.refresh")),
          status?.consent === "granted" ? (0, import_react2.createElement)("button", {
            type: "button",
            className: "theone-quiet",
            disabled: !!busy,
            "aria-expanded": choosing,
            onClick: () => choosing ? closeChoices() : void chooseChats()
          }, t2("catalog.chooseChats")) : null,
          snapshot?.linkage && snapshot.linkage.scope !== "off" ? (0, import_react2.createElement)("button", {
            type: "button",
            className: "theone-quiet",
            disabled: !!busy,
            title: t2("link.clearLearnedHint"),
            onClick: () => {
              void editLinks({ action: "clearLearned" });
            }
          }, t2("link.clearLearned")) : null,
          (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", onClick: () => openFeedbackDialog() }, t2("feedback.open"))
        )
      ),
      // One card from question to choice: the list opens inside it and the button counts what will be read.
      asking ? (0, import_react2.createElement)(
        "section",
        { className: "theone-consent", "aria-labelledby": "theone-consent-title" },
        (0, import_react2.createElement)("p", { className: "theone-overline" }, t2("catalog.consentOverline")),
        (0, import_react2.createElement)("h2", { id: "theone-consent-title" }, t2("catalog.consentTitle")),
        (0, import_react2.createElement)("p", { className: "theone-consent-body" }, t2("catalog.consentBody", { count: total, sessionSuffix: total === 1 ? "" : "s" })),
        (0, import_react2.createElement)("ul", { className: "theone-consent-points" }, ...["catalog.consentKeep", "catalog.consentQuota", "catalog.consentChoose"].map((key) => (0, import_react2.createElement)("li", { key }, icon("check", 14), (0, import_react2.createElement)("span", null, t2(key))))),
        choosing ? chatPicker() : null,
        (0, import_react2.createElement)(
          "div",
          { className: "theone-consent-actions" },
          (0, import_react2.createElement)(
            "button",
            { type: "button", className: "theone-primary", disabled: !!busy || !included, onClick: () => void consent(true) },
            t2("catalog.startCount", { count: included, sessionSuffix: included === 1 ? "" : "s" })
          ),
          (0, import_react2.createElement)(
            "button",
            { type: "button", disabled: !!busy, "aria-expanded": choosing, onClick: () => choosing ? closeChoices() : void chooseChats() },
            t2(choosing ? "catalog.doneChoosing" : "catalog.chooseFirst")
          ),
          (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", disabled: !!busy, onClick: () => void consent(false) }, t2("catalog.notNow"))
        )
      ) : null,
      status?.consent === "declined" && !reconsidering ? (0, import_react2.createElement)(
        "div",
        { className: "theone-consent-strip" },
        (0, import_react2.createElement)("span", null, t2("catalog.declined")),
        (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", disabled: !!busy, onClick: () => setReconsidering(true) }, t2("catalog.reconsider"))
      ) : null,
      status?.consent === "granted" && choosing ? (0, import_react2.createElement)(
        "section",
        { className: "theone-consent", "aria-labelledby": "theone-choose-title" },
        (0, import_react2.createElement)("h2", { id: "theone-choose-title" }, t2("catalog.chooseChats")),
        chatPicker(),
        (0, import_react2.createElement)(
          "div",
          { className: "theone-consent-actions" },
          (0, import_react2.createElement)("button", { type: "button", onClick: closeChoices }, t2("catalog.doneChoosing"))
        )
      ) : null,
      creating ? (0, import_react2.createElement)(
        "form",
        { className: "theone-manage theone-create", onSubmit: (event) => {
          event.preventDefault();
          void post("/api/theone/topics", { action: "create", title: newTitle });
        } },
        (0, import_react2.createElement)("input", { value: newTitle, maxLength: 80, autoFocus: true, placeholder: t2("manage.title"), disabled: !!busy, onChange: (event) => setNewTitle(event.target.value) }),
        (0, import_react2.createElement)("button", { type: "submit", className: "theone-primary", disabled: !!busy || !newTitle.trim() }, t2("manage.createButton")),
        (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", onClick: () => {
          setCreating(false);
          setNewTitle("");
        } }, t2("manage.cancel"))
      ) : null,
      snapshot?.linkage?.scope === "off" ? (0, import_react2.createElement)("p", { className: "theone-catalog-note" }, t2("link.off")) : null,
      status?.failed ? (0, import_react2.createElement)("p", { className: "theone-catalog-warning" }, t2("catalog.failed", { count: status.failed, sessionSuffix: status.failed === 1 ? "" : "s" })) : null,
      status?.searchUnavailable ? (0, import_react2.createElement)("p", { className: "theone-catalog-warning" }, t2("catalog.searchUnavailable")) : null,
      error ? (0, import_react2.createElement)("p", { role: "alert", className: "theone-catalog-warning" }, t2(error)) : null,
      snapshot ? (0, import_react2.createElement)(RouteList, { routes, stats: routeStats, contexts: snapshot.contexts, post, busy: !!busy }) : null,
      snapshot && !snapshot.contexts.length && !unconsented ? (0, import_react2.createElement)("p", { className: "theone-catalog-empty" }, t2(status?.running ? "catalog.emptyIndexing" : "catalog.empty")) : null,
      // Laid out like DSH's built-in plugins: foldable groups of two-column cards; a card opens to full width.
      (0, import_react2.createElement)("div", { className: "theone-catalog-groups" }, ...groups.map((group) => {
        const shut = folded.has(group.id);
        return (0, import_react2.createElement)(
          "section",
          { key: group.id, className: "theone-topic-group" },
          (0, import_react2.createElement)(
            "div",
            { className: "theone-group-head" },
            (0, import_react2.createElement)(
              "button",
              {
                type: "button",
                className: "theone-group-toggle",
                "aria-expanded": !shut,
                onClick: () => setFolded((current) => {
                  const next = new Set(current);
                  if (!next.delete(group.id)) next.add(group.id);
                  return next;
                })
              },
              icon("chevron", 12),
              (0, import_react2.createElement)("h2", null, group.title),
              (0, import_react2.createElement)("span", { className: "theone-group-count" }, group.contextIds.length)
            )
          ),
          group.summary ? (0, import_react2.createElement)("p", { className: "theone-group-summary" }, group.summary) : null,
          shut ? null : (0, import_react2.createElement)("ol", { className: "theone-topic-list" }, ...group.contextIds.flatMap((id) => {
            const topic = snapshot?.contexts.find((c) => c.id === id);
            if (!topic) return [];
            const constraints = snapshot?.linkage?.topics[id]?.constraints ?? "";
            const open = managing === id;
            return [(0, import_react2.createElement)(
              "li",
              { key: id, "data-open": open, className: `theone-topic-card${open ? " theone-open" : ""}${topic.hidden === "orphaned" || topic.hidden === "excluded" ? " theone-hidden" : ""}` },
              (0, import_react2.createElement)(
                "div",
                { className: "theone-topic-main" },
                (0, import_react2.createElement)(
                  "div",
                  { className: "theone-topic-row" },
                  (0, import_react2.createElement)("h3", { title: topic.title }, topic.title),
                  topic.topicStatus && topic.topicStatus !== "active" ? (0, import_react2.createElement)("span", { className: `theone-tag theone-status-${topic.topicStatus}` }, t2(`topic.status.${topic.topicStatus}`)) : null
                ),
                topic.summary && topic.summary.trim() !== topic.title.trim() ? (0, import_react2.createElement)("p", { className: "theone-topic-summary" }, topic.summary) : null,
                topic.lastState ? (0, import_react2.createElement)("p", { className: "theone-topic-state" }, (0, import_react2.createElement)("span", null, label(t2("topic.state"))), topic.lastState) : null,
                topic.hidden ? (0, import_react2.createElement)("p", { className: "theone-topic-warning" }, t2(topic.hidden === "excluded" ? "topic.hiddenExcluded" : topic.hidden === "archived" ? "topic.hiddenArchived" : "topic.hiddenOrphaned")) : null,
                ...(snapshot?.merges ?? []).filter((merge) => merge.targetId === id).map((merge) => (0, import_react2.createElement)(
                  "p",
                  { key: `merge:${merge.sourceId}`, className: "theone-topic-merged" },
                  t2("topic.mergedFrom", { title: merge.title }),
                  " ",
                  (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", disabled: !!busy, onClick: () => {
                    void post("/api/theone/topics", { action: "unmerge", id: merge.sourceId });
                  } }, t2("topic.unmerge"))
                ))
              ),
              (0, import_react2.createElement)(
                "div",
                { className: "theone-topic-foot" },
                topic.projectInfo ? (0, import_react2.createElement)("code", { className: "theone-topic-chip", title: topic.projectInfo.path }, topic.projectInfo.name) : null,
                (0, import_react2.createElement)(
                  "div",
                  { className: "theone-topic-actions" },
                  (0, import_react2.createElement)("button", { type: "button", className: "theone-quiet", "aria-expanded": open, onClick: () => setManaging((current) => current === id ? void 0 : id) }, t2(open ? "manage.close" : "manage.open")),
                  // A topic whose conversations are gone has nothing left to continue; an archived one does.
                  (0, import_react2.createElement)("button", {
                    type: "button",
                    className: "theone-continue",
                    disabled: !!busy || topic.hidden === "orphaned" || topic.hidden === "excluded",
                    title: topic.hidden === "orphaned" ? t2("topic.continueHidden") : void 0,
                    onClick: () => {
                      void continueTopic(id);
                    }
                  }, t2(busy === id ? "topic.opening" : "topic.continue"), (0, import_react2.createElement)("span", { "aria-hidden": true }, " \u2192"))
                )
              ),
              open ? (0, import_react2.createElement)(
                "div",
                { className: "theone-topic-edit" },
                (0, import_react2.createElement)(
                  "div",
                  { className: "theone-topic-quick" },
                  topic.hidden ? null : (0, import_react2.createElement)(
                    "button",
                    {
                      type: "button",
                      disabled: !!busy,
                      onClick: () => {
                        void post("/api/theone/topics", { action: "status", id, done: topic.topicStatus !== "done" });
                      }
                    },
                    t2(topic.topicStatus === "done" ? "topic.reopen" : "topic.markDone")
                  ),
                  ...(topic.hidden === "orphaned" ? [] : topic.sourceSessionIds).slice(0, 3).map((sessionId, i) => (0, import_react2.createElement)("button", {
                    key: sessionId,
                    type: "button",
                    onClick: () => {
                      ctx.layout.beginNavigation();
                      ctx.uiWorkspace.openSession(sessionId);
                    }
                  }, t2("topic.source") + (topic.sourceSessionIds.length > 1 ? " " + (i + 1) : "")))
                ),
                linkRow(id),
                (0, import_react2.createElement)(TopicManager, { key: `${id}:${topic.title}:${topic.summary}:${constraints}`, topic, constraints, groups: snapshot.groups, contexts: snapshot.contexts, post, busy: !!busy })
              ) : null
            )];
          }))
        );
      }))
    );
  }
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-theone";
    style.textContent = sidebarCss + catalogCss + settingsCss + composerCss;
    document.head.append(style);
    return () => {
      lifetime.abort();
      style.remove();
    };
  });
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-theone-gateway-row";
    let owned = [];
    const onlyOursUnassigned = (ids) => {
      const workspaces = ctx.workspaces.list.getSnapshot();
      const list = ctx.sessions.list.getSnapshot();
      if (workspaces.phase !== "ready") return false;
      const accounted = new Set(workspaces.items.flatMap((workspace) => workspace.sessionIds));
      const archived = new Set(workspaces.archivedSessionIds);
      const stray = list.ids.filter((id) => {
        const row = list.byId[id];
        return row && !accounted.has(id) && !archived.has(id) && row.origin !== "subagent" && !row.blank;
      });
      return stray.length > 0 && stray.every((id) => ids.has(id));
    };
    const update2 = () => {
      const ids = new Set(owned);
      const id = navigation.getSnapshot();
      if (id) ids.add(id);
      const rules = [...ids].map((sessionId) => `[role="treeitem"][data-row-key="${CSS.escape(`session:${sessionId}`)}"]{display:none!important}`);
      if (onlyOursUnassigned(ids)) rules.push('[data-row-key="workspace:"],[data-row-key="overflow:"]{display:none!important}');
      style.textContent = rules.join("\n");
    };
    let timer;
    const readOwned = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void fetch("/api/theone/owned", { signal: lifetime.signal, cache: "no-store" }).then((response) => response.ok ? response.json() : void 0).then((value) => {
          if (value && !lifetime.signal.aborted) {
            owned = value.sessionIds;
            update2();
          }
        }).catch(() => {
        });
      }, 300);
    };
    update2();
    readOwned();
    const unsubscribe = navigation.subscribe(update2);
    let count = ctx.sessions.list.getSnapshot().ids.length;
    const unsubscribeList = ctx.sessions.list.subscribe(() => {
      const next = ctx.sessions.list.getSnapshot().ids.length;
      if (next !== count) {
        count = next;
        readOwned();
      } else update2();
    });
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(update2);
    window.addEventListener("storage", update2);
    document.head.append(style);
    return () => {
      unsubscribe();
      unsubscribeList();
      unsubscribeWorkspaces();
      clearTimeout(timer);
      window.removeEventListener("storage", update2);
      style.remove();
    };
  });
  ctx.effect(() => {
    const list = ctx.sessions.list;
    const original = list.getSnapshot;
    let folder;
    let base, view, viewFolder, viewId;
    list.getSnapshot = function() {
      const snapshot = original.call(this);
      const id = navigation.getSnapshot();
      const row = id ? snapshot.byId[id] : void 0;
      if (!folder || !id || !row || row.cwd === folder) return snapshot;
      if (snapshot !== base || viewFolder !== folder || viewId !== id) {
        base = snapshot;
        viewFolder = folder;
        viewId = id;
        view = { ...snapshot, byId: { ...snapshot.byId, [id]: { ...row, cwd: folder } } };
      }
      return view;
    };
    let timer;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void fetch("/api/theone/gateway", { signal: lifetime.signal, cache: "no-store" }).then((response) => response.ok ? response.json() : void 0).then((value) => {
          if (value && !lifetime.signal.aborted) folder = value.topicFolder ?? void 0;
        }).catch(() => {
        });
      }, 400);
    };
    read();
    const unsubscribe = ctx.sessions.list.subscribe(read);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      list.getSnapshot = original;
    };
  });
  const WorkPanel = createWorkPanel(useText, lifetime.signal, () => ctx.layout.selectPanel(panelId));
  ctx.slots.inject("main", () => [
    ctx.slots.register({ name: "main", key: tasksPanelId }, WorkPanel),
    ctx.slots.register({ name: "main", key: panelId }, GatewayPanel),
    ctx.slots.register({ name: "main", key: catalogPanelId }, CatalogPanel),
    ctx.slots.register({ name: "main", key: settingsPanelId }, SettingsPanel)
  ]);
  ctx.slots.inject("sidebar.panellist", () => [
    ctx.slots.register({ name: "sidebar.panellist", id: tasksPanelId, order: -998, label: () => t("tasks.title") }, ({ size }) => {
      const t2 = useText();
      return (0, import_react2.createElement)("span", { className: "theone-catalog-entry", translate: "no" }, icon("grid", 16), size === 16 ? (0, import_react2.createElement)("span", null, t2("tasks.title")) : null);
    }),
    ctx.slots.register({ name: "sidebar.panellist", id: panelId, order: -1e3, label: () => t("gateway.title") }, SidebarEntry),
    ctx.slots.register({ name: "sidebar.panellist", id: catalogPanelId, order: -999, label: () => t("catalog.title") }, ({ size }) => {
      const t2 = useText();
      return (0, import_react2.createElement)("span", { className: "theone-catalog-entry", translate: "no" }, icon("grid", 16), size === 16 ? (0, import_react2.createElement)("span", null, t2("catalog.title")) : null);
    })
  ]);
}
var sidebarCss = workCss + `
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
.theone-dialog-actions .theone-dialog-primary{border-color:transparent;background:var(--one-accent);color:var(--one-on-accent)}
.theone-dialog-actions .theone-dialog-primary:hover{background:var(--one-accent-hover)}
.theone-dialog-actions button:focus-visible{outline:2px solid var(--one-accent);outline-offset:2px}
.theone-dialog .theone-dialog-body{white-space:pre-wrap;color:var(--dsw-alias-label-primary,#e8e8ea)}
.theone-feedback{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto}
.theone-feedback textarea,.theone-feedback input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:9px;background:transparent;color:inherit;font:inherit;resize:vertical}
.theone-feedback .theone-feedback-check{display:block;margin:0 0 10px;font-size:13px;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-feedback-preview{margin:0 0 10px;font-size:13px}
.theone-feedback-preview summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-feedback-preview pre{max-height:220px;overflow:auto;margin:6px 0 0;padding:8px 10px;border-radius:9px;background:#0000001f;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.theone-notice{display:flex;align-items:center;gap:8px;margin:6px 4px 0;padding:6px 8px 6px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a0a0a6);min-width:0}
.theone-notice-tag{flex:none;display:inline-flex;padding:3px;border-radius:6px;background:var(--one-tint);box-shadow:inset 0 0 0 .5px var(--one-line);color:var(--one-accent)}
.theone-notice-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-notice-text strong{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.theone-notice button{flex:none;display:inline-flex;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:4px;border-radius:6px}
.theone-notice button:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff12)}
.theone-notice-link{color:var(--one-accent)!important}
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
`;
var catalogCss = `
button:has(.theone-catalog-entry)>span:not(:has(.theone-catalog-entry)){display:none}
body{--one-accent:#a75b1e;--one-accent-hover:#8c4a15;--one-on-accent:#fff;--one-tint:#fff5ec;--one-line:#eed3bb;--one-soft:#a75b1e14}
body[data-ds-dark-theme]{--one-accent:#93c8f3;--one-accent-hover:#b6dbf8;--one-on-accent:#0e1a24;--one-tint:#1d2a37;--one-line:#344d64;--one-soft:#93c8f31a}
.theone-catalog{--t-fg:var(--dsw-alias-label-primary,#18181b);--t-muted:var(--dsw-alias-label-secondary,#5c6370);--t-caption:var(--dsw-alias-label-caption,#9aa0aa);--t-rule:var(--dsw-alias-border-l2,#0000001a);--t-line:var(--dsw-alias-border-l3,#0000001f);--t-hover:var(--dsw-alias-interactive-bg-hover,#26314810);--t-base:var(--dsw-alias-bg-base,#fff);--t-accent:var(--one-accent);--t-warn:var(--dsw-alias-state-error-primary,#d9480f);--t-field:var(--t-hover);
  container-type:inline-size;box-sizing:border-box;height:100%;overflow:auto;padding:0 clamp(24px,4vw,48px) 64px;color:var(--t-fg);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:22px}
.theone-catalog>*{max-width:960px;margin-left:auto;margin-right:auto}
.theone-catalog button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--t-line);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;font-weight:400;cursor:pointer;white-space:nowrap}
.theone-catalog button:hover:not(:disabled){background:var(--t-hover)}
.theone-catalog button:disabled{opacity:.4;cursor:not-allowed}
.theone-catalog button:focus-visible{outline:2px solid var(--t-accent);outline-offset:2px}
.theone-catalog .theone-primary{border-color:transparent;background:var(--one-accent);color:var(--one-on-accent)}
.theone-catalog .theone-primary:hover:not(:disabled){background:var(--one-accent-hover)}
.theone-catalog .theone-quiet{border-color:transparent;color:var(--t-muted)}
.theone-catalog .theone-quiet:hover:not(:disabled){color:var(--t-fg)}
.theone-catalog .theone-continue{border-color:transparent;color:var(--t-accent);font-weight:500}
.theone-catalog .theone-continue:hover:not(:disabled){background:var(--one-soft)}
.theone-catalog-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 24px;padding-top:28px}
.theone-catalog-header .theone-overline{display:none}
.theone-overline{margin:0 0 4px;font-size:12px;line-height:18px;font-weight:500;color:var(--t-accent)}
.theone-catalog h1{margin:0;font-size:20px;line-height:28px;font-weight:600}
.theone-catalog-lede{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--t-muted)}
.theone-figures{display:flex;gap:16px;margin:0;padding-top:4px}
.theone-figures>div{display:flex;align-items:baseline;gap:4px}
.theone-figures dd{margin:0;font-size:13px;line-height:20px;font-weight:500;font-variant-numeric:tabular-nums}
.theone-figures dt{font-size:13px;line-height:20px;color:var(--t-muted)}
.theone-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;padding:20px 0 24px}
.theone-catalog-status{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,var(--t-muted))}
.theone-catalog-status:empty{display:none}
.theone-catalog-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}
.theone-catalog .theone-catalog-tools .theone-primary{border-color:var(--t-line);background:transparent;color:inherit}
.theone-catalog .theone-catalog-tools .theone-primary:hover:not(:disabled){background:var(--t-hover)}
.theone-catalog-note,.theone-catalog-empty{margin:0 0 24px;color:var(--t-muted);font-size:13px;line-height:20px}
.theone-catalog-empty{padding:40px 0;text-align:center}
.theone-consent{box-sizing:border-box;margin:0 auto 32px;padding:20px 24px;border:1px solid var(--one-line);border-radius:var(--dsw-radius-lg,16px);background:var(--one-tint)}
.theone-consent .theone-overline{display:flex;align-items:center;gap:6px}
.theone-consent .theone-overline::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.theone-consent h2{margin:0;font-size:16px;line-height:24px;font-weight:600}
.theone-consent-body{margin:6px 0 0;max-width:640px;font-size:14px;line-height:22px}
.theone-consent-points{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:4px;font-size:13px;line-height:20px;color:var(--t-muted)}
.theone-consent-points li{display:flex;gap:8px;align-items:flex-start}
.theone-consent-points .theone-icon{flex:none;margin-top:3px;color:var(--t-accent)}
.theone-consent-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:20px}
.theone-catalog .theone-consent-actions button{height:32px;padding:0 14px;font-size:13px}
.theone-catalog .theone-consent-actions button:not(.theone-primary):not(.theone-quiet){background:var(--t-base)}
.theone-consent-strip{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:0 auto 32px;padding:8px 8px 8px 16px;border:1px solid var(--one-line);border-radius:var(--dsw-radius-md,12px);font-size:13px;line-height:20px;color:var(--t-muted)}
.theone-consent-strip>span{display:flex;align-items:center;gap:8px}
.theone-consent-strip>span::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--t-accent)}
.theone-catalog .theone-consent-strip button{margin-left:auto;color:var(--t-accent)}
.theone-picker{margin-top:16px}
.theone-picker-hint{margin:0 0 8px;font-size:13px;line-height:20px;color:var(--t-muted)}
.theone-picker-list{max-height:min(400px,55vh);overflow:auto;border:.5px solid var(--t-line);border-radius:var(--dsw-radius-md,12px);background:var(--t-base)}
.theone-picker-group+.theone-picker-group{border-top:.5px solid var(--t-line)}
.theone-picker-group>header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 16px;border-bottom:.5px solid var(--t-rule);background:var(--t-base);font-size:12px;line-height:18px}
.theone-picker-folder{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.theone-picker-count{color:var(--t-caption);font-variant-numeric:tabular-nums}
.theone-picker-whole{margin-left:auto;display:flex;align-items:center;gap:6px;color:var(--t-muted);white-space:nowrap;cursor:pointer}
.theone-picker-group ul{list-style:none;margin:0;padding:4px}
.theone-picker-group li label{display:flex;align-items:center;gap:10px;height:36px;padding:0 12px;border-radius:var(--dsw-radius-sm,8px);font-size:13px;cursor:pointer}
.theone-picker-group li label:hover{background:var(--t-hover)}
.theone-picker input,.theone-catalog input[type=checkbox]{flex:none;width:14px;height:14px;margin:0;accent-color:var(--one-accent);cursor:pointer}
.theone-picker input:disabled{cursor:not-allowed}
.theone-picker-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-picker-off .theone-picker-title{color:var(--t-caption)}
.theone-picker time{color:var(--t-caption);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
@container (max-width:560px){.theone-consent{padding:16px}.theone-picker time{display:none}}
.theone-catalog-warning{box-sizing:border-box;margin:0 auto 24px;padding:10px 16px;border:.5px solid color-mix(in srgb,var(--t-warn) 40%,transparent);border-radius:var(--dsw-radius-md,12px);background:color-mix(in srgb,var(--t-warn) 6%,transparent);font-size:13px;line-height:20px}
.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}
.theone-routes{box-sizing:border-box;margin:0 auto 32px;padding:0 16px;border:.5px solid var(--t-line);border-radius:var(--dsw-radius-md,12px)}
.theone-routes summary{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-height:44px;cursor:pointer;font-size:14px;line-height:22px;font-weight:500;list-style:none}
.theone-routes summary::-webkit-details-marker{display:none}
.theone-routes summary::before{content:'';width:6px;height:6px;margin:0 4px 0 2px;border-right:1.5px solid var(--t-muted);border-bottom:1.5px solid var(--t-muted);transform:rotate(-45deg);transition:transform 150ms ease}
.theone-routes[open] summary::before{transform:rotate(45deg) translate(-2px,-1px)}
.theone-routes summary>span{color:var(--t-caption);font-weight:400}
.theone-route-stats{font-weight:400;color:var(--t-caption);font-size:13px}
.theone-routes .theone-manage-hint{margin:0 0 8px 20px;max-width:46em}
.theone-routes ol{list-style:none;margin:0;padding:0 0 8px}
.theone-routes li{display:grid;grid-template-columns:48px minmax(0,1fr) minmax(0,1fr) 248px;gap:4px 16px;align-items:center;min-height:44px;padding:6px 0;border-top:.5px solid var(--t-rule);font-size:13px;line-height:20px}
.theone-routes time{color:var(--t-caption);font-variant-numeric:tabular-nums}
.theone-routes q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;quotes:none}
.theone-route-target{display:flex;flex-direction:column;min-width:0}
.theone-route-target strong{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-route-target small{color:var(--t-caption);font-size:12px;line-height:18px}
.theone-route-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.theone-route-fixed{color:var(--t-caption);font-size:12px}
.theone-routes select{width:auto;width:132px;height:28px;min-height:28px;padding-top:0;padding-bottom:0;font-size:12px}
.theone-catalog-groups{display:flex;flex-direction:column;gap:14px}
.theone-topic-group{display:flex;flex-direction:column;gap:10px}
.theone-topic-group+.theone-topic-group{padding-top:14px;border-top:.5px solid var(--t-rule)}
.theone-group-head{display:flex;align-items:center;min-height:36px}
.theone-catalog .theone-group-toggle{height:auto;gap:8px;padding:0;border:0;background:none;font-size:14px;line-height:22px}
.theone-catalog .theone-group-toggle:hover:not(:disabled){background:none}
.theone-group-toggle .theone-icon{color:var(--t-caption);transform:rotate(90deg);transition:transform 150ms ease}
.theone-group-toggle[aria-expanded=true] .theone-icon{transform:rotate(180deg)}
.theone-topic-group h2{margin:0;font-size:14px;line-height:22px;font-weight:400}
.theone-group-count{color:var(--t-caption);font-variant-numeric:tabular-nums}
.theone-group-summary{margin:-6px 0 0 20px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,var(--t-muted))}
.theone-topic-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.theone-topic-card{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4,#00000029));border-radius:var(--dsw-radius-xl,20px);background:var(--dsw-alias-settings-card-fill,var(--t-base))}
.theone-topic-card[data-open=true]{grid-column:1/-1;border-color:var(--t-line)}
.theone-topic-main{display:flex;flex-direction:column;gap:2px;padding:12px 14px 0}
.theone-topic-card.theone-hidden .theone-topic-main{opacity:.55}
.theone-topic-row{display:flex;align-items:center;gap:12px;min-width:0}
.theone-topic-card h3{flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:500}
.theone-topic-summary{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,var(--t-muted));display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-wrap:pretty}
.theone-topic-card[data-open=true] .theone-topic-summary{display:block}
.theone-topic-state{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--t-muted);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.theone-topic-state>span{margin-right:6px;color:var(--t-caption)}
.theone-topic-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding:8px 8px 10px 14px}
.theone-topic-chip{min-width:0;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-module-platform,#f2f3f5);color:var(--t-muted);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:18px}
.theone-tag{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#f2f3f5);font-size:10px;line-height:1;font-weight:400;color:var(--t-muted)}
.theone-status-waiting{color:var(--t-warn);background:color-mix(in srgb,var(--t-warn) 10%,transparent)}
.theone-status-done{color:var(--t-accent);background:var(--one-soft)}
.theone-topic-warning{margin:6px 0 0;padding-left:8px;border-left:2px solid var(--t-warn);font-size:12px;line-height:18px;color:var(--t-muted)}
.theone-topic-merged{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--t-muted)}
.theone-catalog .theone-topic-merged .theone-quiet{height:22px;padding:0 6px;color:var(--t-accent)}
.theone-topic-actions{display:flex;align-items:center;gap:2px;margin-left:auto}
.theone-catalog .theone-topic-actions button{height:26px}
.theone-topic-edit{display:flex;flex-direction:column;gap:14px;margin:2px 14px 14px;padding-top:14px;border-top:.5px solid var(--t-rule)}
.theone-topic-quick{display:flex;flex-wrap:wrap;gap:8px}
.theone-topic-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 16px;font-size:13px}
.theone-links-label,.theone-links-empty{color:var(--t-muted)}
.theone-link-chip{display:inline-flex;align-items:center;gap:2px;height:24px;padding:0 2px 0 10px;border:.5px solid var(--t-line);border-radius:999px;font-size:12px}
.theone-catalog .theone-link-chip button{height:20px;border:0;padding:0 6px;font-size:14px;line-height:1;color:var(--t-muted);border-radius:999px}
.theone-link-private{display:inline-flex;align-items:center;gap:6px;color:var(--t-muted);cursor:pointer}
.theone-catalog input:not([type=checkbox]),.theone-catalog textarea,.theone-catalog select{box-sizing:border-box;min-width:0;min-height:32px;padding:5px 10px;border:.5px solid var(--t-line);border-radius:var(--dsw-radius-sm,8px);background:var(--t-base);color:inherit;font:inherit;font-size:13px;line-height:20px}
.theone-catalog input:not([type=checkbox]):focus,.theone-catalog textarea:focus,.theone-catalog select:focus{outline:none;border-color:var(--t-accent);box-shadow:0 0 0 3px var(--one-soft)}
.theone-manage{display:flex;flex-direction:column;gap:14px;font-size:13px}
.theone-create{box-sizing:border-box;flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;margin:0 auto 32px;padding:12px;border:.5px solid var(--t-line);border-radius:var(--dsw-radius-md,12px)}
.theone-create input{flex:1;min-width:200px}
.theone-manage-field{display:flex;flex-direction:column;gap:6px}
.theone-manage-field>span{font-size:12px;line-height:18px;color:var(--t-muted)}
.theone-manage textarea{resize:vertical;width:100%}
.theone-manage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.theone-manage-row select,.theone-manage-row input{flex:1;min-width:160px}
.theone-manage-hint{margin:0;font-size:12px;line-height:18px;color:var(--t-muted)}
.theone-catalog .theone-danger{color:var(--t-warn);border-color:color-mix(in srgb,var(--t-warn) 40%,transparent)}
@container (max-width:640px){.theone-catalog-tools{margin-left:0}.theone-topic-list{grid-template-columns:1fr}.theone-routes li{grid-template-columns:40px minmax(0,1fr)}.theone-route-target,.theone-route-actions{grid-column:2}.theone-route-actions{justify-content:flex-start}}
@media(max-width:640px){.theone-catalog{padding:0 16px 48px}}
`;
var composerCss = `
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
`;
var settingsCss = `
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
`;
return module.exports;}});
