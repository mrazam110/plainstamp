# ADR 0008: Project name

Status: Accepted (2026-10-18), pending trademark and product check

Context: Name should work for any country, not suggest an official body, and be available. Checked 2026-10-16 to 2026-10-18 with a GitHub user/org lookup and DNS (not a trademark search). Ruled out: Stampt (taken everywhere, was a 2011 loyalty-card startup), Waypost (taken). Other candidates looked at: Formsherpa, Formcompass, Stampwell, Queuewise, Germanpaperwork.

Decision: **Plainstamp.** "Plain" for plain-language explanations, "stamp" for the official stamp. Country goes in the tagline ("Plainstamp: German bureaucracy, explained"), so other countries can reuse the name. On 2026-10-18 the GitHub name and the .com, .org, .app, .io and .dev domains showed no existing registration (DNS only, unconfirmed at a registrar).

To do before the public flip:
- Free trademark search: EUIPO TMview, DPMA register.
- Confirm the domain(s) and the GitHub name at a registrar and on GitHub; register what we want.
- Web search for similar products in forms, document or government software.
- Check the name does not look official (no government colours, crests or logos).
- Fallbacks if a conflict appears: Formcompass, Formsherpa, Stampwell.

Consequences: Working folder name `askmeanything` stays until the repo is created; the repo, package names and UI use Plainstamp. Names are config-level only, so a rename is one commit.
