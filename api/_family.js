// Family-membership resolver.
//
// Originally Phase 3 of the directory→DB migration; rewritten when the
// `people` table replaced `member_profiles.parents` JSONB. The lookup
// chain is now:
//   1. JWT email matches member_profiles.family_email directly (the primary
//      parent / family PK).
//   2. JWT email matches a row in `people` (a co-parent or other adult).
//   3. (Compat) JWT email matches member_profiles.additional_emails — kept
//      so families that haven't been backfilled into `people` yet still
//      resolve. Drop in a follow-up after a few days of clean prod runs.
//
// Email matching is case-insensitive on both sides.

function normalizeEmail(e) {
  return e ? String(e).trim().toLowerCase() : '';
}

// Find the member_profiles row owned by this login email. Returns null if
// the email isn't tied to any family.
async function resolveFamily(sql, userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return null;
  const rows = await sql`
    SELECT family_email, family_name, phone, address,
           parents, kids, placement_notes, additional_emails
    FROM member_profiles
    WHERE LOWER(family_email) = ${email}
       OR EXISTS (
         SELECT 1 FROM people p
         WHERE p.family_email = member_profiles.family_email
           AND LOWER(p.email) = ${email}
       )
       OR EXISTS (
         SELECT 1 FROM unnest(additional_emails) ae
         WHERE LOWER(ae) = ${email}
       )
    LIMIT 1
  `;
  return rows[0] || null;
}

// True iff userEmail is allowed to act for the family identified by
// targetFamilyEmail. Matches when:
//   - userEmail equals targetFamilyEmail (the primary parent), or
//   - userEmail belongs to a `people` row whose family_email = targetFamilyEmail
//     (co-parents and other adults), or
//   - userEmail appears in that family's additional_emails (legacy fallback).
// Super-user override is intentionally NOT folded in here — call sites add
// their own super-user short-circuit so this helper stays focused.
async function canActAs(sql, userEmail, targetFamilyEmail) {
  const u = normalizeEmail(userEmail);
  const t = normalizeEmail(targetFamilyEmail);
  if (!u || !t) return false;
  if (u === t) return true;
  const rows = await sql`
    SELECT 1 FROM member_profiles
    WHERE LOWER(family_email) = ${t}
      AND (
        EXISTS (
          SELECT 1 FROM people p
          WHERE p.family_email = member_profiles.family_email
            AND LOWER(p.email) = ${u}
        )
        OR EXISTS (
          SELECT 1 FROM unnest(additional_emails) ae
          WHERE LOWER(ae) = ${u}
        )
      )
    LIMIT 1
  `;
  return rows.length > 0;
}

module.exports = {
  resolveFamily,
  canActAs,
  // Exported for tests:
  _normalizeEmail: normalizeEmail
};
