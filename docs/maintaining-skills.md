# Maintaining development skills

The maintained sources are `resources/skills/nexusflow-lifecycle` (using ContextSpace),
`resources/skills/nexusflow-dev` (maintaining its code), and
`resources/skills/contextspace-verify-release` (verification and delivery).
The existing two IDs are retained so workspace selections keep working.
Workflow strategies in `resources/workflows/` must agree with the same state model.

Keep each entrypoint focused. Put conditional procedures in linked references;
do not add fixed test counts, mandatory agent teams, or another implementation plan.
Update these sources rather than generated `.agents/skills` or harness copies.
Bundling sources does not automatically overwrite a user's customized catalog.

## Validate changes

```sh
npm run build:backend
npm run check:skills
npm test
```

The checker verifies package metadata, portable files, local Markdown links, actual
built CLI help/options, and package script names. It also rejects known duplicate-plan
and fixed-test-count patterns. These structural checks cannot establish whether prose
causes good decisions or detect every semantic contradiction.

For substantial guidance changes, evaluate the scenarios in
`tests/fixtures/development-skill-scenarios.json`. Give an independent evaluator each
prompt and the skill sources, without the expected rubric. Ask for its next actions,
outputs, checks, and stopping point, without making external changes. Compare its
response to the rubric afterward. Record scenario IDs, outcome, evidence, and any
limitations; fix demonstrated problems and reevaluate affected scenarios. Do not
claim behavioral evaluation passed merely because the structural checker is green.

## Install and regenerate

After reviewing local customizations, explicitly install the sources into the
machine-wide catalog and optionally enable all three in one workspace:

```sh
node scripts/install-development-skills.mjs --global --workspace /absolute/workspace
```

This updates these three IDs through the catalog API, including their reference
files. Other skill IDs and workspace selections are preserved. It does not refresh
every workspace or push a commit. Existing customizations to these three packages
should be incorporated into the versioned source before installation.

Then run `ctxspace refresh` from the chosen workspace. Check generated skill files
and the resource lock. If generation succeeds but Git staging fails, report those
separately; do not hand-edit the generated copies to bypass the source workflow.
