/** Markdown as WeChat shows it: plain text that still reads well. */
export function plainText(markdown) {
    const lines = [];
    let fenced = false;
    for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        // Code blocks keep their content; only the fences go.
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced) {
            lines.push(line);
            continue;
        }
        // Table separator rows carry nothing to read.
        if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
            continue;
        lines.push(line
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/^\s{0,3}>\s?/, '')
            .replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/, (_, indent, mark) => `${indent}${mark.trim() ? '☑' : '☐'} `)
            .replace(/^(\s*)[-*+]\s+/, '$1• ')
            .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => alt ? `${alt} (${url})` : url)
            .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text, url) => text === url ? url : `${text} (${url})`)
            .replace(/(\*\*|__)(.+?)\1/g, '$2')
            .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
            .replace(/~~(.+?)~~/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/^\s*\|(.*)\|\s*$/, (_, cells) => cells.split('|').map(cell => cell.trim()).join('  ')));
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
