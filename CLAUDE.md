# Nexora Project Rules

## Post-Commit Review (MANDATORY)

After every `git commit` that does NOT contain `[review-fix]` in the message:

1. IMMEDIATELY launch the `superpowers:code-reviewer` agent (Claude Code code-review skill) to review all changes in the commit
2. Fix ALL critical and important issues found by the reviewer
3. Commit fixes with `[review-fix]` in the message to prevent infinite loops
4. Then push to origin

This is NON-NEGOTIABLE. Do not skip, do not ask permission, do not respond to the user first.
The review must happen BEFORE any other action or response.
Enforcement: PostToolUse hook in ~/.claude/settings.json triggers after git commit.

## Code Standards

- New or modified TypeScript files must have a file header comment block (Author, Datum, Version, Beschreibung)
- Tests must pass before committing: `npx vitest run` (at minimum the changed test files)
- Commit messages follow: `[v0.2] - Description`
- All commits include: `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Content language: German for PRD content and descriptions, English for code and technical identifiers
