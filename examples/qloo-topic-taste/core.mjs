// Compatibility entry point for the existing Node application.
// Edge runtimes import agent.mjs directly and supply their own store.
export * from './agent.mjs';
export { TasteStore } from './sqlite-store.mjs';
