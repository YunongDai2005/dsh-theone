export declare const zh: {
    readonly 'gateway.title': "TheOne · 主聊天";
    readonly 'gateway.label': "主聊天";
    readonly 'gateway.subtitle': "从这里继续聊";
    readonly 'gateway.opening': "正在打开 TheOne 主聊天…";
    readonly 'gateway.error': "主聊天暂时无法打开，请检查 DSH 连接和 TheOne 插件状态。";
    readonly retry: "重试";
    readonly 'catalog.title': "话题工作区";
    readonly 'catalog.subtitle': "相关的事情放在一起，随时回到主聊天继续。";
    readonly 'catalog.refresh': "整理历史";
    readonly 'catalog.reading': "正在读取话题…";
    readonly 'catalog.counts': "{topics} 个话题 · {groups} 个分组";
    readonly 'catalog.indexing': "正在整理历史…";
    readonly 'catalog.pending': "还有 {count} 个会话待整理";
    readonly 'catalog.updated': "历史目录已更新";
    readonly 'catalog.failed': "{count} 个会话暂时未能整理，稍后会重试。已有话题仍可查看。";
    readonly 'catalog.searchUnavailable': "部分历史暂时无法检索，仍可从话题目录继续聊天。";
    readonly 'catalog.loadError': "暂时无法读取话题，请检查 DSH 连接。";
    readonly 'catalog.continueError': "暂时无法继续这个话题，请等当前聊天结束后重试。";
    readonly 'catalog.refreshError': "暂时无法整理历史，请检查 DSH 模型配置。";
    readonly 'catalog.emptyIndexing': "正在从以前的聊天中整理话题。你也可以先回到主聊天。";
    readonly 'catalog.empty': "目前还没有整理出话题。开始聊天后，它们会自动出现在这里。";
    readonly 'catalog.unassigned': "待整理";
    readonly 'catalog.unassignedSummary': "这些话题还在等待自动归类。";
    readonly 'topic.opening': "正在打开…";
    readonly 'topic.continue': "继续聊天";
    readonly 'topic.source': "查看原会话";
};
export declare const en: Record<keyof typeof zh, string>;
export type TheOneLocaleKey = keyof typeof zh;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        theone: TheOneLocaleKey;
    }
}
