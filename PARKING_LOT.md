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
