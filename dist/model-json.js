import { RouterFailure, answerJson } from "./llm-router.js";
/** Small, tool-free analysis through the host runtime, with no session history replay. */
export async function modelJson(llm, selection, system, payload, signal, options = {}) {
    signal?.throwIfAborted();
    if (!selection.provider || !selection.model || selection.provider === 'theone')
        throw new RouterFailure('CATALOG_MODEL_UNAVAILABLE');
    const text = JSON.stringify(payload);
    if (text.length > 42000)
        throw new RouterFailure('CATALOG_INPUT_TOO_LARGE');
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 90000);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
        const call = await llm.prepareCall({ ...selection, maxTokens: options.maxTokens ?? 16384,
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}) }, bounded);
        bounded.throwIfAborted();
        let output = '', finished = false;
        for await (const chunk of call.stream({ ...call.config, system,
            messages: [{ role: 'user', content: [{ type: 'text', text }] }], signal: bounded })) {
            bounded.throwIfAborted();
            if (finished)
                throw new RouterFailure('CATALOG_OUTPUT_INVALID');
            if (chunk.type === 'text-delta')
                output += chunk.text;
            if (output.length > 16000)
                throw new RouterFailure('CATALOG_OUTPUT_TOO_LARGE');
            if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-end' && chunk.block.type === 'tool-call'))
                throw new RouterFailure('CATALOG_OUTPUT_INVALID');
            if (chunk.type === 'finish') {
                if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
                    throw new RouterFailure(`CATALOG_REQUEST_FAILED_${chunk.reason.failure.status ?? chunk.reason.failure.code ?? 'UNKNOWN'}`, { elapsedMs: 0, httpStatus: chunk.reason.failure.status });
                if (chunk.reason.kind !== 'stop')
                    throw new RouterFailure('CATALOG_OUTPUT_INCOMPLETE_' + chunk.reason.kind.toUpperCase().replaceAll('-', '_'));
                finished = true;
            }
        }
        if (!finished)
            throw new RouterFailure('CATALOG_OUTPUT_INCOMPLETE');
        const json = answerJson(output);
        try {
            return JSON.parse(json);
        }
        catch {
            throw new RouterFailure('CATALOG_OUTPUT_INVALID');
        }
    }
    catch (error) {
        signal?.throwIfAborted();
        if (error instanceof RouterFailure)
            throw error;
        throw new RouterFailure(bounded.aborted ? 'CATALOG_REQUEST_TIMEOUT' : 'CATALOG_REQUEST_FAILED');
    }
}
