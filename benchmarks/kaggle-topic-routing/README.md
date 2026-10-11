# TheOne routing decisions on Kaggle

A small public diagnostic for the DEV × Kaggle Benchmarking Challenge, authored with AI assistance on October 11, 2026. It measures base-model decisions under a stated routing policy. It does not measure the production TheOne router or reuse the earlier project evaluation scores.

## Task and scoring

A single-chat assistant receives a catalog of three topics, recent conversation, and a new message. It must return an existing topic ID, `NEW` for a distinct matter, or `CLARIFY` when the supplied evidence leaves several topics equally plausible.

There are 36 synthetic cases in six equal groups: explicit topic references, contextual resumption, lexical collisions, new topics, clarification, and quoted instruction resistance. Topic order rotates. Gold labels and diagnostic group names are excluded from model input. Each case makes one model request. Scoring is exact label matching after case and whitespace normalization; extra prose or unknown labels score zero. No LLM judge is used.

All cases and labels are public. This is a small diagnostic, not a representative user sample or a contamination-proof held-out benchmark. One case changes the overall score by 2.78 percentage points. The clarification cases often state the ambiguity explicitly, so they are easier than natural conversation. Results cannot establish safety, broad model quality, or production routing accuracy.

## Reproduce

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python verify_harness.py
kaggle auth login --no-launch-browser
kaggle b t push theone-routing-decisions -f theone_topic_routing.py --wait 300
kaggle b t run theone-routing-decisions -m gpt-5.4-nano-2026-03-17 -m qwen3-next-80b-a3b-instruct --wait 600
kaggle b t status theone-routing-decisions
kaggle b t download theone-routing-decisions -o results-private -s
```

Kaggle account phone and identity verification are required for model access. Check your displayed inference allowance before running. Keep API credentials outside this repository. The CLI runs on Kaggle infrastructure; local Model Proxy credentials are not needed for the commands above.

`verify_harness.py` uses scripted mock responses. Its positive, negative, and half-correct controls verify scoring only. They are not real model results and make zero inference requests.

## Results and publication status

Pending real model execution. No model accuracy or contest submission is claimed at this stage. The first pre-verification upload left a private task without a source kernel; it is not the reproducible task named above and will not be submitted as a benchmark.

Source is covered by this repository's MIT license. Kaggle separately displays its task/notebook license; check the platform page for the published artifact's license.

## References

- [Kaggle Benchmarks SDK](https://github.com/Kaggle/kaggle-benchmarks)
- [Official CLI benchmark commands](https://github.com/Kaggle/kaggle-cli/blob/main/docs/benchmarks.md)
- [DEV challenge](https://dev.to/challenges/kaggle-2026-09-23)
