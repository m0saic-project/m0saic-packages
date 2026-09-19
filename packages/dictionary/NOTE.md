# .m0 should be single line only
.m0 is intended to be machine level instruction and a single-stream is best for reducing filesize.

# m0saic_pretty.txt is display-only
m0saic_pretty.txt is a human-readable view of the same bitmap. In the m0saic DSL, `N(...)` = columns and `N[...]` = rows. Some entries (e.g. the-mosaic-m-64) store the grid as columns in the .m0; the pretty file transposes to one row per line so the shape (e.g. the M logo) appears upright when you read it. **Do not use m0saic_pretty.txt as m0saic input** — only the .m0 is canonical for parsing/rendering.

# Row-major vs column-major in .m0
In the DSL, `N[...]` = rows (horizontal bands), `N(...)` = columns (vertical bands). So `256[256(...), ...]` is row-major (256 rows); `64(64[...], ...)` is column-major (64 columns). **For the engine it doesn’t matter**: the parser produces the same grid either way. **Standardize on row-major**: one line in the file = one horizontal row (top to bottom), matching how humans read (left-to-right, top-to-down). Use `N[N(...), N(...), ...]` for grids so .m0 and m0saic_pretty.txt line up.