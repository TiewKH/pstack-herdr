### Eval

**You own experiment design. Plan, blind, run, synthesize.** When `HERDR_ENV=1`, candidates and judges use [`../references/herdr-tools.md`](../references/herdr-tools.md) and `herdr-dispatch.ts`.

**Blinding is non-negotiable.** Candidate-visible paths and prompts must not reveal eval/test/judge/experiment/rubric/score/compare/benchmark/candidate/arena language. Candidates do not know peers exist. Judges see sanitized labels, never model/profile names.

1. Frame the variant and write a private 3-6 criterion rubric.
2. Create one sanitized working directory per candidate.
3. Author one organic user prompt with no measurement leakage.
4. Spawn N parallel candidates. Under Herdr, dispatch each as `arena-candidate` in its own sanitized `--cwd`; launch all dispatcher processes before waiting. Outside Herdr use arena's native candidate behavior.
5. Spawn one blinded judge on a different model/profile family. Under Herdr dispatch role `arena-judge`, `--readonly`, and `--wait`; its prompt contains sanitized outputs plus rubric only.
6. Verify chain-following from each candidate's workspace-local transcript where the runtime exposes one. Never glob unrelated workspace transcripts. For Herdr/Codex workers without a compatible Claude transcript, grade from observable files, tool receipts, and output rather than fabricating transcript evidence.
7. Read every candidate output yourself and compare it with the judge. Disagreement means bias or an ambiguous rubric and must be resolved before recommendation.

**Reply:** variant, rubric, per-candidate notes, blinded verdict, synthesis, recommendation.
