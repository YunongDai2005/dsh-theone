import ICONS from '../generated/dsh-icons.json';
const I = ICONS as Record<string, string>;
export const svg = (name: string) => I[name] ?? '';
export const Ico = ({ n, className = '', style }: { n: string; className?: string; style?: React.CSSProperties }) =>
  <span className={`ico ${className}`} style={style} dangerouslySetInnerHTML={{ __html: svg(n) }} />;
export const ARROW = <svg width="28" height="42" viewBox="0 0 24 36"><path d="M2 2 L2 28 L8.3 21.8 L12.7 32 L16.9 30.2 L12.5 20.2 L21.2 20.2 Z" fill="#111" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
export const HAND = <svg width="34" height="38" viewBox="0 0 32 36"><path d="M11 17V4.5a3 3 0 0 1 6 0V14a3 3 0 0 1 5.2 1.2 3 3 0 0 1 5 1.6 3 3 0 0 1 4 2.2V26c0 5.2-4 9-9 9h-5c-3.6 0-5.6-1.6-7.6-4.6L4.4 23a2.7 2.7 0 0 1 4.2-3.3z" fill="#fff" stroke="#111" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
export const GITHUB = <svg className="ghm" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>;
