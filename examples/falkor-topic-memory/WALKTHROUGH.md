# Technical review for the participant

This checklist is preparation, not a record that the participant has completed it. Use synthetic inputs only.

1. Read `queries.mjs` alongside the graph model. Explain why Fact and Assertion are separate, and how CURRENT plus SUPERSEDES retains corrections without replaying stale values.
2. In the running app, create three topics and a confirmed fact. Share only that fact with one topic, revise it, and check the impact list and history. Add another private-to-topic fact and verify it does not appear in the recipient.
3. Revoke the grant. Explain what revocation prevents and what it cannot undo for an already-read value.
4. Explain which model outputs are untrusted, why confirmation is separate from planning, and why the model cannot author a database query or permission edge.
5. Inspect the expected-revision WHERE clause. Try editing the same fact from two browser tabs with one stale revision. Explain the409 conflict and why it avoids a silent overwrite.
6. Open an independent browser profile/context. Explain why the new browser sees an empty directory and cannot access another workspace's topic ID.
7. Stop only this project's database, try a context read and observe503. Explain why the product depends on FalkorDB rather than drawing a graph over ordinary storage. Restore only this project's database afterward.
8. Explain what came from the pre-existing TheOne idea versus the new in-window graph work, and accurately disclose Codex's contribution. Choose a project improvement or design decision you can personally verify and explain before final entry.

Record real observations and your own explanation; do not fill this checklist with generated answers claiming you performed the steps. After that review, make a working-project video and complete the existing team entry rather than a duplicate registration.
