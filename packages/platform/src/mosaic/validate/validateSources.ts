import type {
    MosaicSource,
    MosaicMediaSource,
    MosaicMosaicSource,
    MosaicTextSource,
    MosaicDataSource,
    MosaicTemplateInvocationSource,
    MosaicDiagnostic,
    MosaicBoxFrac,
    MosaicAssetManifest,
    MosaicSourceMask,
} from "@m0saic/types";
import { asDiagnosticCode, isAliasId, isMosaicDataSource, isTemplateId } from "@m0saic/types";
import { validateLavfiSource } from "./validateLavfiSource";

/**
 * Gain above which `audio.volume` earns a clipping warning.
 *
 * `volume` is a GAIN FACTOR that lowers onto ffmpeg's `volume=` filter, so
 * values above 1 are legal amplification (the type documents "2 = double
 * volume") — but a mix that doubles twice over is almost always a typo,
 * classically a percentage (`volume: 100`). 4 leaves real headroom for
 * deliberate boosts while still catching that.
 */
const LOUD_GAIN_WARN = 4;

/**
 * Options for {@link validateMosaicSources}.
 *
 * Switches the validator between engine-strict mode (the default,
 * suited for `.mosaic`) and source-form mode (used by
 * `validateMosaicXDocument` for `.mosaicx` files).
 */
export type ValidateMosaicSourcesOptions = {
    /**
     * When true (mosaicx mode), `template_invocation` sources are
     * validated structurally (templateId / props presence) and pass
     * if well-formed. When false / undefined (engine-strict mode), any
     * `template_invocation` source emits `UNRESOLVED_TEMPLATE_INVOCATION`
     * — the resolver must materialize them before reaching engine-bound
     * validation.
     */
    allowTemplateInvocation?: boolean;
};

export function validateMosaicSources(
    sources: MosaicSource[],
    assets: MosaicAssetManifest = {},
    opts: ValidateMosaicSourcesOptions = {},
): MosaicDiagnostic[] {
    const diagnostics: MosaicDiagnostic[] = [];

    sources.forEach((source, index) => {
        if (source.type === "media") {
            validateMediaSource(source, index, diagnostics, assets);
        } else if (source.type === "mosaic") {
            validateMosaicSource(source, index, diagnostics, assets);
        } else if (source.type === "text") {
            validateTextSource(source, index, diagnostics, assets);
        } else if (source.type === "lavfi") {
            validateLavfiSource(source, index, diagnostics);
            validateMaskAgainstManifest(source.mask, index, diagnostics, assets);
            validateEffects(source.effects, index, diagnostics);
        } else if (isMosaicDataSource(source)) {
            validateDataSource(source, index, diagnostics);
        } else if (source.type === "ref") {
            // MosaicRefSource resolution is owned by the planner
            // (collectRefTargets + buildMosaicNode). Parse-time shape
            // validation here is structural only; the planner emits
            // resolution diagnostics (NOT_FOUND, FORWARD_REFERENCE,
            // TARGET_NOT_SUPPORTED) as it walks the doc.
        } else if (source.type === "template_invocation") {
            // `template_invocation` sources are valid only inside a
            // `MosaicXDocument` (`.mosaicx` source form). When the
            // caller opts in via `allowTemplateInvocation`, we validate
            // structurally (templateId, props presence); otherwise we
            // emit `UNRESOLVED_TEMPLATE_INVOCATION` — the resolver
            // (`resolveMosaicx` in `@m0saic/core/runtime`) should have
            // materialized these before any engine-bound validator ran.
            if (opts.allowTemplateInvocation) {
                validateTemplateInvocationSource(source, index, diagnostics);
            } else {
                diagnostics.push({
                    code: asDiagnosticCode("UNRESOLVED_TEMPLATE_INVOCATION"),
                    message: `Source[${index}] is a template_invocation but the document was passed to the engine-strict source validator. Run resolveMosaicx first or use validateMosaicXDocument for source-form (.mosaicx) docs.`,
                    severity: "error",
                });
            }
        }
        else {
            diagnostics.push({
                code: asDiagnosticCode("UNKNOWN_SOURCE_TYPE"),
                message: `Source[${index}] has unknown type "${(source as any).type}".`,
                severity: "error",
            });
        }
    });

    // Alias-collision checks for MosaicDataSource. Data sources may sit
    // alongside renderable sources in the same array; each data source
    // occupies a cell that renders the degenerate carrier (analogous to
    // audio-only media sources).
    validateDataSourcePartitioning(sources, diagnostics);

    return diagnostics;
}

/**
 * Per-source validation for `MosaicTemplateInvocationSource`.
 *
 * Only called when `validateMosaicSources` is invoked with
 * `allowTemplateInvocation: true` (i.e. through the mosaicx-strict
 * validator path). Checks structural shape only — full propsSchema
 * validation happens at resolve time, since the prop bag's expected
 * shape depends on the named template and isn't knowable here.
 */
function validateTemplateInvocationSource(
    src: MosaicTemplateInvocationSource,
    index: number,
    diagnostics: MosaicDiagnostic[],
): void {
    // templateId must be present and conform to TemplateId pattern.
    const id = (src as { templateId?: unknown }).templateId;
    if (typeof id !== "string" || id.length === 0 || !isTemplateId(id)) {
        diagnostics.push({
            code: asDiagnosticCode("MOSAICX_INVOCATION_MISSING_TEMPLATE_ID"),
            message: `Source[${index}] (template_invocation) is missing templateId or it isn't a valid TemplateId; received: ${JSON.stringify(id)}.`,
            severity: "error",
        });
    }

    // props must be present (engine reads it as an object; absence ≠
    // "no props"). Empty `{}` is the right "no overrides" sentinel.
    const propsField = (src as { props?: unknown }).props;
    if (propsField === undefined) {
        diagnostics.push({
            code: asDiagnosticCode("MOSAICX_INVOCATION_MISSING_PROPS"),
            message: `Source[${index}] (template_invocation) is missing required field "props" (use empty {} for templates with no required props).`,
            severity: "error",
        });
    }

    // Note: deeper structural checks (`output` shape, `templateVersion`
    // pin matching) are deferred to the resolver, which has the
    // template registry and can produce more actionable diagnostics
    // (MOSAICX_TEMPLATE_NOT_FOUND / MOSAICX_TEMPLATE_VERSION_MISMATCH).
}

/**
 * Per-source validation for `MosaicDataSource`.
 * Cross-source rules (mixing, alias collisions) live in
 * {@link validateDataSourcePartitioning}.
 */
function validateDataSource(
    src: MosaicDataSource,
    index: number,
    diagnostics: MosaicDiagnostic[],
): void {
    // variables must be a non-null object (Record-shaped)
    const vars = (src as { variables?: unknown }).variables;
    if (vars == null || typeof vars !== "object" || Array.isArray(vars)) {
        diagnostics.push({
            code: asDiagnosticCode("DATA_SOURCE_VARIABLES_MALFORMED"),
            message: `Source[${index}] (data) must have a non-null object "variables" (received: ${vars === null ? "null" : Array.isArray(vars) ? "array" : typeof vars}).`,
            severity: "error",
        });
    }

    // alias (if present) must satisfy STRICT_IDENTIFIER_PATTERN
    if (src.alias !== undefined && !isAliasId(src.alias)) {
        diagnostics.push({
            code: asDiagnosticCode("DATA_SOURCE_ALIAS_INVALID"),
            message: `Source[${index}] (data) alias must match STRICT_IDENTIFIER_PATTERN (letter/_/alphanumeric, max 64 chars); received: ${JSON.stringify(src.alias)}.`,
            severity: "error",
        });
    }
}

/**
 * Cross-source alias-collision check for `MosaicDataSource`.
 *
 * Two data sources sharing the same `alias` → `MOSAIC_ALIAS_COLLISION`
 * (error).
 *
 * Data sources are allowed alongside renderable sources in the same
 * `sources[]` — a data source occupies a cell that renders the
 * degenerate `MOSAIC_DATA_SOURCE_CARRIER` (1s × 16×16 black),
 * analogous to how an audio-only media source occupies a cell with
 * an empty visual buffer. Author allocates the cell in their m0
 * geometry like any other source.
 *
 * `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` (pure-data-only step
 * without `intermediate:true`) needs step context not available
 * here; it's enforced by the pipeline-runner caller.
 */
function validateDataSourcePartitioning(
    sources: MosaicSource[],
    diagnostics: MosaicDiagnostic[],
): void {
    const dataIndices: number[] = [];

    sources.forEach((source, index) => {
        if (isMosaicDataSource(source)) {
            dataIndices.push(index);
        }
    });

    // Alias collisions — two data sources publishing the same alias.
    if (dataIndices.length > 1) {
        const seenAliases = new Map<string, number>();
        for (const i of dataIndices) {
            const alias = (sources[i] as MosaicDataSource).alias;
            if (alias === undefined) continue;
            const aliasStr = alias as unknown as string;
            const prior = seenAliases.get(aliasStr);
            if (prior !== undefined) {
                diagnostics.push({
                    code: asDiagnosticCode("MOSAIC_ALIAS_COLLISION"),
                    message: `sources[${i}] (data) declares alias ${JSON.stringify(aliasStr)} already used by sources[${prior}]. Aliases must be unique within a step.`,
                    severity: "error",
                });
            } else {
                seenAliases.set(aliasStr, i);
            }
        }
    }
}

/**
 * If a source has an alpha-image mask, the referenced assetId must resolve
 * to a `kind: "file"` entry. `inline-mask` variants carry their shape on
 * the source itself and rasterize through `rasterizeMaskPng` at render
 * time — they don't enter the asset manifest, so the validator skips them.
 */
function validateMaskAgainstManifest(
    mask: MosaicSourceMask | undefined,
    index: number,
    diagnostics: MosaicDiagnostic[],
    assets: MosaicAssetManifest,
): void {
    if (mask == null) return;
    if (mask.kind === "inline-mask") {
        // Light shape checks for the mask-authoring extensions — catch a
        // malformed stroke/part/feather here with a readable diagnostic
        // instead of a sharp SVG error mid-render.
        const bad = (why: string) => {
            diagnostics.push({
                code: asDiagnosticCode("MASK_INLINE_INVALID"),
                message: `Source[${index}] inline-mask ${why}`,
                severity: "error",
            });
        };
        const validStrokes = (strokes: unknown, where: string): boolean => {
            if (strokes === undefined) return true;
            if (!Array.isArray(strokes) || strokes.length === 0) {
                bad(`${where} must be a non-empty array of { d, width }.`);
                return false;
            }
            for (const s of strokes) {
                const rec = s as { d?: unknown; width?: unknown } | null;
                if (
                    rec == null ||
                    typeof rec.d !== "string" ||
                    rec.d.trim() === "" ||
                    typeof rec.width !== "number" ||
                    !Number.isFinite(rec.width) ||
                    rec.width <= 0
                ) {
                    bad(`${where} entries need a non-empty d and a positive width.`);
                    return false;
                }
            }
            return true;
        };
        validStrokes(mask.strokes, "strokes");
        if (mask.parts !== undefined) {
            if (!Array.isArray(mask.parts) || mask.parts.length === 0) {
                bad("parts must be a non-empty array.");
            } else {
                for (const p of mask.parts) {
                    const t = p?.translate as { x?: unknown; y?: unknown } | undefined;
                    if (
                        !t ||
                        typeof t.x !== "number" ||
                        !Number.isFinite(t.x) ||
                        typeof t.y !== "number" ||
                        !Number.isFinite(t.y)
                    ) {
                        bad("parts entries need a finite { translate: { x, y } }.");
                        break;
                    }
                    if (!validStrokes(p.strokes, "parts[].strokes")) break;
                    const c = p?.clip as
                        | { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
                        | undefined;
                    if (
                        c !== undefined &&
                        (typeof c?.x !== "number" ||
                            !Number.isFinite(c.x) ||
                            typeof c.y !== "number" ||
                            !Number.isFinite(c.y) ||
                            typeof c.width !== "number" ||
                            !Number.isFinite(c.width) ||
                            c.width <= 0 ||
                            typeof c.height !== "number" ||
                            !Number.isFinite(c.height) ||
                            c.height <= 0)
                    ) {
                        bad("parts[].clip needs finite { x, y } and positive { width, height }.");
                        break;
                    }
                }
            }
        }
        if (
            mask.featherPx !== undefined &&
            (typeof mask.featherPx !== "number" ||
                !Number.isFinite(mask.featherPx) ||
                mask.featherPx < 0)
        ) {
            bad("featherPx must be a finite number >= 0 (design px).");
        }
        return;
    }
    if (mask.kind !== "alpha-image") return;
    const id = mask.assetId;
    if (typeof id !== "string" || id.length === 0) {
        diagnostics.push({
            code: asDiagnosticCode("MASK_ASSETID_EMPTY"),
            message: `Source[${index}] alpha-image mask has empty assetId.`,
            severity: "error",
        });
        return;
    }
    const entry = assets[id];
    if (entry == null) {
        diagnostics.push({
            code: asDiagnosticCode("MASK_ASSETID_UNKNOWN"),
            message: `Source[${index}] alpha-image mask references unknown assetId "${id}".`,
            severity: "error",
        });
        return;
    }
    if (entry.kind !== "file") {
        diagnostics.push({
            code: asDiagnosticCode("MASK_ASSET_KIND_INVALID"),
            message: `Source[${index}] alpha-image mask must reference a file asset (assetId="${id}" is kind="${entry.kind}").`,
            severity: "error",
        });
    }
}

/**
 * Range/shape checks for the wired per-tile effect knobs. Applies to every
 * renderable source type (media / mosaic / text / lavfi) — the effects bag
 * is shared across them. Unwired fields (scale/translate) are not checked;
 * fields with their own richer validation (rounding/stroke/camera) keep it
 * at the engine boundary.
 */
function validateEffects(
    effects: unknown,
    index: number,
    diagnostics: MosaicDiagnostic[],
): void {
    if (effects == null || typeof effects !== "object") return;
    const fx = effects as {
        rotate?: unknown;
        blur?: unknown;
        fadeInMs?: unknown;
        fadeOutMs?: unknown;
        grade?: unknown;
        noise?: unknown;
        pixelize?: unknown;
        chromaKey?: unknown;
    };

    const isFiniteNumber = (v: unknown): v is number =>
        typeof v === "number" && Number.isFinite(v);

    // rotate: finite number (degrees; negative = counter-clockwise)
    if (fx.rotate !== undefined && (typeof fx.rotate !== "number" || !Number.isFinite(fx.rotate))) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_EFFECT_ROTATE"),
            message: `Source[${index}] effects.rotate must be a finite number (degrees) if set (received: ${String(fx.rotate)}).`,
            severity: "error",
        });
    }

    // blur: finite number >= 0 (content blur), OR the object form
    // { sigma, backdrop? } (backdrop:true = glassmorphism region composite)
    if (fx.blur !== undefined) {
        if (typeof fx.blur === "number") {
            if (!Number.isFinite(fx.blur) || fx.blur < 0) {
                diagnostics.push({
                    code: asDiagnosticCode("INVALID_EFFECT_BLUR"),
                    message: `Source[${index}] effects.blur must be a finite number >= 0 (gaussian sigma in px) if set (received: ${String(fx.blur)}).`,
                    severity: "error",
                });
            }
        } else if (fx.blur == null || typeof fx.blur !== "object" || Array.isArray(fx.blur)) {
            diagnostics.push({
                code: asDiagnosticCode("INVALID_EFFECT_BLUR"),
                message: `Source[${index}] effects.blur must be a number or an object { sigma, backdrop? } if set.`,
                severity: "error",
            });
        } else {
            const b = fx.blur as { sigma?: unknown; backdrop?: unknown };
            if (!isFiniteNumber(b.sigma) || b.sigma < 0) {
                diagnostics.push({
                    code: asDiagnosticCode("INVALID_EFFECT_BLUR"),
                    message: `Source[${index}] effects.blur.sigma is required in object form and must be a finite number >= 0 (received: ${String(b.sigma)}).`,
                    severity: "error",
                });
            }
            if (b.backdrop !== undefined && typeof b.backdrop !== "boolean") {
                diagnostics.push({
                    code: asDiagnosticCode("INVALID_EFFECT_BLUR"),
                    message: `Source[${index}] effects.blur.backdrop must be a boolean if set (received: ${String(b.backdrop)}).`,
                    severity: "error",
                });
            }
        }
    }

    // fadeInMs / fadeOutMs: finite number >= 0
    for (const field of ["fadeInMs", "fadeOutMs"] as const) {
        const v = fx[field];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
            diagnostics.push({
                code: asDiagnosticCode("INVALID_EFFECT_FADE"),
                message: `Source[${index}] effects.${field} must be a finite number >= 0 (milliseconds) if set (received: ${String(v)}).`,
                severity: "error",
            });
        }
    }

    // noise: object; amount 0..100 required; seed REQUIRED (determinism §9 —
    // unseeded grain would render differently every run)
    if (fx.noise !== undefined) {
        if (fx.noise == null || typeof fx.noise !== "object" || Array.isArray(fx.noise)) {
            diagnostics.push({
                code: asDiagnosticCode("INVALID_EFFECT_NOISE"),
                message: `Source[${index}] effects.noise must be an object { amount, seed } if set.`,
                severity: "error",
            });
        } else {
            const n = fx.noise as { amount?: unknown; seed?: unknown };
            if (!isFiniteNumber(n.amount) || n.amount < 0 || n.amount > 100) {
                diagnostics.push({
                    code: asDiagnosticCode("INVALID_EFFECT_NOISE"),
                    message: `Source[${index}] effects.noise.amount must be a finite number in [0, 100] (received: ${String(n.amount)}).`,
                    severity: "error",
                });
            }
            if (!isFiniteNumber(n.seed)) {
                diagnostics.push({
                    code: asDiagnosticCode("EFFECT_NOISE_SEED_REQUIRED"),
                    message: `Source[${index}] effects.noise.seed is required and must be a finite number — determinism demands an explicit seed (same seed = same grain).`,
                    severity: "error",
                });
            }
        }
    }

    // pixelize: finite number >= 0 (block px)
    if (fx.pixelize !== undefined && (!isFiniteNumber(fx.pixelize) || fx.pixelize < 0)) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_EFFECT_PIXELIZE"),
            message: `Source[${index}] effects.pixelize must be a finite number >= 0 (block px) if set (received: ${String(fx.pixelize)}).`,
            severity: "error",
        });
    }

    // chromaKey: object; color required; similarity/blend 0..1; despill boolean.
    // (The media-type guard — no keying on image/audio media — lives in
    // validateMediaSource, which knows the source's mediaType.)
    if (fx.chromaKey !== undefined) {
        if (fx.chromaKey == null || typeof fx.chromaKey !== "object" || Array.isArray(fx.chromaKey)) {
            diagnostics.push({
                code: asDiagnosticCode("INVALID_EFFECT_CHROMAKEY"),
                message: `Source[${index}] effects.chromaKey must be an object { color, similarity?, blend?, despill? } if set.`,
                severity: "error",
            });
        } else {
            const ck = fx.chromaKey as {
                color?: unknown;
                similarity?: unknown;
                blend?: unknown;
                despill?: unknown;
            };
            if (typeof ck.color !== "string" || ck.color.trim() === "") {
                diagnostics.push({
                    code: asDiagnosticCode("INVALID_EFFECT_CHROMAKEY"),
                    message: `Source[${index}] effects.chromaKey.color is required and must be a non-empty color string (e.g. "#00ff00").`,
                    severity: "error",
                });
            }
            for (const field of ["similarity", "blend"] as const) {
                const v = ck[field];
                if (v !== undefined && (!isFiniteNumber(v) || v < 0 || v > 1)) {
                    diagnostics.push({
                        code: asDiagnosticCode("INVALID_EFFECT_CHROMAKEY"),
                        message: `Source[${index}] effects.chromaKey.${field} must be a finite number in [0, 1] if set (received: ${String(v)}).`,
                        severity: "error",
                    });
                }
            }
            if (ck.despill !== undefined && typeof ck.despill !== "boolean") {
                diagnostics.push({
                    code: asDiagnosticCode("INVALID_EFFECT_CHROMAKEY"),
                    message: `Source[${index}] effects.chromaKey.despill must be a boolean if set (received: ${String(ck.despill)}).`,
                    severity: "error",
                });
            }
        }
    }

    // grade: object of range-bounded scalars (ranges mirror mosaic.schema.json)
    if (fx.grade !== undefined) {
        if (fx.grade == null || typeof fx.grade !== "object" || Array.isArray(fx.grade)) {
            diagnostics.push({
                code: asDiagnosticCode("INVALID_EFFECT_GRADE"),
                message: `Source[${index}] effects.grade must be an object if set (received: ${Array.isArray(fx.grade) ? "array" : typeof fx.grade}).`,
                severity: "error",
            });
        } else {
            const g = fx.grade as Record<string, unknown>;
            const GRADE_RANGES: Record<string, [number, number]> = {
                brightness: [-1, 1],
                contrast: [0, 2],
                saturation: [0, 3],
                gamma: [0.1, 10],
            };
            for (const [field, [lo, hi]] of Object.entries(GRADE_RANGES)) {
                const v = g[field];
                if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)) {
                    diagnostics.push({
                        code: asDiagnosticCode("INVALID_EFFECT_GRADE"),
                        message: `Source[${index}] effects.grade.${field} must be a finite number in [${lo}, ${hi}] if set (received: ${String(v)}).`,
                        severity: "error",
                    });
                }
            }
        }
    }
}

/**
 * Validate a single fraction value (0..0.49).
 */
function validateFrac(
    value: number,
    fieldPath: string,
    index: number,
    diagnostics: MosaicDiagnostic[],
    codePrefix: string
): boolean {
    if (!Number.isFinite(value) || value < 0 || value >= 0.5) {
        diagnostics.push({
            code: asDiagnosticCode(`${codePrefix}_INVALID_${fieldPath.toUpperCase().replace(/\./g, "_")}`),
            message: `Source[${index}] placement.${fieldPath} must be a finite number in [0, 0.49] if set (received: ${value}).`,
            severity: "error",
        });
        return false;
    }
    return true;
}

/**
 * Validate a MosaicBoxFrac value: each resolved side must be in [0, 0.49].
 */
function validateBoxFrac(
    box: MosaicBoxFrac | undefined,
    fieldName: string,
    index: number,
    diagnostics: MosaicDiagnostic[],
    codePrefix: string
): void {
    if (box == null) return;

    if (typeof box === "number") {
        validateFrac(box, fieldName, index, diagnostics, codePrefix);
        return;
    }

    if (box.x !== undefined) validateFrac(box.x, `${fieldName}.x`, index, diagnostics, codePrefix);
    if (box.y !== undefined) validateFrac(box.y, `${fieldName}.y`, index, diagnostics, codePrefix);
    if (box.top !== undefined) validateFrac(box.top, `${fieldName}.top`, index, diagnostics, codePrefix);
    if (box.right !== undefined) validateFrac(box.right, `${fieldName}.right`, index, diagnostics, codePrefix);
    if (box.bottom !== undefined) validateFrac(box.bottom, `${fieldName}.bottom`, index, diagnostics, codePrefix);
    if (box.left !== undefined) validateFrac(box.left, `${fieldName}.left`, index, diagnostics, codePrefix);
}

/**
 * Validate a cover-crop focus anchor (0..1).
 */
function validateFocus(
    value: unknown,
    fieldName: string,
    index: number,
    diagnostics: MosaicDiagnostic[],
    codePrefix: string
): void {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        diagnostics.push({
            code: asDiagnosticCode(`${codePrefix}_INVALID_${fieldName.toUpperCase()}`),
            message: `Source[${index}] placement.${fieldName} must be a finite number in [0, 1] if set (received: ${String(value)}).`,
            severity: "error",
        });
    }
}

/**
 * Validate a source-rect window ({x,y,w,h} in SOURCE-native px). Only
 * media sources support it in v1 (`allowed: false` rejects presence).
 */
function validateSourceRect(
    rect: unknown,
    index: number,
    diagnostics: MosaicDiagnostic[],
    codePrefix: string,
    allowed: boolean
): void {
    if (rect === undefined) return;
    if (!allowed) {
        diagnostics.push({
            code: asDiagnosticCode(`${codePrefix}_SOURCERECT_UNSUPPORTED`),
            message: `Source[${index}] placement.sourceRect is only supported on media sources.`,
            severity: "error",
        });
        return;
    }
    const fail = (why: string) => {
        diagnostics.push({
            code: asDiagnosticCode(`${codePrefix}_INVALID_SOURCERECT`),
            message: `Source[${index}] placement.sourceRect ${why}`,
            severity: "error",
        });
    };
    if (typeof rect !== "object" || rect === null || Array.isArray(rect)) {
        fail(`must be an { x, y, w, h } object in source px (received: ${String(rect)}).`);
        return;
    }
    const r = rect as Record<string, unknown>;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (!finite(r.x) || r.x < 0 || !finite(r.y) || r.y < 0) {
        fail("x/y must be finite numbers >= 0 (source px).");
    }
    if (!finite(r.w) || r.w < 1 || !finite(r.h) || r.h < 1) {
        fail("w/h must be finite numbers >= 1 (source px).");
    }
}

/**
 * Shared placement validation.
 *
 * Invariants:
 * - fit: "contain" | "cover"
 * - contain: padding (MosaicBoxFrac) allowed, all sides must be in [0, 0.49]
 * - cover: padding must be absent (no dead space)
 * - inset (MosaicBoxFrac) allowed for both fits, all sides must be in [0, 0.49]
 * - focusX/focusY (cover-crop anchor): cover only, each in [0, 1]
 * - sourceRect (source-px window): media sources only; x/y >= 0, w/h >= 1
 */
function validatePlacement(
    placement: any,
    index: number,
    diagnostics: MosaicDiagnostic[],
    codePrefix: string,
    opts?: { allowSourceRect?: boolean }
) {
    if (!placement) return;

    //
    // sourceRect (media-only source-px window)
    //
    validateSourceRect(
        placement.sourceRect,
        index,
        diagnostics,
        codePrefix,
        opts?.allowSourceRect === true
    );

    //
    // placement.fit (optional, must be "contain" or "cover")
    //
    const fit = placement.fit;
    if (fit !== undefined && fit !== "contain" && fit !== "cover") {
        diagnostics.push({
            code: asDiagnosticCode(`${codePrefix}_INVALID_FIT`),
            message: `Source[${index}] placement.fit must be "contain" or "cover" if set (received: ${fit}).`,
            severity: "error",
        });
    }

    //
    // inset (MosaicBoxFrac)
    //
    validateBoxFrac(placement.inset, "inset", index, diagnostics, codePrefix);

    //
    // padding rules depend on fit
    //
    if (fit === "cover") {
        // cover: no dead space allowed
        if (placement.padding != null) {
            diagnostics.push({
                code: asDiagnosticCode(`${codePrefix}_COVER_PADDING`),
                message: `Source[${index}] placement.fit="cover" forbids padding.`,
                severity: "error",
            });
        }
        validateFocus(placement.focusX, "focusX", index, diagnostics, codePrefix);
        validateFocus(placement.focusY, "focusY", index, diagnostics, codePrefix);
    } else {
        // contain (or unspecified -> default contain): padding allowed but must be sane
        validateBoxFrac(placement.padding, "padding", index, diagnostics, codePrefix);

        // focus anchors the cover crop; contain never crops
        if (placement.focusX !== undefined || placement.focusY !== undefined) {
            diagnostics.push({
                code: asDiagnosticCode(`${codePrefix}_FOCUS_REQUIRES_COVER`),
                message: `Source[${index}] placement.focusX/focusY require placement.fit="cover" (contain never crops).`,
                severity: "error",
            });
        }
    }
}

function validateMediaSource(
    src: MosaicMediaSource,
    index: number,
    diagnostics: MosaicDiagnostic[],
    assets: MosaicAssetManifest,
) {
    // assetId — must be non-empty and resolve in the manifest
    const id = src.assetId;
    if (typeof id !== "string" || id.trim() === "") {
        diagnostics.push({
            code: asDiagnosticCode("MEDIA_ASSETID_EMPTY"),
            message: `Source[${index}] (media) must have a non-empty assetId.`,
            severity: "error",
        });
    } else {
        const entry = assets[id];
        if (entry == null) {
            diagnostics.push({
                code: asDiagnosticCode("MEDIA_ASSETID_UNKNOWN"),
                message: `Source[${index}] (media) references unknown assetId "${id}".`,
                severity: "error",
            });
        }
        // (Cross-kind checks: the on-disk MosaicAsset union is narrow
        //  enough — file / url / data-uri — that every kind can plausibly
        //  satisfy image / video / audio semantics. The engine handles the
        //  finer-grained checks at render time.)
    }

    // mediaType
    if (!["video", "image", "audio"].includes(src.mediaType)) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_MEDIA_TYPE"),
            message: `Source[${index}] has invalid mediaType "${src.mediaType}".`,
            severity: "error",
        });
    }

    // mask manifest reference
    validateMaskAgainstManifest(src.mask, index, diagnostics, assets);

    // wired effect knobs (rotate / blur / fades / grade / noise / pixelize / chromaKey)
    validateEffects(src.effects, index, diagnostics);

    // chromaKey is video-only: keying a still (or audio carrier) is a
    // per-frame pixel op on content that should take the host-raster path —
    // reject rather than silently paying it. Lavfi / video / nested mosaic
    // sources are video-like and pass.
    if (
        src.effects?.chromaKey !== undefined &&
        (src.mediaType === "image" || src.mediaType === "audio")
    ) {
        diagnostics.push({
            code: asDiagnosticCode("EFFECT_CHROMAKEY_MEDIA_TYPE"),
            message: `Source[${index}] effects.chromaKey is only valid on video-like sources; this media source has mediaType "${src.mediaType}".`,
            severity: "error",
        });
    }

    //
    // audio.volume (optional; a GAIN factor, not a 0..1 percentage)
    //
    // The engine lowers this straight onto ffmpeg's `volume=` filter, which
    // amplifies freely above 1.0 — and `MosaicAudioProps.volume` documents
    // "2 = double volume". A hard 1.0 ceiling here contradicted both and
    // rejected documents ffmpeg renders fine, so only genuinely
    // unrenderable values are errors: non-finite, or negative.
    //
    // Gains that far exceed unity still clip, and the classic way to get
    // one is typing a percentage (`volume: 100`), so those warn.
    const volume = src.audio?.volume;
    if (volume !== undefined && (!Number.isFinite(volume) || volume < 0)) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_VOLUME"),
            message: `Source[${index}] audio.volume must be a finite gain >= 0 if set (1 = unchanged, 2 = double; received: ${volume}).`,
            severity: "error",
        });
    } else if (volume !== undefined && volume > LOUD_GAIN_WARN) {
        diagnostics.push({
            code: asDiagnosticCode("LOUD_VOLUME"),
            message: `Source[${index}] audio.volume ${volume} amplifies well past unity and will almost certainly clip — volume is a GAIN factor (1 = unchanged), not a percentage.`,
            severity: "warning",
        });
    }

    //
    // playback.playSpeed (optional, must be > 0)
    //
    const playSpeed = src.playback?.playSpeed;
    if (
        playSpeed !== undefined &&
        (!Number.isFinite(playSpeed) || playSpeed <= 0)
    ) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_PLAY_SPEED"),
            message: `Source[${index}] playback.playSpeed must be > 0 if set (received: ${playSpeed}).`,
            severity: "error",
        });
    }

    //
    // visual.opacity (optional, must be [0,1])
    //
    const opacity = src.visual?.opacity;
    if (
        opacity !== undefined &&
        (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    ) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_OPACITY"),
            message: `Source[${index}] visual.opacity must be between 0.0 and 1.0 if set (received: ${opacity}).`,
            severity: "error",
        });
    }

    // NEW: placement invariants (fit + inset)
    validatePlacement(src.placement, index, diagnostics, "MEDIA_PLACEMENT", {
        allowSourceRect: true,
    });

    //
    // mediaType-specific soft checks
    //
    if (src.mediaType === "image") {
        if (src.audio?.enabled) {
            diagnostics.push({
                code: asDiagnosticCode("IMAGE_HAS_AUDIO"),
                message: `Source[${index}] is an image but audioEnabled=true; audio will be ignored.`,
                severity: "warning",
            });
        }
    }
}

function validateMosaicSource(
    src: MosaicMosaicSource,
    index: number,
    diagnostics: MosaicDiagnostic[],
    assets: MosaicAssetManifest,
) {
    validateMaskAgainstManifest(src.mask, index, diagnostics, assets);
    validateEffects(src.effects, index, diagnostics);
    // ref must be non-empty
    if (!src.ref || src.ref.trim() === "") {
        diagnostics.push({
            code: asDiagnosticCode("MOSAIC_REF_EMPTY"),
            message: `Source[${index}] (mosaic) must have a non-empty mosaic reference.`,
            severity: "error",
        });
    }

    //
    // audio.volume (optional; a GAIN factor — same rule as media sources)
    //
    const volume = src.audio?.volume;
    if (volume !== undefined && (!Number.isFinite(volume) || volume < 0)) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_MOSAIC_VOLUME"),
            message: `Source[${index}] audio.volume must be a finite gain >= 0 if set (1 = unchanged, 2 = double; received: ${volume}).`,
            severity: "error",
        });
    } else if (volume !== undefined && volume > LOUD_GAIN_WARN) {
        diagnostics.push({
            code: asDiagnosticCode("LOUD_VOLUME"),
            message: `Source[${index}] audio.volume ${volume} amplifies well past unity and will almost certainly clip — volume is a GAIN factor (1 = unchanged), not a percentage.`,
            severity: "warning",
        });
    }

    //
    // playback.playSpeed (optional, must be > 0)
    //
    const playSpeed = src.playback?.playSpeed;
    if (playSpeed !== undefined && (!Number.isFinite(playSpeed) || playSpeed <= 0)) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_MOSAIC_PLAY_SPEED"),
            message: `Source[${index}] playback.playSpeed must be > 0 if set (received: ${playSpeed}).`,
            severity: "error",
        });
    }

    //
    // visual.opacity (optional, must be [0,1])
    //
    const opacity = src.visual?.opacity;
    if (
        opacity !== undefined &&
        (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    ) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_MOSAIC_OPACITY"),
            message: `Source[${index}] visual.opacity must be between 0.0 and 1.0 if set (received: ${opacity}).`,
            severity: "error",
        });
    }

    // NEW: placement invariants (fit + inset)
    validatePlacement(src.placement, index, diagnostics, "MOSAIC_PLACEMENT");
}

function validateTextSource(
    src: MosaicTextSource,
    index: number,
    diagnostics: MosaicDiagnostic[],
    assets: MosaicAssetManifest,
) {
    validateMaskAgainstManifest(src.mask, index, diagnostics, assets);
    validateEffects(src.effects, index, diagnostics);
    // ---- SHAPE VALIDATION (new invariants) ----

    // layers required + non-empty
    if (!Array.isArray(src.layers) || src.layers.length === 0) {
        diagnostics.push({
            code: asDiagnosticCode("TEXT_LAYERS_EMPTY"),
            message: `Source[${index}] (text) must have non-empty layers[].`,
            severity: "error",
        });
        return;
    }

    // renderMode validation
    if (src.renderMode != null) {
        const kind = (src.renderMode as any).kind;
        if (kind !== "image" && kind !== "video") {
            diagnostics.push({
                code: asDiagnosticCode("TEXT_RENDER_MODE_INVALID"),
                message: `Source[${index}] (text) renderMode.kind must be "image" or "video" (received: ${String(
                    kind
                )}).`,
                severity: "error",
            });
        } else if (kind === "video") {
            const dur = (src.renderMode as any).durationMs;
            if (
                dur !== undefined &&
                (!Number.isFinite(dur) || dur <= 0)
            ) {
                diagnostics.push({
                    code: asDiagnosticCode("TEXT_RENDER_MODE_DURATION_INVALID"),
                    message: `Source[${index}] (text) renderMode.durationMs must be a finite number > 0 if set (received: ${dur}).`,
                    severity: "error",
                });
            }
        }
    }

    // rasterizer validation
    if (src.rasterizer != null) {
        const rz = src.rasterizer as unknown;
        if (rz !== "drawtext" && rz !== "svg") {
            diagnostics.push({
                code: asDiagnosticCode("TEXT_RASTERIZER_INVALID"),
                message: `Source[${index}] (text) rasterizer must be "drawtext" or "svg" (received: ${String(
                    rz
                )}).`,
                severity: "error",
            });
        }
    }

    // fontWeight / fontStyle validation (base style + each layer's style override).
    const validateTextStyle = (style: any, label: string) => {
        if (style == null) return;
        const w = style.fontWeight;
        if (w !== undefined) {
            const ok =
                w === "normal" ||
                w === "bold" ||
                (typeof w === "number" && Number.isFinite(w) && w >= 1 && w <= 1000);
            if (!ok) {
                diagnostics.push({
                    code: asDiagnosticCode("TEXT_FONT_WEIGHT_INVALID"),
                    message: `Source[${index}] (text) ${label} fontWeight must be a number 1–1000 or "normal"/"bold" (received: ${String(
                        w
                    )}).`,
                    severity: "error",
                });
            }
        }
        const s = style.fontStyle;
        if (s !== undefined && s !== "normal" && s !== "italic") {
            diagnostics.push({
                code: asDiagnosticCode("TEXT_FONT_STYLE_INVALID"),
                message: `Source[${index}] (text) ${label} fontStyle must be "normal" or "italic" (received: ${String(
                    s
                )}).`,
                severity: "error",
            });
        }
    };
    validateTextStyle(src.style, "style");

    let hasFrameEvalExpr = false;

    src.layers.forEach((layer, layerIndex) => {
        validateTextStyle((layer as any).style, `layer[${layerIndex}].style`);
        const content = (layer as any).content;

        if (content == null || typeof content !== "object") {
            diagnostics.push({
                code: asDiagnosticCode("TEXT_LAYER_CONTENT_MISSING"),
                message: `Source[${index}] (text) layer[${layerIndex}] must have content.`,
                severity: "error",
            });
            return;
        }

        const kind = (content as any).kind;
        if (kind !== "literal" && kind !== "expr") {
            diagnostics.push({
                code: asDiagnosticCode("TEXT_LAYER_CONTENT_KIND_INVALID"),
                message: `Source[${index}] (text) layer[${layerIndex}] content.kind must be "literal" or "expr" (received: ${String(
                    kind
                )}).`,
                severity: "error",
            });
            return;
        }

        if (kind === "literal") {
            const text = (content as any).text;
            if (typeof text !== "string") {
                diagnostics.push({
                    code: asDiagnosticCode("TEXT_LAYER_LITERAL_TEXT_INVALID"),
                    message: `Source[${index}] (text) layer[${layerIndex}] literal text must be a string (received: ${typeof text}).`,
                    severity: "error",
                });
            }
            // Allow empty string for "background-only" use-cases.
        }

        if (kind === "expr") {
            const expr = (content as any).expr;
            const evalMode = (content as any).eval;

            if (typeof expr !== "string" || expr.trim() === "") {
                diagnostics.push({
                    code: asDiagnosticCode("TEXT_LAYER_EXPR_INVALID"),
                    message: `Source[${index}] (text) layer[${layerIndex}] expr must be a non-empty string.`,
                    severity: "error",
                });
            }

            if (evalMode !== undefined && evalMode !== "once" && evalMode !== "frame") {
                diagnostics.push({
                    code: asDiagnosticCode("TEXT_LAYER_EVAL_INVALID"),
                    message: `Source[${index}] (text) layer[${layerIndex}] content.eval must be "once" or "frame" if set (received: ${String(
                        evalMode
                    )}).`,
                    severity: "error",
                });
            }

            if ((evalMode ?? "frame") === "frame") {
                hasFrameEvalExpr = true;
            }
        }
    });

    // Cross-check: frame-eval expressions don't make sense in renderMode=image
    if (hasFrameEvalExpr && src.renderMode?.kind === "image") {
        diagnostics.push({
            code: asDiagnosticCode("TEXT_EXPR_FRAME_WITH_IMAGE_RENDER_MODE"),
            message: `Source[${index}] (text) has expr content with eval="frame" but renderMode.kind="image". The expression will not animate.`,
            severity: "warning",
        });
    }

    // ---- EXISTING VALIDATION (keep your current checks) ----

    const style = src.style;
    if (!style) {
        // no style → nothing else to validate
        return;
    }

    // fontSize
    if (
        style.fontSize !== undefined &&
        (!Number.isFinite(style.fontSize) || style.fontSize <= 0)
    ) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_FONT_SIZE"),
            message: `Source[${index}] style.fontSize must be > 0 if set (received: ${style.fontSize}).`,
            severity: "error",
        });
    }

    // opacity
    const opacity = src.visual?.opacity;
    if (
        opacity !== undefined &&
        (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    ) {
        diagnostics.push({
            code: asDiagnosticCode("INVALID_TEXT_OPACITY"),
            message: `Source[${index}] visual.opacity must be between 0.0 and 1.0 if set (received: ${opacity}).`,
            severity: "error",
        });
    }

    // NEW: placement invariants (fit + inset)
    validatePlacement(src.placement, index, diagnostics, "TEXT_PLACEMENT");
}
