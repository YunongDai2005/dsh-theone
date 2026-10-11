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

## Verified results — task version 1, October 11, 2026

| Model | Correct | Accuracy | Run ID | Recorded inference cost |
|---|---:|---:|---|---:|
| Gemini 3.7 Flash | 35/36 | 97.2% | 4630860 | $0.03675525 |
| GPT-5.4 nano (2026-03-17) | 34/36 | 94.4% | 4630864 | $0.00256955 |

These are single completed Kaggle executions on identical frozen cases. Both models misrouted `collision-2`: a request to add a moving bill to a monthly budget went to the apartment-move topic rather than the household budget. GPT also chose the thesis for `ambiguous-4`, where the policy requires clarification. A one-case difference cannot establish broad model superiority. Costs are recorded request metrics for these runs, not general workload prices or all account usage.

Qwen 3 Next 80B Instruct was scheduled as run 4630865 but remains incomplete at this update. It is excluded from the table; incomplete execution is not scored as a routing failure.

`results.json` and `cases.csv` contain sanitized summaries. `summarize_results.py` recomputes exact-match case scores from completed server traces, checks all 36 cases and the parent score, and excludes scripted harness runs. After downloading traces with the CLI, provide each completed run directory:

```bash
python summarize_results.py results-private/theone-routing-decisions/1/<model>/<run-id> --output verified-results
```

- [Public benchmark and leaderboard](https://www.kaggle.com/benchmarks/yulidai/theone-routing-decisions)
- [Published task version 1 and model outputs](https://www.kaggle.com/benchmarks/tasks/yulidai/theone-routing-decisions/1)
- [Public backing notebook](https://www.kaggle.com/code/yulidai/new-benchmark-task-d1b14/output)

The benchmark uses **Average of task scores** to aggregate numeric accuracy. Source in this GitHub repository remains MIT. The published Kaggle benchmark/task/notebook is Apache 2.0, approved separately by the author. The first pre-verification upload left private metadata without a source kernel; it is excluded from all results and public links above.

## References

- [Kaggle Benchmarks SDK](https://github.com/Kaggle/kaggle-benchmarks)
- [Official CLI benchmark commands](https://github.com/Kaggle/kaggle-cli/blob/main/docs/benchmarks.md)
- [DEV challenge](https://dev.to/challenges/kaggle-2026-09-23)
