/**
 * Ambient template-origin scope.
 *
 * Who is registering right now: first-party (the default) or an external repo
 * the host opened a scope for via `withExternalTemplateOrigin`. Two readers:
 *
 *  - the registry, which screens external registrations against the reserved
 *    namespace and existing ownership; and
 *  - `defineMosaicTemplate`, which picks the convention posture from it —
 *    THROW for first-party, RECORD inside an external scope ("one bad template
 *    in a repo can't abort the rest of the load"). A repo's own module body
 *    calls `defineMosaicTemplate` directly at import, never through
 *    `registerTemplate`, so the wrapper has to read the scope itself.
 *
 * It lives in its own module because registry → define → registry would be an
 * import cycle. The state is process-global (see `../processRegistry`) so a
 * hot reload and a repo's own copy of this package read the same scope.
 */
import { processRegistry } from "../processRegistry";

/** Who registered an id. `source` is the repo path/URL the user opted into. */
export type TemplateOrigin =
  | { kind: "first-party" }
  | {
      kind: "external";
      source: string;
      /**
       * Reserved id prefixes this source may register under anyway. Only a
       * HOST sets this, and only for repos it pins itself (the bundled seed /
       * app-managed copy of the official community repo) — never derived from
       * anything the repo declares about itself. Ownership screening still
       * applies: a trusted namespace lets a source claim unoccupied reserved
       * ids, not overwrite someone else's.
       */
      trustedNamespaces?: readonly string[];
    };

export const FIRST_PARTY_TEMPLATE_ORIGIN: TemplateOrigin = { kind: "first-party" };

/**
 * Ambient registration state: the origin currently in scope (`"origin"`) and
 * the registration rejections recorded since the last drain (`"rejections"`).
 * The registry owns the writes; this module only names the store.
 */
export const templateRegistrationState = processRegistry<string, unknown>(
  "templateRegistrationState",
);

/** The origin in scope right now — first-party unless a host opened an external scope. */
export function currentTemplateOrigin(): TemplateOrigin {
  return (
    (templateRegistrationState.get("origin") as TemplateOrigin | undefined) ??
    FIRST_PARTY_TEMPLATE_ORIGIN
  );
}
