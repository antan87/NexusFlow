# CLI contracts

Declare positional arguments once: either in `.command('name <id>')` or with
`.command('name').argument('<id>')`. Wrap action handlers with `runAction(...)`.

Use the repository's workspace resolver appropriate to the operation: interactive
selection when requested, quiet resolution for headless/read-only commands. Do not
introduce a prompt when a supplied workspace or current context resolves the task.

`--json` must produce parseable JSON without banners or ANSI escapes. Errors should
have a meaningful nonzero exit status; test failure paths as well as successful output.
Exercise documented subcommands and options against the built CLI's `--help`.

Tests should check observable argument behavior, JSON parsing, missing/invalid inputs,
and exit status where relevant. Use disposable fixtures for mutating commands.
