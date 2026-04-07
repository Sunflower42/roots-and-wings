// Shared configuration for /api/* endpoints.
// Underscore prefix prevents Vercel from exposing this as a route.

// Allowed origins for CORS. Same-origin requests (page and API on the
// same Vercel domain) don't need to match this list — it only matters
// for cross-origin callers (custom domains, local dev, etc.).
const ALLOWED_ORIGINS = [
  'https://roots-and-wings-topaz.vercel.app'
  // Add custom domain here when configured, e.g. 'https://rootsandwingsindy.com'
];

module.exports = { ALLOWED_ORIGINS };
