# Parking Lot

Deferred items — work that's known and scoped but waiting on outside input, a decision, or a time slot.

## Member onboarding — full automation (Aug 2026 target)

- **Status:** Phase 1 (manual checklist + welcome-email queue) shipped 2026-04-27. Phase 2 = automate the manual steps.
- **Goal:** When a family becomes paid + signed, automatically (a) create their @rootsandwingsindy.com Workspace account, (b) add them to the `currentmembers` distribution list, (c) send the welcome email with the auto-generated password reset link. Same automation in reverse for non-renewers at the Aug 13 cutoff.
- **What's needed:**
  1. Expand the GCP service account's domain-wide-delegation scopes from read-only to include `https://www.googleapis.com/auth/admin.directory.user` and `https://www.googleapis.com/auth/admin.directory.group.member`. Subject `communications@rootsandwingsindy.com` (already used for `/api/photos`).
  2. New `api/onboarding.js` endpoint or extend `api/tour.js`: POST `kind:'auto-onboard'` calls `admin.users.insert` (with `changePasswordAtNextLogin: true` and a generated temp password), `admin.members.insert` for `currentmembers@rootsandwingsindy.com`, then sends the welcome email with the temp password embedded.
  3. UI: "Auto-Onboard" button replaces the per-step checkboxes for new families. Manual checklist stays as a fallback.
  4. Removal: same shape — `admin.users.delete` (or `suspend`) + `admin.members.delete` + log to a `member_removals` table.
- **Open questions:**
  - Workspace email convention: today the directory derivation is `firstname + lastinitial@`. Auto-create should follow that, or let Comms pick? Latter requires a confirm-name dialog before insert.
  - Suspend vs delete for non-renewers: suspend keeps the email reachable in case they return; delete frees the seat but loses history.
  - Temp password handling: include in the welcome email (low security but practical) or send separately? Today Comms handles this verbally.
- **Why parked:** Phase 1 covers the actual day-to-day pain (forgetting a step, no audit trail). Automation is nice-to-have but adds GCP scope risk and surface area; revisit when Comms says manual steps are the bottleneck or once the new-member volume justifies it.

## Configure Google Maps API key for address autocomplete
- **Where:** Registration form (`register.html`) has address autocomplete code wired up; it activates only when `GOOGLE_MAPS_API_KEY` is returned from `GET /api/tour?config=1`.
- **Status:** Currently the production endpoint returns `{ "googleMapsApiKey": null }`, so the field falls through to a plain text input.
- **Blocker:** Needs the Treasurer — Google Cloud project requires a billing account, which should come from the co-op's card, not Erin's personal card. Also sanity-check with Treasurer that the free-tier usage ($200/mo credit, ~28k Places sessions — way more than we'll use for a member registration form) won't trigger surprise charges.
- **What to do:**
  1. Treasurer creates/reuses a Google Cloud project at https://console.cloud.google.com/ and attaches a billing account (co-op card)
  2. Enable **Places API (New)** AND **Maps JavaScript API** in APIs & Services → Library
  3. APIs & Services → Credentials → Create Credentials → API key. Copy the `AIzaSy…` string.
  4. Restrict the key: Application restrictions → HTTP referrers → `roots-and-wings-topaz.vercel.app/*` (and the custom GoDaddy domain once live). API restrictions → restrict to the two APIs enabled above.
  5. Add to Vercel → Settings → Environment Variables as `GOOGLE_MAPS_API_KEY` for Production + Preview + Development
  6. Redeploy (or wait for next push) so the new env var is live
- **Verify:** Open `/register.html`, focus the Address field; the hint below should read "Suggestions powered by Google Maps." (instead of "Enter your full street address, city, and ZIP.")

## Draft-registration / funnel tracking for Membership Director
- **Goal:** Give the Membership Director visibility into families who filled out the registration form but didn't complete payment, so she can follow up before they fully bail.
- **Current state:** Registration only writes to DB + Sheet *after* PayPal captures the payment. Form drop-offs are invisible — if a family hits a PayPal error (like the NOT_AUTHORIZED one above), their data vanishes when they close the tab.
- **Why not just save-always:** Saving pre-payment rows would clutter the Membership Report with non-paying registrations, and would trigger the confirmation email + backup-coach waiver emails for people who haven't paid — confusing for families and coaches. Needs its own status lane, not a field on the existing row.
- **Sketch:**
  1. Add a `draft_registrations` table (or a `status` column on `registrations` with values `draft | paid | abandoned`) — keep draft rows separate so the Report filters cleanly.
  2. Client: write a draft row when the form reaches step 2 (post-validation, pre-payment). Dedupe by email + season. Update the row on each subsequent step so we capture the latest state if they re-try.
  3. Server: `POST /api/tour` with `kind: 'registration-draft'` — no payment required, no emails sent.
  4. Promote draft → paid registration when PayPal captures (the existing `handleRegistration` path copies the data across or flips the status, then fires the confirmation + backup-coach emails as usual).
  5. UI: Membership Report gets a second section or tab — "In progress (unpaid)" — listing draft rows with "Last touched" timestamp so the Director knows who to follow up with. Show the contact info + what step they stopped at.
- **Open questions:**
  - Privacy: families haven't paid, so we're capturing PII for people who never joined. Auto-purge drafts after 30 days? Add a line to the form telling them we save progress?
  - Should a "draft" still count toward the unique-email constraint, or only paid registrations? Current constraint is on paid rows; draft-and-retry should not block the paid flow.
- **Priority:** Nice-to-have, not urgent. Land the PayPal fix first — otherwise we'd just be tracking 100% failures.

## Google Chat Spaces directory
- **Goal:** Help new (and existing) members discover the co-op's Google Chat spaces. Today people learn about Field Trips / Camp / Special Events / Announcements / etc. by word of mouth, and miss spaces they'd want to be in.
- **Why this and not deeper Chat integration:** The co-op already lives in Chat — that's where the social energy is. The portal's job is the structured layer (rosters, dates, payment state); Chat stays the discussion layer. A directory bridges the two without trying to pull threads into the portal (Google Chat's API is restrictive and would fight the way people actually use it).
- **Sketch:**
  1. New "Co-op Spaces" page (or a card on the home / onboarding pages) listing each Chat space.
  2. Per space: name, one-line purpose ("Field trip planning + RSVPs"), who it's for ("All members" / "Camp families only" / "Board"), and a "Join in Google Chat" deep link.
  3. Source of truth options: hard-coded in a JS constant for v1 (cheap, fine for ~10 spaces), or a `chat_spaces` DB table editable by Comms (cleaner if the list churns).
  4. Surface the directory in the Member Onboarding workflow so welcome emails / new-family checklists point at it.
- **Open questions:**
  - Are Chat space join links stable / shareable, or do people need to be invited individually? Verify before promising a one-click join.
  - Public-facing too (rootsandwingsindy.com), or members-portal only? Some spaces are board-only and shouldn't be advertised broadly.
- **Future extension (not in scope here):** outbound webhooks from portal → relevant Chat space when structured events happen (new field trip added, camp registration opens, payment due). Decide on spaces directory first; this is a separate parking-lot item if it becomes interesting.
- **Priority:** Low. Onboarding pain is real but not bleeding; revisit when the next batch of new families joins.

## Directory migration: DB as source of truth + co-parent self-service login

End-state goal: a co-parent (e.g. Jay Shewan, with login `jays@rootsandwingsindy.com`) can sign in with their own Workspace credentials and manage their own profile + their kids' info, without sharing the family's primary login. This is a recurring need ("we will have more of these as well").

Phased so the auth path doesn't all change at once.

### Phase 1 — Add Jay as DB-only co-parent (DONE)
- Append Jay to Jessica's `member_profiles.parents` JSONB. The existing `applyMemberProfileOverlay` already grafts DB-only parents onto the family list, so he shows up in the roster, with pronouns/photo, immediately.
- He continues to log in via `jessicas@…` for now (shared family login).
- Reusable `scripts/add-coparent.js` script handles future co-parent additions.

### Phase 2 — Flip the live read path to DB-source-of-truth
- **What:** Replace `parseDirectory(dirTab)` → `FAMILIES` in `api/sheets.js` with a DB read from `member_profiles`. Keep the Classlist tab read (kid → group mapping) and Allergies tab read.
- **Risk:** Hot-path change — every page hits this. Guard with a "DB has rows? use DB; else fall back to sheet" feature-detect for the first deploy, so we can roll back trivially.
- **Pre-req:** Run `seed-profiles-from-sheet.js` so every current Directory family has a `member_profiles` row. The seed is already idempotent.
- **Out of scope here:** auth/login changes (Phase 3).

### Phase 3 — Secondary-email login resolution (the destination)
- **What:** Let an authenticated `jays@…` resolve to the Shewan family for both data lookup and authorization checks. Means co-parents can self-serve.
- **Schema option A:** add `additional_emails TEXT[] NOT NULL DEFAULT '{}'` to `member_profiles`. Lookup becomes `WHERE family_email = $1 OR $1 = ANY(additional_emails)`.
- **Schema option B:** new `member_logins (login_email PK, family_email REFERENCES member_profiles)` table — cleaner, more normalized, easier to audit who-can-act-as-which-family.
- **Touch points** (all currently `family_email = userEmail`):
  - `api/tour.js` — profile read/write, photo upload, registration owner check, `/api/tour?action=family-profile-*`
  - `api/absences.js:185` — cancellation ownership
  - `api/coverage.js` — claim notifications target
  - `api/photos.js` — derivation lookup
  - `api/_permissions.js buildDirectoryEmailMap` — also used by role-holder lookup; needs to learn about additional emails for the multi-login family
- **Plan:** centralize the "is this email a member of this family?" check into a helper (`isFamilyMember(userEmail, familyEmail, sql)`) and replace direct comparisons one file at a time. Add a regression test (`scripts/test-coparent-auth.js`) that exercises the alias path before flipping any single check.
- **Migration:** for each existing family with a real co-parent (Jay Shewan + future ones), populate `additional_emails` (or `member_logins` rows). Existing single-login families keep `additional_emails` empty.
- **Auth-path scope = real risk:** miss one comparison and a co-parent silently can't claim coverage / can't edit their kids / etc. The test script is mandatory before this phase ships.

## ~~Convert remaining Workspace reports to the standard modal pattern~~ — DONE 2026-04-30

All five Workspace reports now share the same modal shell: Participation Tracker, PM Class Submissions, Membership Report, Waivers Report, and Roles Manager. Roles Manager is the only one that keeps a tree body (forced flat would lose the board → committee → role hierarchy that's its whole reason for existing) — it adopts `renderReportModal` chrome (Add Role + Export CSV icons) + close behavior + width without forcing the column convention. The other four follow the full tabular convention: row identifier → status pill → domain columns → trailing Actions column + expandable row for context. See `feedback_rw_report_modal_standard.md` (auto-memory) for the full convention.

### Resolved 2026-04-30: row actions live in a far-right Actions column + the row stays expandable
The standard pattern is: per-row action buttons always sit in a trailing **Actions** column (so they're visible without clicking through), and the row also expands into a detail panel for richer context (kid list, signature state, sender note, etc.). Confirm UI for actions that need a note/textarea (e.g. Decline) renders at the **top** of the expansion when the user clicks the action — the click programmatically expands the row via `containerEl._expandRow(idx)` exposed by `renderSortableTable`. Action button clicks themselves are excluded from the row-expand handler via the `e.target.closest('button, a, input, label, select, textarea, .ws-srt-actions')` guard. PM Class Submissions retains the same Actions column (Approve / Decline / Re-queue) without expansion, since its rows have no extra context worth a panel.

## BLC Workspace account flow (on-request provisioning)

- **Status:** Auto-derivation removed 2026-04-29 — the Directory and member-lookup paths no longer surface a `firstname+lastinitial@rootsandwingsindy.com` for BLCs by default. Need to design the explicit "request → grant" flow.
- **Why:** Most BLCs (grandparents, friends, occasional spouses) don't need their own Workspace login — they just sign waivers via the public link. Auto-creating accounts pollutes the directory with addresses that 404, and burns Workspace seats. MLCs always get one (it's their family's primary login); BLCs should be opt-in.
- **What's needed:**
  1. **UI surface for request.** EMI's BLC row could grow an "Request a Workspace login for this person" button → fires a request email to `communications@` with the BLC's name + family + intended email. Or a dedicated "Co-parent access" admin page in the Membership widget.
  2. **Comms-side grant flow.** Comms creates the Workspace account via Admin (or via the future `auto-onboard` automation — see "Member onboarding — full automation"), then types the new email into the BLC's row in EMI. That populates `member_profiles.parents[i].email`, which automatically gets added to `additional_emails` (handleProfileUpdate already derives it from non-MLC parent rows). At that point `resolveFamily` finds them by their own email and the participation guard correctly identifies them.
  3. **Audit:** capture `created_at`, `created_by` on the BLC's parent entry so we can tell who's been provisioned and when. Maybe a simple `member_login_grants` table if we want history; otherwise piggyback on the existing `updated_by` column.
  4. **Removal:** when a BLC leaves (divorced, no longer in the family), Comms should be able to revoke. Today nothing prevents the existing email from being used — needs the same `admin.users.delete` path the main onboarding parking-lot item describes.
- **Open questions:**
  - Should the BLC themselves be able to request via the public site (with their MLC's approval), or strictly MLC-initiated from EMI?
  - Email convention when the BLC has their own surname (Brian Richter married into the Shewan family): `brianr@` (his initial) or `brians@` (Shewan's initial)? Pick one and document.
  - How does this interact with the auto-onboarding parking-lot item — same automation path or a separate flow?
- **Priority:** Low until a real request comes in. The current set of co-parents with their own accounts (Jay Shewan, Brian Richter) were granted manually and are working fine.

## Family data model: Main Learning Coach + Back Up Learning Coach

End-state goal: align the portal's family data model with the vocabulary already used by registration + waivers — Main Learning Coach (MLC) and Back Up Learning Coach (BLC) — instead of a generic "parents" list. Each role gets its own contact info (name, email, phone, pronouns, photo). Subsumes the Phase 3 co-parent story into a clearer primary/backup model and gives every role-holder its own phone number (today there's one phone per family).

**Depends on:** Phase 3 merged first. This work is a real schema + UI refactor and shouldn't be layered onto the in-flight Phase 3 branch.

**Schema sketch (not final — pick once we start):**
- **Option A (cleanest):** extend the existing `member_profiles.parents` JSONB so each entry has `{ name, role: 'mlc'|'blc'|'parent', email, phone, pronouns, photo_url, photo_consent }`. First MLC entry's email becomes `family_email` (current PK). Subsequent BLC/parent emails go in (or replace) `additional_emails`. Drops the family-level `phone` column once UI is migrated.
- **Option B:** dedicated `member_contacts(family_email, role, name, email, phone, ...)` table. More normalized; more code changes.

**Touch points:**
- Migration: backfill MLC role on the first parent of every existing row; copy family-level `phone` onto the MLC entry. BLC defaults to null.
- `api/tour.js` registration intake: registration already collects MLC + BLC fields — verify and route into the new shape.
- `api/tour.js` family profile read/write: sanitizeParent gains email + phone + role.
- `api/_family.js`: `additional_emails` can probably be derived from the BLC entry's email instead of being a separate column. Decide whether to keep `additional_emails` for non-BLC aliases or retire it.
- Edit My Info form (`renderEMI…` in script.js): per-parent phone + email + role label.
- Display surfaces: My Family card, Directory detail card, parent detail popups — show MLC + BLC roles + per-person contact instead of family-level phone.
- Waivers: existing waiver flows already differentiate MLC vs BLC; map them to the DB shape.
- Notifications: route based on role (e.g., absences notify MLC primarily, BLC as fallback).

**Open questions:**
- Families with 3+ adults (multi-generational, divorced+remarried) — keep generic 'parent' role for the extras, or limit to MLC/BLC only?
- Single-parent families: MLC required, BLC optional. Confirm.
- The Directory sheet still drives some name parsing — does the MLC concept eventually replace the Directory sheet entirely (Phase 2 read-path flip), or stay layered on top?

**Estimated:** 4–8 hours focused work post-Phase 3 merge.

## Drop legacy waiver tables + columns

End-state: remove `backup_coach_waivers`, `one_off_waivers`, and the `registrations.signature_*` / `waiver_*` / `student_signature` columns now that everything reads/writes through `waiver_signatures` (shipped 2026-05-01).

**Soak first.** Before dropping anything, confirm in prod that:
- `waiver_signatures` has rows with `waiver_version = '2026-05-01'` (proves new code path is being exercised).
- No recent Vercel error logs reference `backup_coach_waivers` or `one_off_waivers`.
- A few real signings have flowed through cleanly (registration MLC, backup-coach token sign, Comms one-off send + sign).

**Phase A — safe to drop after 2-week soak (~2026-05-15):**
- `DROP TABLE IF EXISTS backup_coach_waivers;`
- `DROP TABLE IF EXISTS one_off_waivers;`
- These are no longer written to by any code path (verified at ship time). Backfilled rows are duplicated in `waiver_signatures`.

**Phase B — needs prep work first:**
- `registrations.signature_name`, `signature_date`, `waiver_member_agreement`, `waiver_photo_consent`, `waiver_liability`, `student_signature` are still being written by `api/tour.js` registration insert (they're NOT NULL).
- Adult-student signatures live ONLY in `student_signature` — they don't have their own `waiver_signatures` rows yet. The Waivers Report parses them out of that column at read time (api/tour.js `regsForStudents`).
- Before dropping, either: (1) migrate adult-student rows into `waiver_signatures` with a new role like `'adult_student'`, OR (2) accept losing them and update the Waivers Report.
- Then drop the columns and remove the writes from the registration insert path.

**Estimated:** Phase A is 15 min (2-line migration + run). Phase B is 1–2 hours.

## Rotate GOOGLE_SERVICE_ACCOUNT_KEY (blocked by org policy)

Vercel flagged `GOOGLE_SERVICE_ACCOUNT_KEY` as "Needs Attention" — its value was created without the Sensitive flag, so it was readable by anyone with project access. Should be rotated + saved as Sensitive.

**Blocker:** Google Cloud project `rw-members-auth` has an organization policy enforced — `iam.disableServiceAccountKeyCreation` — that prevents creating new service-account JSON keys. Rotating the existing key requires resolving this first.

**Options to unblock:**
- **Temporarily lift the policy** (Workspace admin): Cloud Console → IAM & Admin → Organization Policies → search for "Disable service account key creation" → temporarily set Enforcement = Off (or scope an exception to project `rw-members-auth`) → create the new key → re-enable the policy.
- **Use Workload Identity Federation instead:** Configure Vercel as a trusted OIDC issuer to Google Cloud, then have Vercel exchange its short-lived OIDC token for a Google access token. No long-lived key file. Bigger lift — would touch `api/sheets.js getAuth()` to use the federation flow.
- **Use a different service account in a project without the policy:** Spin up a new service account in a project that allows key creation (or in a personal Google Cloud project), grant it sheet access, swap its key in. Sidesteps the org policy without needing admin to flip it.

**Recommended:** Temporarily lift the policy for the rotation, then re-enable. Fastest. ~10 min once admin access is sorted.

**Once unblocked, the rotation steps are:**
1. Cloud Console → Service Accounts → `rw-sheets-reader@rw-members-auth.iam.gserviceaccount.com` → Keys → Add Key → Create new (JSON) → save the file.
2. Copy the entire JSON contents into Vercel: `GOOGLE_SERVICE_ACCOUNT_KEY` → Rotate Variable → paste → Sensitive ON → Save. Note: Sensitive can't combine with Development scope; drop Development if needed (only affects local `vercel dev` Sheets access — `rw-dev` Preview and prod still work).
3. `npm run deploy:dev` → verify directory loads on `rw-dev.vercel.app/members.html` and `roots-and-wings-topaz.vercel.app/members.html`.
4. Cloud Console → delete the OLD key from the Keys tab.
5. Confirm Vercel's revocation prompt.

**Estimated:** 15 min once the org policy is sorted.
