# m0saic stdlib

Functions in this folder generate **valid m0saic DSL strings**
from higher-level layout intent.

These helpers are **not part of the m0saic language itself**.
They are construction utilities used by templates and tooling
to produce correct, validated m0saic layouts (e.g. grids,
contact sheets, stacked layouts).

All outputs **must** pass `isValidM0saicString` from `@m0saic/dsl`
before being considered valid.
