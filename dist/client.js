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
  "historyCatalog",
  "catalogIntervalMs",
  "maxDescriptorChars",
  "maxResponseChars",
  "linkScope",
  "routeNotice",
  "contextsPath"
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
  "catalog.emptyIndexing": "\u6B63\u5728\u4ECE\u4EE5\u524D\u7684\u804A\u5929\u4E2D\u6574\u7406\u8BDD\u9898\u3002\u4F60\u4E5F\u53EF\u4EE5\u5148\u56DE\u5230\u4E3B\u804A\u5929\u3002",
  "catalog.empty": "\u76EE\u524D\u8FD8\u6CA1\u6709\u6574\u7406\u51FA\u8BDD\u9898\u3002\u5F00\u59CB\u804A\u5929\u540E\uFF0C\u5B83\u4EEC\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  "catalog.unassigned": "\u5F85\u6574\u7406",
  "catalog.unassignedSummary": "\u8FD9\u4E9B\u8BDD\u9898\u8FD8\u5728\u7B49\u5F85\u81EA\u52A8\u5F52\u7C7B\u3002",
  "topic.opening": "\u6B63\u5728\u6253\u5F00\u2026",
  "topic.continue": "\u7EE7\u7EED\u804A\u5929",
  "topic.source": "\u67E5\u770B\u539F\u4F1A\u8BDD",
  "topic.state": "\u8FDB\u5C55\uFF1A",
  "topic.constraints": "\u7EA6\u675F\uFF1A",
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
  "manage.mergeHint": "\u8FD9\u4E2A\u8BDD\u9898\u7684\u5386\u53F2\u3001\u8FDB\u5C55\u3001\u7EA6\u675F\u548C\u5173\u8054\u4F1A\u5E76\u5165\u76EE\u6807\u8BDD\u9898\uFF0C\u7136\u540E\u79FB\u9664\u8FD9\u4E2A\u8BDD\u9898\u3002\u539F\u4F1A\u8BDD\u4ECD\u4FDD\u7559\u5728 DSH\u3002",
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
  "routes.empty": "\u8FD8\u6CA1\u6709\u5206\u914D\u8BB0\u5F55\u3002",
  "routes.move": "\u6539\u5230\u2026",
  "routes.corrected": "\u5DF2\u6539\u5230 {title}",
  "routes.clarify": "? \u8FFD\u95EE",
  "routes.error": "\u5206\u7C7B\u51FA\u9519\uFF1A{code}",
  "routes.rules": "\u89C4\u5219\u5224\u65AD",
  "routes.removed": "\uFF08\u5DF2\u5220\u9664\u7684\u8BDD\u9898\uFF09",
  "route.reason.steering": "\u56DE\u590D\u4E2D\u8865\u5145",
  "route.reason.short-continuation": "\u63A5\u7740\u8BF4",
  "route.reason.attachment-only": "\u53EA\u6709\u9644\u4EF6",
  "route.reason.correction": "\u6309\u4F60\u7684\u66F4\u6B63",
  "route.reason.correction-unclear": "\u66F4\u6B63\u65F6\u6CA1\u8BF4\u6E05\u76EE\u6807",
  "route.reason.explicit-new-topic": "\u660E\u786E\u7684\u65B0\u8BDD\u9898",
  "route.reason.no-history-evidence": "\u65B0\u7684\u95EE\u9898",
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
  "gateway.title": "TheOne \xB7 Main chat",
  "gateway.label": "Main chat",
  "gateway.subtitle": "Pick up the conversation",
  "gateway.opening": "Opening TheOne main chat\u2026",
  "gateway.error": "Main chat could not open. Check your DSH connection and TheOne plugin status.",
  "retry": "Retry",
  "settings.title": "TheOne settings",
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
  "catalog.emptyIndexing": "Organizing topics from your earlier chats. You can return to main chat while this runs.",
  "catalog.empty": "No topics yet. They\u2019ll appear here as you chat.",
  "catalog.unassigned": "To organize",
  "catalog.unassignedSummary": "These topics are waiting to be grouped.",
  "topic.opening": "Opening\u2026",
  "topic.continue": "Continue chatting",
  "topic.source": "View original chat",
  "topic.state": "Progress:",
  "topic.constraints": "Constraints:",
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
  "manage.mergeHint": "This topic's history, progress, constraints and links move into the target topic, then this topic is removed. DSH keeps the original sessions.",
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
  "routes.empty": "No routing records yet.",
  "routes.move": "Move to\u2026",
  "routes.corrected": "Moved to {title}",
  "routes.clarify": "? Asked",
  "routes.error": "Classifier error: {code}",
  "routes.rules": "rules",
  "routes.removed": "(deleted topic)",
  "route.reason.steering": "Added during a reply",
  "route.reason.short-continuation": "Continuation",
  "route.reason.attachment-only": "Attachment only",
  "route.reason.correction": "Your correction",
  "route.reason.correction-unclear": "Correction without a target",
  "route.reason.explicit-new-topic": "Explicit new topic",
  "route.reason.no-history-evidence": "New question",
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
      ["models", ["workerProvider", "workerModel", "routerMode"]],
      ["history", ["historyCatalog", "catalogIntervalMs"]],
      ["linkage", ["linkScope", "routeNotice"]],
      ["limits", ["maxDescriptorChars", "maxResponseChars"]],
      ["storage", ["contextsPath", "databasePath", "gatewayKey"]]
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
      const select = (value, choices, selectValue) => (0, import_react.createElement)(
        "select",
        { ...props, value, required: field === "workerModel" && !!draft.workerProvider, onChange: (event) => selectValue(event.target.value) },
        ...choices.map((choice) => (0, import_react.createElement)("option", { key: choice.value, value: choice.value }, choice.label))
      );
      if (field === "historyCatalog") return select(String(draft.historyCatalog), [{ value: "true", label: t2("settings.on") }, { value: "false", label: t2("settings.off") }], (v) => change(field, v === "true"));
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
        type: "text",
        value: draft.contextsPath ?? "",
        maxLength: 4096,
        placeholder: t2("settings.none"),
        onChange: (event) => change("contextsPath", event.target.value.trim() ? event.target.value : null)
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
          (0, import_react.createElement)("dl", null, ...keys.map((key) => (0, import_react.createElement)(
            "div",
            { className: "theone-settings-row", key },
            (0, import_react.createElement)("dt", null, (0, import_react.createElement)("strong", null, t2(`settings.${key}`)), (0, import_react.createElement)("p", null, t2(`settings.help.${key}`)), (0, import_react.createElement)("code", null, key)),
            (0, import_react.createElement)("dd", null, control(key), key === "catalogIntervalMs" && Number.isFinite(draft.catalogIntervalMs) ? (0, import_react.createElement)("small", null, t2("settings.seconds", { count: draft.catalogIntervalMs / 1e3 })) : null)
          )))
        )),
        (0, import_react.createElement)(
          "footer",
          { className: "theone-settings-footer" },
          (0, import_react.createElement)(
            "p",
            { role: message === "settings.saveError" || message === "settings.conflict" || message === "settings.contextsUnreadable" ? "alert" : "status" },
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
  const ROUTE_REASONS = /* @__PURE__ */ new Set([
    "steering",
    "short-continuation",
    "attachment-only",
    "correction",
    "correction-unclear",
    "explicit-new-topic",
    "no-history-evidence",
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
  const routeReason = (reason) => ROUTE_REASONS.has(reason) ? t(`route.reason.${reason}`) : reason.startsWith("router-fallback:") ? t("route.reason.router-fallback") : reason;
  function TopicManager({ topic, constraints, groups, contexts, post, busy }) {
    const t2 = useText();
    const [title, setTitle] = (0, import_react.useState)(topic.title);
    const [summary, setSummary] = (0, import_react.useState)(topic.summary);
    const [rules, setRules] = (0, import_react.useState)(constraints);
    const groupOf = groups.find((group2) => group2.contextIds.includes(topic.id))?.id ?? "";
    const [group, setGroup] = (0, import_react.useState)(groupOf);
    const [groupTitle, setGroupTitle] = (0, import_react.useState)("");
    const [into, setInto] = (0, import_react.useState)("");
    const [confirm, setConfirm] = (0, import_react.useState)();
    const [sessions, setSessions] = (0, import_react.useState)();
    const [session, setSession] = (0, import_react.useState)("");
    (0, import_react.useEffect)(() => {
      const controller = new AbortController();
      fetch("/api/theone/sessions", { signal: AbortSignal.any([controller.signal, lifetime.signal]), cache: "no-store" }).then((response) => response.ok ? response.json() : { sessions: [] }).then((value) => setSessions(value.sessions)).catch(() => {
        if (!controller.signal.aborted) setSessions([]);
      });
      return () => controller.abort();
    }, []);
    const own = new Set(topic.sourceSessionIds);
    const edited = title.trim() !== topic.title || summary.trim() !== topic.summary || rules.trim() !== constraints;
    const field = (label, control) => (0, import_react.createElement)("label", { className: "theone-manage-field" }, (0, import_react.createElement)("span", null, t2(label)), control);
    return (0, import_react.createElement)(
      "div",
      { className: "theone-manage" },
      field("manage.title", (0, import_react.createElement)("input", { value: title, maxLength: 80, disabled: busy, onChange: (event) => setTitle(event.target.value) })),
      field("manage.summary", (0, import_react.createElement)("textarea", { value: summary, rows: 3, maxLength: 2e3, disabled: busy, onChange: (event) => setSummary(event.target.value) })),
      field("manage.constraintsLabel", (0, import_react.createElement)("textarea", { value: rules, rows: 2, maxLength: 400, disabled: busy, placeholder: t2("manage.constraintsPlaceholder"), onChange: (event) => setRules(event.target.value) })),
      (0, import_react.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react.createElement)("button", {
          type: "button",
          disabled: busy || !edited || !title.trim() || !summary.trim(),
          onClick: () => {
            void post("/api/theone/topics", { action: "edit", id: topic.id, title, summary, constraints: rules });
          }
        }, t2("manage.save"))
      ),
      field("manage.workspace", (0, import_react.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react.createElement)(
          "select",
          { value: group, disabled: busy, onChange: (event) => setGroup(event.target.value) },
          (0, import_react.createElement)("option", { value: "" }, t2("manage.unassigned")),
          ...groups.map((item) => (0, import_react.createElement)("option", { key: item.id, value: item.id }, item.title)),
          (0, import_react.createElement)("option", { value: "__new" }, t2("manage.newWorkspace"))
        ),
        group === "__new" ? (0, import_react.createElement)("input", { value: groupTitle, maxLength: 80, placeholder: t2("manage.newWorkspaceName"), disabled: busy, onChange: (event) => setGroupTitle(event.target.value) }) : null,
        (0, import_react.createElement)("button", {
          type: "button",
          disabled: busy || group === groupOf || group === "__new" && !groupTitle.trim(),
          onClick: () => {
            void post("/api/theone/topics", { action: "move", id: topic.id, ...group === "__new" ? { groupTitle } : group ? { groupId: group } : {} });
          }
        }, t2("manage.move"))
      )),
      field("manage.attach", (0, import_react.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react.createElement)(
          "select",
          { value: session, disabled: busy || !sessions, onChange: (event) => setSession(event.target.value) },
          (0, import_react.createElement)("option", { value: "" }, sessions ? t2("manage.attachPick") : t2("manage.loadingSessions")),
          ...(sessions ?? []).filter((item) => !own.has(item.id)).map((item) => (0, import_react.createElement)("option", { key: item.id, value: item.id }, item.title))
        ),
        (0, import_react.createElement)("button", { type: "button", disabled: busy || !session, onClick: () => {
          void post("/api/theone/topics", { action: "attach", id: topic.id, sessionId: session }).then((ok) => {
            if (ok) setSession("");
          });
        } }, t2("manage.attachButton"))
      )),
      (0, import_react.createElement)("p", { className: "theone-manage-hint" }, t2("manage.attachHint")),
      field("manage.merge", (0, import_react.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react.createElement)(
          "select",
          { value: into, disabled: busy, onChange: (event) => {
            setInto(event.target.value);
            setConfirm(void 0);
          } },
          (0, import_react.createElement)("option", { value: "" }, t2("manage.mergePick")),
          ...contexts.filter((item) => item.id !== topic.id).map((item) => (0, import_react.createElement)("option", { key: item.id, value: item.id }, item.title))
        ),
        (0, import_react.createElement)(
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
      (0, import_react.createElement)("p", { className: "theone-manage-hint" }, t2("manage.mergeHint")),
      (0, import_react.createElement)(
        "div",
        { className: "theone-manage-row" },
        (0, import_react.createElement)(
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
        confirm === "delete" ? (0, import_react.createElement)("span", { className: "theone-manage-hint" }, t2("manage.deleteHint")) : null
      )
    );
  }
  function RouteList({ routes, contexts, post, busy }) {
    const t2 = useText();
    const titleOf = (id) => contexts.find((context) => context.id === id)?.title ?? t2("routes.removed");
    return (0, import_react.createElement)(
      "details",
      { className: "theone-routes" },
      (0, import_react.createElement)("summary", null, t2("routes.title"), (0, import_react.createElement)("span", null, ` ${routes.length}`)),
      (0, import_react.createElement)("p", { className: "theone-manage-hint" }, t2("routes.hint")),
      routes.length ? (0, import_react.createElement)("ol", null, ...routes.map((route) => {
        const target = route.decision.contextId;
        const receipt = route.receipt;
        const details = [
          routeReason(route.decision.reason),
          receipt?.mode === "llm" ? receipt.model : receipt ? t2("routes.rules") : void 0,
          receipt?.elapsedMs !== void 0 ? `${(receipt.elapsedMs / 1e3).toFixed(1)} s` : void 0,
          receipt?.errorCode ? t2("routes.error", { code: receipt.errorCode }) : void 0
        ].filter(Boolean).join(" \xB7 ");
        return (0, import_react.createElement)(
          "li",
          { key: route.messageId },
          (0, import_react.createElement)(
            "div",
            { className: "theone-route-head" },
            (0, import_react.createElement)("time", null, new Date(route.at).toLocaleTimeString(localeSnapshot().active, { hour: "2-digit", minute: "2-digit" })),
            (0, import_react.createElement)("q", null, route.excerpt || "\u2026")
          ),
          (0, import_react.createElement)(
            "div",
            { className: "theone-route-body" },
            (0, import_react.createElement)("strong", null, route.decision.action === "CLARIFY" ? t2("routes.clarify") : `\u2192 ${titleOf(target)}`),
            (0, import_react.createElement)("small", null, details),
            route.correctedTo ? (0, import_react.createElement)("span", { className: "theone-route-fixed" }, t2("routes.corrected", { title: titleOf(route.correctedTo) })) : (0, import_react.createElement)(
              "select",
              {
                value: "",
                disabled: busy,
                "aria-label": t2("routes.move"),
                onChange: (event) => {
                  if (event.target.value) void post("/api/theone/routes", { messageId: route.messageId, contextId: event.target.value });
                }
              },
              (0, import_react.createElement)("option", { value: "" }, t2("routes.move")),
              ...contexts.filter((context) => context.id !== target).map((context) => (0, import_react.createElement)("option", { key: context.id, value: context.id }, context.title))
            )
          )
        );
      })) : (0, import_react.createElement)("p", { className: "theone-links-empty" }, t2("routes.empty"))
    );
  }
  function CatalogPanel() {
    const t2 = useText();
    const [snapshot, setSnapshot] = (0, import_react.useState)();
    const [error, setError] = (0, import_react.useState)();
    const [busy, setBusy] = (0, import_react.useState)();
    const [routes, setRoutes] = (0, import_react.useState)([]);
    const [managing, setManaging] = (0, import_react.useState)();
    const [creating, setCreating] = (0, import_react.useState)(false);
    const [newTitle, setNewTitle] = (0, import_react.useState)("");
    const reload = (0, import_react.useRef)(async () => {
    });
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
            setError((current) => current === "catalog.loadError" ? void 0 : current);
          }
          const recent = await fetch("/api/theone/routes", { signal, cache: "no-store" }).then((r) => r.ok ? r.json() : void 0).catch(() => void 0);
          if (recent && !signal.aborted) setRoutes(recent.routes);
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
      const related = new Set(own.related.map((topic) => topic.id));
      const others = snapshot.contexts.filter((context) => context.id !== id && !related.has(context.id));
      return (0, import_react.createElement)(
        "div",
        { className: "theone-topic-links" },
        (0, import_react.createElement)("span", { className: "theone-links-label" }, t2("link.label")),
        own.related.length ? null : (0, import_react.createElement)("span", { className: "theone-links-empty" }, t2("link.none")),
        ...own.related.map((topic) => (0, import_react.createElement)(
          "span",
          { key: topic.id, className: "theone-link-chip", title: topic.reasons.map((reason) => t2(`link.reason.${reason}`)).join(" \xB7 ") },
          topic.title,
          (0, import_react.createElement)("button", {
            type: "button",
            "aria-label": t2("link.remove"),
            title: t2("link.remove"),
            disabled: !!busy,
            onClick: () => {
              void editLinks({ action: "unlink", a: id, b: topic.id });
            }
          }, "\xD7")
        )),
        others.length ? (0, import_react.createElement)(
          "select",
          {
            "aria-label": t2("link.add"),
            value: "",
            disabled: !!busy,
            onChange: (event) => {
              if (event.target.value) void editLinks({ action: "link", a: id, b: event.target.value });
            }
          },
          (0, import_react.createElement)("option", { value: "" }, t2("link.add")),
          ...others.map((context) => (0, import_react.createElement)("option", { key: context.id, value: context.id }, context.title))
        ) : null,
        (0, import_react.createElement)(
          "label",
          { className: "theone-link-private", title: t2("link.privateHint") },
          (0, import_react.createElement)("input", {
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
    return (0, import_react.createElement)(
      "section",
      { className: "theone-catalog", translate: "no" },
      (0, import_react.createElement)(
        "header",
        { className: "theone-catalog-header" },
        (0, import_react.createElement)("div", null, (0, import_react.createElement)("h1", null, t2("catalog.title")), (0, import_react.createElement)("p", null, t2("catalog.subtitle"))),
        (0, import_react.createElement)(
          "div",
          { className: "theone-catalog-tools" },
          (0, import_react.createElement)("button", { type: "button", disabled: !!busy, onClick: () => setCreating((open) => !open) }, t2("manage.create")),
          snapshot?.linkage && snapshot.linkage.scope !== "off" ? (0, import_react.createElement)("button", {
            type: "button",
            disabled: !!busy,
            title: t2("link.clearLearnedHint"),
            onClick: () => {
              void editLinks({ action: "clearLearned" });
            }
          }, t2("link.clearLearned")) : null,
          (0, import_react.createElement)("button", { type: "button", onClick: refresh, disabled: !!busy || status?.running }, t2("catalog.refresh"))
        )
      ),
      creating ? (0, import_react.createElement)(
        "form",
        { className: "theone-manage theone-create", onSubmit: (event) => {
          event.preventDefault();
          void post("/api/theone/topics", { action: "create", title: newTitle });
        } },
        (0, import_react.createElement)("input", { value: newTitle, maxLength: 80, autoFocus: true, placeholder: t2("manage.title"), disabled: !!busy, onChange: (event) => setNewTitle(event.target.value) }),
        (0, import_react.createElement)("button", { type: "submit", disabled: !!busy || !newTitle.trim() }, t2("manage.createButton")),
        (0, import_react.createElement)("button", { type: "button", onClick: () => {
          setCreating(false);
          setNewTitle("");
        } }, t2("manage.cancel"))
      ) : null,
      snapshot?.linkage?.scope === "off" ? (0, import_react.createElement)("p", { className: "theone-catalog-status" }, t2("link.off")) : null,
      (0, import_react.createElement)("p", { className: "theone-catalog-status", role: "status" }, snapshot ? t2("catalog.counts", { topics: snapshot.contexts.length, groups: snapshot.groups.length, topicSuffix: snapshot.contexts.length === 1 ? "" : "s", groupSuffix: snapshot.groups.length === 1 ? "" : "s" }) + " \xB7 " + (status?.running ? t2("catalog.indexing") : status?.pending ? t2("catalog.pending", { count: status.pending, sessionSuffix: status.pending === 1 ? "" : "s" }) : t2("catalog.updated")) : t2("catalog.reading")),
      status?.failed ? (0, import_react.createElement)("p", { className: "theone-catalog-warning" }, t2("catalog.failed", { count: status.failed, sessionSuffix: status.failed === 1 ? "" : "s" })) : null,
      status?.searchUnavailable ? (0, import_react.createElement)("p", { className: "theone-catalog-warning" }, t2("catalog.searchUnavailable")) : null,
      error ? (0, import_react.createElement)("p", { role: "alert", className: "theone-catalog-warning" }, t2(error)) : null,
      snapshot ? (0, import_react.createElement)(RouteList, { routes, contexts: snapshot.contexts, post, busy: !!busy }) : null,
      snapshot && !snapshot.contexts.length ? (0, import_react.createElement)("p", { className: "theone-catalog-empty" }, t2(status?.running ? "catalog.emptyIndexing" : "catalog.empty")) : null,
      (0, import_react.createElement)("div", { className: "theone-catalog-groups" }, ...groups.map((group) => (0, import_react.createElement)(
        "section",
        { key: group.id, className: "theone-topic-group" },
        (0, import_react.createElement)("h2", null, group.title, (0, import_react.createElement)("span", null, ` ${group.contextIds.length}`)),
        group.summary ? (0, import_react.createElement)("p", { className: "theone-group-summary" }, group.summary) : null,
        ...group.contextIds.flatMap((id) => {
          const topic = snapshot?.contexts.find((c) => c.id === id);
          if (!topic) return [];
          const constraints = snapshot?.linkage?.topics[id]?.constraints ?? "";
          return [(0, import_react.createElement)(
            "article",
            { key: id, className: "theone-topic-card" },
            (0, import_react.createElement)("h3", null, topic.title),
            (0, import_react.createElement)("p", null, topic.summary),
            topic.lastState ? (0, import_react.createElement)("p", { className: "theone-topic-state" }, (0, import_react.createElement)("span", null, t2("topic.state")), topic.lastState) : null,
            constraints ? (0, import_react.createElement)("p", { className: "theone-topic-state" }, (0, import_react.createElement)("span", null, t2("topic.constraints")), constraints) : null,
            linkRow(id),
            (0, import_react.createElement)(
              "div",
              { className: "theone-topic-actions" },
              (0, import_react.createElement)("button", { type: "button", disabled: !!busy, onClick: () => {
                void continueTopic(id);
              } }, t2(busy === id ? "topic.opening" : "topic.continue")),
              (0, import_react.createElement)("button", { type: "button", "aria-expanded": managing === id, onClick: () => setManaging((current) => current === id ? void 0 : id) }, t2(managing === id ? "manage.close" : "manage.open")),
              ...topic.sourceSessionIds.slice(0, 3).map((sessionId, i) => (0, import_react.createElement)("button", {
                key: sessionId,
                type: "button",
                className: "theone-source-link",
                onClick: () => {
                  ctx.layout.beginNavigation();
                  ctx.uiWorkspace.openSession(sessionId);
                }
              }, t2("topic.source") + (topic.sourceSessionIds.length > 1 ? " " + (i + 1) : "")))
            ),
            managing === id ? (0, import_react.createElement)(TopicManager, { key: `${id}:${topic.title}:${topic.summary}:${constraints}`, topic, constraints, groups: snapshot.groups, contexts: snapshot.contexts, post, busy: !!busy }) : null
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
.theone-catalog-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.theone-catalog h1{font-size:24px;margin:0 0 8px}.theone-catalog-header p,.theone-catalog-status,.theone-group-summary{opacity:.65;margin:0 0 18px;line-height:1.6}.theone-catalog button{border:1px solid #8883;border-radius:9px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer;font:inherit;white-space:nowrap}.theone-catalog button:disabled{opacity:.5;cursor:default}.theone-catalog-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:20px}.theone-topic-group{border:1px solid #8882;border-radius:16px;padding:20px;background:#88805}.theone-topic-group h2{font-size:18px;margin:0 0 8px}.theone-topic-group h2 span{font-size:13px;opacity:.5}.theone-topic-card{border-top:1px solid #8882;padding:16px 0}.theone-topic-card:last-child{padding-bottom:0}.theone-topic-card h3{font-size:15px;line-height:1.5;margin:0 0 7px}.theone-topic-card p{font-size:13px;line-height:1.7;opacity:.75;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.theone-topic-actions{display:flex;gap:8px;flex-wrap:wrap}.theone-topic-actions button{font-size:12px}.theone-topic-actions .theone-source-link{border-color:transparent;opacity:.6}.theone-catalog-warning{background:#ff900011;padding:12px;border-radius:10px;font-size:13px}.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}.theone-catalog-empty{padding:40px 0;opacity:.65;line-height:1.8}.theone-catalog-tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.theone-topic-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 12px;font-size:12px}.theone-links-label,.theone-links-empty{opacity:.6}.theone-link-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid #8883;border-radius:999px;padding:2px 4px 2px 9px}.theone-catalog .theone-link-chip button{border:0;padding:0 5px;opacity:.6;font-size:13px;line-height:1}.theone-topic-links select{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid #8883;border-radius:8px;padding:2px 6px}.theone-link-private{display:inline-flex;align-items:center;gap:4px;opacity:.75;cursor:pointer}.theone-topic-card .theone-topic-state{font-size:12px;opacity:.8;-webkit-line-clamp:3}.theone-topic-state span{opacity:.6;margin-right:4px}.theone-manage{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding:14px;border:1px solid #8883;border-radius:12px;font-size:12px}.theone-create{flex-direction:row;flex-wrap:wrap;align-items:center;margin:0 0 18px}.theone-create input{flex:1;min-width:180px}.theone-manage-field{display:flex;flex-direction:column;gap:5px}.theone-manage-field>span{opacity:.65}.theone-manage input,.theone-manage textarea,.theone-manage select,.theone-routes select{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid #8883;border-radius:8px;padding:6px 8px;box-sizing:border-box;min-width:0}.theone-manage textarea{resize:vertical;width:100%}.theone-manage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.theone-manage-row select,.theone-manage-row input{flex:1;min-width:140px}.theone-manage-hint{opacity:.6;font-size:12px;line-height:1.6;margin:0}.theone-catalog .theone-danger{color:#c4402f;border-color:#c4402f55}.theone-routes{border:1px solid #8882;border-radius:16px;padding:14px 20px;margin:0 0 20px}.theone-routes summary{cursor:pointer;font-weight:500}.theone-routes summary span{opacity:.5;font-size:13px}.theone-routes ol{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}.theone-routes li{border-top:1px solid #8882;padding-top:10px;font-size:12px;display:flex;flex-direction:column;gap:5px}.theone-route-head{display:flex;gap:10px;min-width:0}.theone-route-head time{opacity:.55;flex:none}.theone-route-head q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.theone-route-body{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.theone-route-body small{opacity:.6}.theone-route-fixed{opacity:.75}@media(max-width:640px){.theone-catalog{padding:20px}.theone-catalog-header{align-items:flex-start}.theone-catalog-header h1{font-size:21px}}
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
