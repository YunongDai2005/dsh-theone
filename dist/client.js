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

// src/settings-types.ts
var EDITABLE_SETTINGS_KEYS = [
  "workerProvider",
  "workerModel",
  "routerMode",
  "routerTransport",
  "historyCatalog",
  "catalogIntervalMs",
  "maxDescriptorChars",
  "maxResponseChars",
  "routerBaseUrl",
  "routerModel",
  "routerApiKeyEnv"
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
      id = this.uuid();
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
  "gateway.title": "TheOne \xB7 \u4E3B\u804A\u5929",
  "gateway.label": "\u4E3B\u804A\u5929",
  "gateway.subtitle": "\u4ECE\u8FD9\u91CC\u7EE7\u7EED\u804A",
  "gateway.opening": "\u6B63\u5728\u6253\u5F00 TheOne \u4E3B\u804A\u5929\u2026",
  "gateway.error": "\u4E3B\u804A\u5929\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u548C TheOne \u63D2\u4EF6\u72B6\u6001\u3002",
  "retry": "\u91CD\u8BD5",
  "settings.title": "TheOne \u8BBE\u7F6E",
  "settings.menu": "\u8BBE\u7F6E",
  "settings.subtitle": "\u67E5\u770B\u5F53\u524D\u751F\u6548\u7684\u914D\u7F6E\u548C\u5404\u9879\u7528\u9014\u3002",
  "settings.readOnly": "\u4FEE\u6539\u540E\u70B9\u51FB\u4FDD\u5B58\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002\u6570\u636E\u5E93\u4F4D\u7F6E\u3001\u76EE\u5F55\u6587\u4EF6\u548C\u5165\u53E3\u6807\u8BC6\u6682\u65F6\u53EA\u8BFB\u3002",
  "settings.save": "\u4FDD\u5B58\u8BBE\u7F6E",
  "settings.saving": "\u6B63\u5728\u4FDD\u5B58\u2026",
  "settings.saved": "\u5DF2\u4FDD\u5B58\u3002",
  "settings.restart": "\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548\u3002",
  "settings.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539",
  "settings.reset": "\u64A4\u9500\u4FEE\u6539",
  "settings.saveError": "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165\u548C DSH \u8FDE\u63A5\u540E\u91CD\u8BD5\u3002",
  "settings.conflict": "\u914D\u7F6E\u5DF2\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u4FDD\u5B58\u3002",
  "settings.keyMissing": "\u6307\u5B9A\u7684 API Key \u73AF\u5883\u53D8\u91CF\u5C1A\u672A\u8BBE\u7F6E\u3002\u8BF7\u5148\u914D\u7F6E\u5B83\uFF0C\u6216\u7EE7\u7EED\u590D\u7528 DSH \u914D\u7F6E\u3002",
  "settings.reload": "\u91CD\u65B0\u8BFB\u53D6\u914D\u7F6E",
  "settings.llm": "LLM \u667A\u80FD\u5224\u65AD",
  "settings.rules": "\u89C4\u5219\u5224\u65AD",
  "settings.dsh": "\u590D\u7528 DSH \u914D\u7F6E",
  "settings.legacyCall": "\u76F4\u63A5 API \u8C03\u7528",
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
  "settings.storage": "\u6570\u636E\u4E0E\u5165\u53E3",
  "settings.legacy": "\u65E7\u7248\u76F4\u63A5 API \u8C03\u7528",
  "settings.legacyHint": "\u4EE5\u4E0B\u9009\u9879\u4EC5\u5728\u8DEF\u7531\u65B9\u5F0F\u4E3A legacy \u65F6\u751F\u6548\u3002DSH \u8DEF\u7531\u65E0\u9700\u989D\u5916 API Key\u3002",
  "settings.workerProvider": "\u56FA\u5B9A\u6A21\u578B\u670D\u52A1\u5546",
  "settings.workerModel": "\u56FA\u5B9A\u6A21\u578B\u540D\u79F0",
  "settings.routerMode": "\u8DEF\u7531\u5224\u65AD\u65B9\u5F0F",
  "settings.routerTransport": "\u6A21\u578B\u8C03\u7528\u65B9\u5F0F",
  "settings.historyCatalog": "\u81EA\u52A8\u6574\u7406\u5386\u53F2",
  "settings.catalogIntervalMs": "\u5386\u53F2\u8865\u626B\u95F4\u9694",
  "settings.maxDescriptorChars": "\u8BDD\u9898\u6458\u8981\u957F\u5EA6\u4E0A\u9650",
  "settings.maxResponseChars": "\u5355\u6B21\u56DE\u590D\u957F\u5EA6\u4E0A\u9650",
  "settings.databasePath": "\u8BDD\u9898\u76EE\u5F55\u6570\u636E\u5E93\u4F4D\u7F6E",
  "settings.contextsPath": "\u4EBA\u5DE5\u8BDD\u9898\u76EE\u5F55\u6587\u4EF6",
  "settings.gatewayKey": "\u4E3B\u5165\u53E3\u6807\u8BC6",
  "settings.routerBaseUrl": "API \u670D\u52A1\u5730\u5740",
  "settings.routerModel": "\u8DEF\u7531\u6A21\u578B\u540D\u79F0",
  "settings.routerApiKeyEnv": "API Key \u73AF\u5883\u53D8\u91CF\u540D\u79F0",
  "settings.help.workerProvider": "\u4E0E\u6A21\u578B\u540D\u79F0\u4E00\u8D77\u586B\u5199\u53EF\u56FA\u5B9A\u6A21\u578B\uFF1B\u7559\u7A7A\u65F6\u8DDF\u968F DSH \u9009\u62E9\u3002",
  "settings.help.workerModel": "\u56FA\u5B9A\u8DEF\u7531\u3001\u5DE5\u4F5C\u4F1A\u8BDD\u53CA\u5165\u53E3\u5BB9\u91CF\u6240\u4F7F\u7528\u7684\u6A21\u578B\u3002",
  "settings.help.routerMode": "llm \u4F7F\u7528\u6A21\u578B\u5224\u65AD\u8BDD\u9898\uFF1Brules \u4F7F\u7528\u89C4\u5219\u5224\u65AD\u3002",
  "settings.help.routerTransport": "dsh \u590D\u7528 DSH \u5DF2\u914D\u7F6E\u7684\u6A21\u578B\u548C\u51ED\u636E\uFF1Blegacy \u76F4\u63A5\u8C03\u7528 API\u3002",
  "settings.help.historyCatalog": "\u4ECE\u5DF2\u6709\u4F1A\u8BDD\u63D0\u53D6\u8BDD\u9898\u76EE\u5F55\uFF0C\u5E76\u81EA\u52A8\u5206\u7EC4\u3002\u5173\u95ED\u540E\u5DF2\u6709\u76EE\u5F55\u4ECD\u4FDD\u7559\u3002",
  "settings.help.catalogIntervalMs": "\u5B9A\u671F\u68C0\u67E5\u5386\u53F2\u53D8\u5316\u7684\u95F4\u9694\uFF0C\u6700\u5C11 10 \u79D2\u3002",
  "settings.help.maxDescriptorChars": "\u6302\u8F7D\u5230\u5DE5\u4F5C\u4F1A\u8BDD\u7684\u8BDD\u9898\u8BF4\u660E\u5B57\u7B26\u4E0A\u9650\uFF0C\u6700\u5C11 128\u3002",
  "settings.help.maxResponseChars": "\u5165\u53E3\u8F6C\u53D1\u4E00\u6B21\u56DE\u590D\u7684\u5B57\u7B26\u4E0A\u9650\uFF0C\u6700\u5C11 128\u3002",
  "settings.help.databasePath": "\u4FDD\u5B58\u76EE\u5F55\u3001\u5206\u7EC4\u4E0E\u4F7F\u7528\u8BB0\u5F55\uFF1B\u539F\u59CB\u804A\u5929\u7531 DSH \u4FDD\u5B58\u3002",
  "settings.help.contextsPath": "\u53EF\u9009 JSON \u6587\u4EF6\uFF0C\u7528\u4E8E\u5BFC\u5165\u4EBA\u5DE5\u51C6\u5907\u7684\u8BDD\u9898\u76EE\u5F55\u3002",
  "settings.help.gatewayKey": "\u533A\u5206\u5165\u53E3\u72B6\u6001\uFF0C\u901A\u5E38\u4FDD\u7559 default\u3002",
  "settings.help.routerBaseUrl": "\u76F4\u63A5\u8C03\u7528\u6A21\u5F0F\u7684 API \u5730\u5740\uFF1B\u4E0D\u5C55\u793A\u8BA4\u8BC1\u4FE1\u606F\u6216\u67E5\u8BE2\u53C2\u6570\u3002",
  "settings.help.routerModel": "\u76F4\u63A5\u8C03\u7528\u6A21\u5F0F\u4F7F\u7528\u7684\u6A21\u578B\uFF0C\u4E0D\u5F71\u54CD DSH \u8C03\u7528\u6A21\u5F0F\u3002",
  "settings.help.routerApiKeyEnv": "\u53EA\u586B\u5199\u53D8\u91CF\u540D\u79F0\uFF0C\u5BC6\u94A5\u7531\u8FD0\u884C\u73AF\u5883\u7BA1\u7406\uFF0C\u4E0D\u5728\u754C\u9762\u663E\u793A\u3002",
  "catalog.title": "\u8BDD\u9898\u5DE5\u4F5C\u533A",
  "catalog.subtitle": "\u76F8\u5173\u7684\u4E8B\u60C5\u653E\u5728\u4E00\u8D77\uFF0C\u968F\u65F6\u56DE\u5230\u4E3B\u804A\u5929\u7EE7\u7EED\u3002",
  "catalog.refresh": "\u6574\u7406\u5386\u53F2",
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
  "catalog.emptyIndexing": "\u6B63\u5728\u4ECE\u4EE5\u524D\u7684\u804A\u5929\u4E2D\u6574\u7406\u8BDD\u9898\u3002\u4F60\u4E5F\u53EF\u4EE5\u5148\u56DE\u5230\u4E3B\u804A\u5929\u3002",
  "catalog.empty": "\u76EE\u524D\u8FD8\u6CA1\u6709\u6574\u7406\u51FA\u8BDD\u9898\u3002\u5F00\u59CB\u804A\u5929\u540E\uFF0C\u5B83\u4EEC\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  "catalog.unassigned": "\u5F85\u6574\u7406",
  "catalog.unassignedSummary": "\u8FD9\u4E9B\u8BDD\u9898\u8FD8\u5728\u7B49\u5F85\u81EA\u52A8\u5F52\u7C7B\u3002",
  "topic.opening": "\u6B63\u5728\u6253\u5F00\u2026",
  "topic.continue": "\u7EE7\u7EED\u804A\u5929",
  "topic.source": "\u67E5\u770B\u539F\u4F1A\u8BDD"
};
var en = {
  "gateway.title": "TheOne \xB7 Main chat",
  "gateway.label": "Main chat",
  "gateway.subtitle": "Pick up the conversation",
  "gateway.opening": "Opening TheOne main chat\u2026",
  "gateway.error": "Main chat could not open. Check your DSH connection and TheOne plugin status.",
  "retry": "Retry",
  "settings.title": "TheOne settings",
  "settings.menu": "Settings",
  "settings.subtitle": "Review active configuration and what each option does.",
  "settings.readOnly": "Save changes, then restart DSH to apply them. Database location, catalog file and entry identifier are currently read-only.",
  "settings.save": "Save settings",
  "settings.saving": "Saving\u2026",
  "settings.saved": "Saved.",
  "settings.restart": "Saved. Restart DSH to apply changes.",
  "settings.unsaved": "Unsaved changes",
  "settings.reset": "Discard changes",
  "settings.saveError": "Settings could not save. Check the inputs and DSH connection, then retry.",
  "settings.conflict": "Another page changed these settings. Reload before saving.",
  "settings.keyMissing": "The API key environment variable is not set. Configure it first or keep using DSH configuration.",
  "settings.reload": "Reload settings",
  "settings.llm": "LLM decision",
  "settings.rules": "Rule-based decision",
  "settings.dsh": "Use DSH configuration",
  "settings.legacyCall": "Direct API calls",
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
  "settings.storage": "Data and entry",
  "settings.legacy": "Legacy direct API calls",
  "settings.legacyHint": "These options apply only to legacy routing. DSH routing needs no additional API key.",
  "settings.workerProvider": "Fixed model provider",
  "settings.workerModel": "Fixed model name",
  "settings.routerMode": "Routing decision method",
  "settings.routerTransport": "Model call method",
  "settings.historyCatalog": "Organize history automatically",
  "settings.catalogIntervalMs": "History scan interval",
  "settings.maxDescriptorChars": "Topic descriptor character limit",
  "settings.maxResponseChars": "Reply character limit",
  "settings.databasePath": "Topic database location",
  "settings.contextsPath": "Manual topic catalog file",
  "settings.gatewayKey": "Main entry identifier",
  "settings.routerBaseUrl": "API base URL",
  "settings.routerModel": "Routing model name",
  "settings.routerApiKeyEnv": "API key environment variable name",
  "settings.help.workerProvider": "Set together with the model name to pin a model; leave unset to follow DSH.",
  "settings.help.workerModel": "Pin the model used for routing, workers and entry capacity.",
  "settings.help.routerMode": "llm uses the model to choose topics; rules uses rule-based decisions.",
  "settings.help.routerTransport": "dsh reuses configured DSH models and credentials; legacy calls the API directly.",
  "settings.help.historyCatalog": "Extract and group topics from existing sessions. Turning this off keeps the current catalog.",
  "settings.help.catalogIntervalMs": "Time between checks for history changes; minimum 10 seconds.",
  "settings.help.maxDescriptorChars": "Maximum characters in the topic descriptor mounted in a worker; minimum 128.",
  "settings.help.maxResponseChars": "Maximum characters forwarded for one reply; minimum 128.",
  "settings.help.databasePath": "Stores catalog, groups and usage; DSH stores original chats.",
  "settings.help.contextsPath": "Optional JSON file for importing manually prepared topic descriptors.",
  "settings.help.gatewayKey": "Separates entry state; normally keep default.",
  "settings.help.routerBaseUrl": "Base URL for direct calls; authentication and query parameters are omitted.",
  "settings.help.routerModel": "Model used for direct calls; does not affect DSH calls.",
  "settings.help.routerApiKeyEnv": "Enter the variable name only. The runtime manages the secret; it is never displayed here.",
  "catalog.title": "Topic workspaces",
  "catalog.subtitle": "Keep related topics together and pick up the conversation in main chat.",
  "catalog.refresh": "Organize history",
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
  "catalog.emptyIndexing": "Organizing topics from your earlier chats. You can return to main chat while this runs.",
  "catalog.empty": "No topics yet. They\u2019ll appear here as you chat.",
  "catalog.unassigned": "To organize",
  "catalog.unassignedSummary": "These topics are waiting to be grouped.",
  "topic.opening": "Opening\u2026",
  "topic.continue": "Continue chatting",
  "topic.source": "View original chat"
};

// src/client.ts
var inject = ["slots", "locale", "sessions", "workspaces", "layout", "uiWorkspace", "modelDirectories", "remote.session"];
var panelId = "theone-gateway";
var catalogPanelId = "theone-catalog";
var settingsPanelId = "theone-settings";
function apply(ctx) {
  const lifetime = new AbortController();
  ctx.effect(() => ctx.locale.register("theone", { zh, en }));
  const t = ctx.locale.bind("theone");
  const subscribeLocale = ctx.locale.subscribe.bind(ctx.locale);
  const localeSnapshot = ctx.locale.getSnapshot.bind(ctx.locale);
  function useText() {
    (0, import_react.useSyncExternalStore)(subscribeLocale, localeSnapshot);
    return t;
  }
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
        const renamed = await reference.binding.session.rename(t("gateway.title"));
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
  function SidebarEntry({ size }) {
    const t2 = useText();
    const marker = (0, import_react.useRef)(null);
    const id = (0, import_react.useSyncExternalStore)(navigation.subscribe, navigation.getSnapshot);
    const sessions = (0, import_react.useSyncExternalStore)(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot);
    const panel = (0, import_react.useSyncExternalStore)(ctx.layout.panelInfo.subscribe, ctx.layout.panelInfo.getSnapshot);
    const active = panel.activePanelId === panelId || panel.activePanelId === null && !!id && !!sessions.byId[id]?.retainedBy.mainView;
    (0, import_react.useEffect)(() => {
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
    (0, import_react.useEffect)(() => {
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
    return (0, import_react.createElement)(
      "span",
      { ref: marker, className: "theone-nav", translate: "no", "data-wide": size === 16, "data-active": active },
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
          (0, import_react.createElement)("span", { className: "theone-entry-label" }, t2("gateway.label"))
        ),
        (0, import_react.createElement)("span", { className: "theone-entry-sub" }, t2("gateway.subtitle"))
      )
    );
  }
  function GatewayPanel() {
    const t2 = useText();
    const [error, setError] = (0, import_react.useState)();
    const [attempt, setAttempt] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => {
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
    return (0, import_react.createElement)(
      "section",
      { className: "theone-opening", "aria-live": "polite" },
      (0, import_react.createElement)("p", null, t2(error ?? "gateway.opening")),
      error && (0, import_react.createElement)("button", { type: "button", onClick: () => setAttempt((value) => value + 1) }, t2("retry"))
    );
  }
  function SettingsPanel() {
    const t2 = useText();
    const heading = (0, import_react.useRef)(null);
    const [snapshot, setSnapshot] = (0, import_react.useState)();
    const [draft, setDraft] = (0, import_react.useState)();
    const [saving, setSaving] = (0, import_react.useState)(false);
    const [message, setMessage] = (0, import_react.useState)();
    const saveRequest = (0, import_react.useRef)();
    (0, import_react.useEffect)(() => () => saveRequest.current?.abort(), []);
    const [error, setError] = (0, import_react.useState)(false);
    const [attempt, setAttempt] = (0, import_react.useState)(0);
    (0, import_react.useEffect)(() => {
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
      ["models", ["workerProvider", "workerModel", "routerMode", "routerTransport"]],
      ["history", ["historyCatalog", "catalogIntervalMs"]],
      ["limits", ["maxDescriptorChars", "maxResponseChars"]],
      ["storage", ["databasePath", "contextsPath", "gatewayKey"]],
      ["legacy", ["routerBaseUrl", "routerModel", "routerApiKeyEnv"]]
    ];
    const display = (key) => {
      const value = snapshot.values[key];
      if (value === null) return t2(key === "workerProvider" || key === "workerModel" ? "settings.follow" : "settings.none");
      if (typeof value === "boolean") return t2(value ? "settings.on" : "settings.off");
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
          if (!signal.aborted) setMessage(response.status === 409 ? "settings.conflict" : failure.error === "LEGACY_KEY_MISSING" ? "settings.keyMissing" : "settings.saveError");
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
      const select = (value, choices, selectValue) => (0, import_react.createElement)(
        "select",
        { ...props, value, required: field === "workerModel" && !!draft.workerProvider, onChange: (event) => selectValue(event.target.value) },
        ...choices.map((choice) => (0, import_react.createElement)("option", { key: choice.value, value: choice.value }, choice.label))
      );
      if (field === "historyCatalog") return select(String(draft.historyCatalog), [{ value: "true", label: t2("settings.on") }, { value: "false", label: t2("settings.off") }], (v) => change(field, v === "true"));
      if (field === "routerMode" || field === "routerTransport") {
        const values = field === "routerMode" ? ["llm", "rules"] : ["dsh", "legacy"];
        return select(draft[field], values.map((value) => ({ value, label: t2(`settings.${value === "legacy" ? "legacyCall" : value}`) })), (v) => change(field, v));
      }
      if (field === "workerProvider") {
        const providers = [...new Set([snapshot.model?.provider, snapshot.values.workerProvider, snapshot.savedValues.workerProvider].filter((value) => !!value && value !== "theone"))];
        return select(draft.workerProvider ?? "", [{ value: "", label: t2("settings.follow") }, ...providers.map((value) => ({ value, label: value }))], (v) => {
          const model = v === snapshot.model?.provider ? snapshot.model.model : v === snapshot.savedValues.workerProvider ? snapshot.savedValues.workerModel : snapshot.values.workerModel;
          setDraft((current) => current && { ...current, workerProvider: v || null, workerModel: v ? model ?? null : null });
          setMessage(void 0);
        });
      }
      if (field === "workerModel") {
        const models = [...new Set([draft.workerModel, draft.workerProvider === snapshot.model?.provider ? snapshot.model?.model : null].filter((value) => !!value))];
        return select(draft.workerModel ?? "", [{ value: "", label: t2(draft.workerProvider ? "settings.none" : "settings.follow") }, ...models.map((value) => ({ value, label: value }))], (v) => change(field, v || null));
      }
      if (field === "catalogIntervalMs" || field === "maxDescriptorChars" || field === "maxResponseChars") {
        const interval = field === "catalogIntervalMs";
        return (0, import_react.createElement)("input", {
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
      return (0, import_react.createElement)("input", {
        ...props,
        type: field === "routerBaseUrl" ? "url" : "text",
        value: draft[field] ?? "",
        required: true,
        maxLength: field === "routerBaseUrl" ? 2048 : field === "routerApiKeyEnv" ? 128 : 256,
        onChange: (event) => change(field, event.target.value)
      });
    };
    return (0, import_react.createElement)(
      "section",
      { className: "theone-settings", translate: "no" },
      (0, import_react.createElement)(
        "header",
        { className: "theone-settings-header" },
        (0, import_react.createElement)("div", null, (0, import_react.createElement)("h1", { ref: heading, tabIndex: -1 }, t2("settings.title")), (0, import_react.createElement)("p", null, t2("settings.subtitle"))),
        (0, import_react.createElement)("button", { type: "button", disabled: saving, onClick: () => ctx.layout.selectPanel(panelId) }, t2("settings.back"))
      ),
      (0, import_react.createElement)("p", { className: "theone-settings-notice" }, t2("settings.readOnly")),
      !snapshot && !error ? (0, import_react.createElement)("p", { role: "status" }, t2("settings.loading")) : null,
      error ? (0, import_react.createElement)("p", { role: "alert" }, t2("settings.error"), " ", (0, import_react.createElement)("button", { type: "button", onClick: () => setAttempt((n) => n + 1) }, t2("retry"))) : null,
      snapshot && draft && (0, import_react.createElement)(
        "form",
        { onSubmit: (event) => {
          event.preventDefault();
          void save();
        } },
        (0, import_react.createElement)(
          "section",
          { className: "theone-settings-summary" },
          (0, import_react.createElement)(
            "dl",
            null,
            (0, import_react.createElement)("div", null, (0, import_react.createElement)("dt", null, t2("settings.model")), (0, import_react.createElement)("dd", null, snapshot.model ? `${snapshot.model.provider} / ${snapshot.model.model}` : t2("settings.none"))),
            (0, import_react.createElement)("div", null, (0, import_react.createElement)("dt", null, t2("settings.capacity")), (0, import_react.createElement)("dd", null, snapshot.model?.contextWindow?.toLocaleString(localeSnapshot().active) ?? t2("settings.none"))),
            (0, import_react.createElement)("div", null, (0, import_react.createElement)("dt", null, t2("settings.output")), (0, import_react.createElement)("dd", null, snapshot.model?.defaultMaxTokens?.toLocaleString(localeSnapshot().active) ?? t2("settings.none")))
          ),
          snapshot.modelUnavailable ? (0, import_react.createElement)("p", { role: "status" }, t2("settings.modelUnavailable")) : null,
          (0, import_react.createElement)("p", null, t2("settings.inherited")),
          (0, import_react.createElement)("p", null, t2("settings.compression"))
        ),
        ...groups.map(([group, keys]) => (0, import_react.createElement)(
          "section",
          { className: "theone-settings-group", key: group },
          (0, import_react.createElement)("h2", null, t2(`settings.${group}`)),
          group === "legacy" ? (0, import_react.createElement)("p", { className: "theone-settings-help" }, t2("settings.legacyHint")) : null,
          (0, import_react.createElement)("dl", null, ...keys.map((key) => (0, import_react.createElement)(
            "div",
            { className: "theone-settings-row", key, "data-inactive": group === "legacy" && (draft.routerTransport !== "legacy" || draft.routerMode !== "llm") },
            (0, import_react.createElement)("dt", null, (0, import_react.createElement)("strong", null, t2(`settings.${key}`)), (0, import_react.createElement)("p", null, t2(`settings.help.${key}`)), (0, import_react.createElement)("code", null, key)),
            (0, import_react.createElement)("dd", null, control(key), key === "catalogIntervalMs" && Number.isFinite(draft.catalogIntervalMs) ? (0, import_react.createElement)("small", null, t2("settings.seconds", { count: draft.catalogIntervalMs / 1e3 })) : null)
          )))
        )),
        (0, import_react.createElement)(
          "footer",
          { className: "theone-settings-footer" },
          (0, import_react.createElement)(
            "p",
            { role: message === "settings.saveError" || message === "settings.conflict" || message === "settings.keyMissing" ? "alert" : "status" },
            message ? t2(message) : dirty ? t2("settings.unsaved") : snapshot.restartRequired ? t2("settings.restart") : ""
          ),
          message === "settings.conflict" ? (0, import_react.createElement)("button", { type: "button", onClick: () => setAttempt((n) => n + 1) }, t2("settings.reload")) : null,
          (0, import_react.createElement)("button", { type: "button", disabled: saving || !dirty, onClick: () => {
            setDraft(snapshot.savedValues);
            setMessage(void 0);
          } }, t2("settings.reset")),
          (0, import_react.createElement)("button", { type: "submit", disabled: saving || !dirty, className: "theone-settings-save" }, t2(saving ? "settings.saving" : "settings.save"))
        )
      )
    );
  }
  function CatalogPanel() {
    const t2 = useText();
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
          if (!signal.aborted) setError("catalog.loadError");
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
        setError("catalog.continueError");
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
        setError("catalog.refreshError");
      } finally {
        setBusy(void 0);
      }
    }
    const assigned = new Set(snapshot?.groups.flatMap((group) => group.contextIds) ?? []);
    const groups = [...snapshot?.groups ?? [], ...snapshot?.contexts.some((c) => !assigned.has(c.id)) ? [{ id: "pending", title: t2("catalog.unassigned"), summary: t2("catalog.unassignedSummary"), contextIds: snapshot.contexts.filter((c) => !assigned.has(c.id)).map((c) => c.id) }] : []];
    const status = snapshot?.status;
    return (0, import_react.createElement)(
      "section",
      { className: "theone-catalog", translate: "no" },
      (0, import_react.createElement)(
        "header",
        { className: "theone-catalog-header" },
        (0, import_react.createElement)("div", null, (0, import_react.createElement)("h1", null, t2("catalog.title")), (0, import_react.createElement)("p", null, t2("catalog.subtitle"))),
        (0, import_react.createElement)("button", { type: "button", onClick: refresh, disabled: !!busy || status?.running }, t2("catalog.refresh"))
      ),
      (0, import_react.createElement)("p", { className: "theone-catalog-status", role: "status" }, snapshot ? t2("catalog.counts", { topics: snapshot.contexts.length, groups: snapshot.groups.length, topicSuffix: snapshot.contexts.length === 1 ? "" : "s", groupSuffix: snapshot.groups.length === 1 ? "" : "s" }) + " \xB7 " + (status?.running ? t2("catalog.indexing") : status?.pending ? t2("catalog.pending", { count: status.pending, sessionSuffix: status.pending === 1 ? "" : "s" }) : t2("catalog.updated")) : t2("catalog.reading")),
      status?.failed ? (0, import_react.createElement)("p", { className: "theone-catalog-warning" }, t2("catalog.failed", { count: status.failed, sessionSuffix: status.failed === 1 ? "" : "s" })) : null,
      status?.searchUnavailable ? (0, import_react.createElement)("p", { className: "theone-catalog-warning" }, t2("catalog.searchUnavailable")) : null,
      error ? (0, import_react.createElement)("p", { role: "alert", className: "theone-catalog-warning" }, t2(error)) : null,
      snapshot && !snapshot.contexts.length ? (0, import_react.createElement)("p", { className: "theone-catalog-empty" }, t2(status?.running ? "catalog.emptyIndexing" : "catalog.empty")) : null,
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
              } }, t2(busy === id ? "topic.opening" : "topic.continue")),
              ...topic.sourceSessionIds.slice(0, 3).map((sessionId, i) => (0, import_react.createElement)("button", {
                key: sessionId,
                type: "button",
                className: "theone-source-link",
                onClick: () => {
                  ctx.layout.beginNavigation();
                  ctx.uiWorkspace.openSession(sessionId);
                }
              }, t2("topic.source") + (topic.sourceSessionIds.length > 1 ? " " + (i + 1) : "")))
            )
          )];
        })
      )))
    );
  }
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-theone";
    style.textContent = sidebarCss + catalogCss + settingsCss;
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
    ctx.slots.register({ name: "main", key: catalogPanelId }, CatalogPanel),
    ctx.slots.register({ name: "main", key: settingsPanelId }, SettingsPanel)
  ]);
  ctx.slots.inject("sidebar.panellist", () => [
    ctx.slots.register({ name: "sidebar.panellist", id: panelId, order: -1e3, label: () => t("gateway.title") }, SidebarEntry),
    ctx.slots.register({ name: "sidebar.panellist", id: catalogPanelId, order: -999, label: () => t("catalog.title") }, ({ size }) => {
      const t2 = useText();
      return (0, import_react.createElement)("span", { className: "theone-catalog-entry", translate: "no" }, (0, import_react.createElement)("span", null, "\u25A6"), size === 16 ? (0, import_react.createElement)("span", null, t2("catalog.title")) : null);
    })
  ]);
}
var sidebarCss = `
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
.theone-settings-summary,.theone-settings-group{border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:22px;margin-bottom:20px}.theone-settings-summary{background:#88804}.theone-settings-summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.theone-settings dl{margin:0}.theone-settings-summary dt{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}.theone-settings dd{margin:0;overflow-wrap:anywhere;line-height:1.6}.theone-settings-summary dd{font-size:15px}.theone-settings-summary p{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:16px 0 0}
.theone-settings-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,42%);gap:24px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}.theone-settings-row:first-child{border-top:0;padding-top:0}.theone-settings-row:last-child{padding-bottom:0}.theone-settings-row strong{font-size:14px;font-weight:500}.theone-settings-row p{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:6px 0}.theone-settings-row code{font-size:11px;color:var(--dsw-alias-label-secondary)}.theone-settings-row dd{font-size:13px;padding-top:1px}.theone-settings-row[data-inactive=true]{opacity:.6}
@media(max-width:640px){.theone-settings{padding:20px 16px}.theone-settings-header{flex-wrap:wrap}.theone-settings-summary,.theone-settings-group{padding:18px}.theone-settings-summary dl{grid-template-columns:1fr}.theone-settings-row{grid-template-columns:1fr;gap:10px}}
`;
return module.exports;}});
