# Parking Lot

Deferred items — work that's known and scoped but waiting on outside input, a decision, or a time slot.

## Configure Google Maps API key for address autocomplete
- **Where:** Registration form (`register.html`) has address autocomplete code wired up; it activates only when `GOOGLE_MAPS_API_KEY` is returned from `GET /api/tour?config=1`.
- **Status:** Currently the production endpoint returns `{ "googleMapsApiKey": null }`, so the field falls through to a plain text input.
- **What to do:**
  1. In Google Cloud Console (https://console.cloud.google.com/google/maps-apis), create or reuse an API key and enable the **Places API** (or **Places API (New)**) on it.
  2. Restrict the key by HTTP referrer to `roots-and-wings-topaz.vercel.app/*` (and the custom GoDaddy domain once live).
  3. Add the key to Vercel → Project Settings → Environment Variables as `GOOGLE_MAPS_API_KEY` for Production + Preview + Development (or `vercel env add GOOGLE_MAPS_API_KEY`).
  4. Trigger a redeploy so the new env var is live.
- **Verify:** Hit `/api/tour?config=1` and confirm the key is present; open the registration form and start typing into the Address field — the hint below should flip to "Suggestions powered by Google Maps."
