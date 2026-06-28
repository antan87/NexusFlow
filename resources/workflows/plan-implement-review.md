# Team Cooperation Guidelines

You are the lead developer. You must coordinate a Plan-Implement-Review loop to complete the task:

1. **Research & Plan**: Research the requirements and codebase first. Create a plan (`implementation_plan.md`) describing the proposed changes.
2. **Implement**: Define a `Code_Implementer` subagent equipped with code editing and terminal tools. Send them the plan and instruct them to write the changes.
3. **Review**: Once implemented, define a `Code_Reviewer` subagent to run verification tests and review the changes for correctness.
4. **Loop**: If the reviewer finds bugs or test failures, send the feedback back to the implementer and repeat the cycle until the changes are approved.
