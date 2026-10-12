# TheOne Gemma Coder

A separate experimental Python bug-fixing agent for the Google Gemma 4 Developer Agent Competition. It declares one ADK LlmAgent, the mandated `gemma-4-31b-it-qat-w4a16-ct` model and the nine official repository tools. The original prompt favors a small relevant search, an evidence-backed hypothesis, targeted verification and a final patch. Codex assisted the configuration and reproduction. TheOne's original topic router is not used to solve these software-engineering tasks.

## Evidence and limits

The exact four configuration files passed the actual official directory validator and ran through the official evaluator on an offline Kaggle L4x4 session. The first three frozen public-development training smoke tasks produced genuine model tool calls and patches; one passed the official tests and two did not. This is a small development sample, not leaderboard performance. The last observed validation task rich_3535 did not pass; the final two validation results have not been recovered. The session stop and output preservation remain unverified. No LoRA training, paper novelty, award or final submission is claimed.

The private runtime notebook is an attributed Apache2 copy of Ryan Holbrook's [official starter](https://www.kaggle.com/code/ryanholbrook/getting-started-gemma-4-developer-agent). Its installed wheelhouse did not export the starter's `swegemma.models.discovery` validator. The reproduction used actual `adk_submission.validate_directory` and a separate fail-closed exact-model check before starting the mandated model. This directory contains only original agent configuration and a small packaging helper, available under MIT or Apache 2.0 (see LICENSE-APACHE-2.0); it does not include the official harness, model weights, protected data, reference patches or traces. Any winning-code license obligations follow the approved competition rules.

The development split was frozen before examining task outputs and stratified by repository. Demonstrated starter tasks are excluded from validation. Configuration hashes are checked before each task. The three-task validation sample does not establish general accuracy; untouched remaining validation tasks are reserved for future measurement.

## Package and reproduce

```sh
python3 examples/gemma-coder/test_package.py
python3 examples/gemma-coder/package_agent.py --output /tmp/theone-gemma-agent.zip
```

The archive includes exactly `agent.yaml`, `eval_config.yaml`, `configs/sampling.yaml`, and `prompts/task.md`; the helper emits file and archive hashes. It is a candidate archive, not evidence of compilation or a competition submission. Within an eligible competition notebook, use the current official validator/evaluator, mandated model and offline data. Do not substitute mocks for inference or publish competition data outside the permitted channel. Public Kaggle code mirroring is required before external source release. The owner approved publication on October 12. The [original code-only Kaggle mirror](https://www.kaggle.com/code/yulidai/theone-gemma-coder-original-config-v1) is public under Apache 2.0, version 2, with a completed CPU-only offline packaging run. Official API read-back verifies the existing notebook ID 138281245, public status and absence of model or data inputs. This notebook packages the frozen agent; it does not run inference or produce a leaderboard score.

## License scope

The original agent configuration, packaging helper, tests and documentation in this directory are available under MIT (the repository root LICENSE) or Apache 2.0 (LICENSE-APACHE-2.0), at your option. The Kaggle code-only mirror is to be published under Apache 2.0. The license grant excludes competition data, model weights, official evaluator code and private runtime traces, which are not distributed here. The four frozen agent files remain byte-for-byte unchanged.
