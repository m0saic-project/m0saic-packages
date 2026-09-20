# @m0saic/knowledge

The m0saic knowledge base, as plain Markdown: the **m0 handbook** (grammar,
semantics, the geometry math), the **skills** (engine mental models and
invariants), and the **template-authoring contract**. It is the same tree the
m0saic maintainers' agents work from, generated from the monorepo with every
internal reference rewritten to a public one.

**If you are a coding agent about to write a template: read this file, then
[`docs/m0saic-thesis.md`](docs/m0saic-thesis.md), then follow the router in
[`docs/README.md`](docs/README.md).** Nothing here needs a build, a network,
or a login.

## Where it lives on disk

- Installed: `node_modules/@m0saic/knowledge/docs/` — the template repo
  starters list this package as a devDependency, so `npm install` puts it
  beside your code.
- On GitHub: [`m0saic-project/m0saic-packages/packages/knowledge`](https://github.com/m0saic-project/m0saic-packages/tree/main/packages/knowledge).

## Authority order

1. `docs/handbook/` — canonical truth for the m0 language and its geometry.
2. `docs/skills/` — mental models and invariants; subordinate to the handbook.
3. `docs/templates/` — the template contract, construction strategy, recipes,
   perf rules; subordinate to both.

Handbook wins over skills, skills over templates, and **code wins over every
doc**: when a document and the packages disagree, the packages are right. The
one idea everything rests on: a layout is one string of rectangles
(`docs/m0saic-thesis.md`).

## Read code, not just prose — the three example repos

| Repo | What it is | Good for |
|---|---|---|
| [`m0saic-project/m0saic-template-repo-starter`](https://github.com/m0saic-project/m0saic-template-repo-starter) | ~80 one-concept templates, one lesson each, zero-build | learning the shape of a template; copying a pattern in isolation |
| [`m0saic-project/m0saic-community-templates`](https://github.com/m0saic-project/m0saic-community-templates) | the public library, one folder per publisher, signed releases | a real submission's layout, tests, registry entry, `deprecated.replacement` |
| [`m0saic-project/m0saic-packages/packages/templates`](https://github.com/m0saic-project/m0saic-packages/tree/main/packages/templates) | the official library that ships in the product (100+ templates) | the house standard for every kind of template: brand, charts, media, data-driven, pipelines |

Start your own from the scaffold:
[`m0saic-template-repo-starter-base`](https://github.com/m0saic-project/m0saic-template-repo-starter-base)
(rename its placeholder identity in `src/repo.ts` before you publish).

## Verify before you claim it works

- `validateM0String(str)` from `@m0saic/dsl` — never ship an m0 string you
  did not validate; `isValidM0String` is the boolean form.
- `npm run verify` in a starter clone — build, lint, tests, the loader
  contract, the dependency policy.
- `m0saic doctor <repo>` — the CLI's convention audit over a template repo;
  its `latticeSmooth` finding is blocking.
- `m0saic make <id> --template-repo <repo> --validate-only` — the plan
  without the render.

## What is deliberately not here

The engine's internals — filtergraph construction, the cost model, the
ffmpeg walls and their mitigations, the private app internals. Where a page
would have cited one it says so in plain text ("absent in the shipped copy")
and stands on its own. Every author-facing consequence of those internals is
distilled into [`docs/templates/patterns/perf-authoring-rules.md`](docs/templates/patterns/perf-authoring-rules.md).

## Maintenance

`docs/` is generated — do not edit it here. The source is the maintainers'
knowledge tree in the m0saic monorepo; a sync script regenerates this copy
and fails if any reference to private code survives. Found something wrong?
Open an issue on the mirror repo.

MIT — see LICENSE.
