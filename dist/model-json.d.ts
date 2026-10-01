import type LlmRuntime from '@deepseek-ai/dsh-llm';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
/** Small, tool-free analysis through the host runtime, with no session history replay. */
export declare function modelJson(llm: Pick<LlmRuntime, 'prepareCall'>, selection: ModelSelection, system: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
