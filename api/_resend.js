// Thin wrapper around the Resend SDK that redirects all outbound mail
// to EMAIL_OVERRIDE_TO when that env var is set. Used in dev / preview
// so test registrations + waiver-sign flows don't bombard real members
// (membership@, treasurer@, comms@, the test recipient inbox, etc.).
//
// Behavior:
//   - EMAIL_OVERRIDE_TO unset: passthrough — payload sent as-is.
//   - EMAIL_OVERRIDE_TO set:   to/cc/bcc replaced with the override
//                              address. Subject gets a "[DEV]" prefix
//                              (in addition to any prior [TEST] prefix
//                              from emailSubject). HTML body is prefixed
//                              with a banner listing the original
//                              recipients so reviewers can confirm who
//                              would have received it in prod.
//
// Recommended setup: set EMAIL_OVERRIDE_TO in Vercel env vars scoped
// to Preview + Development only. Production should never have it set.

const { Resend: _Resend } = require('resend');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtRecipients(v) {
  if (v == null || v === '') return '(none)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(none)';
  return String(v);
}

class Resend {
  constructor(apiKey) {
    const inner = new _Resend(apiKey);
    const overrideTo = (process.env.EMAIL_OVERRIDE_TO || '').trim();
    // Hard guard: production MUST NEVER re-route mail or prepend [DEV],
    // even if EMAIL_OVERRIDE_TO leaks into the prod env (marketplace
    // integrations, accidental scope edits, etc.). Real recipients only.
    const isProd = process.env.VERCEL_ENV === 'production';

    this.emails = {
      send: async (payload) => {
        if (isProd || !overrideTo) return inner.emails.send(payload);

        const banner =
          '<div style="background:#fff8e1;border:1px solid #f0c14b;color:#6b4e00;' +
          'padding:10px 14px;border-radius:6px;margin-bottom:16px;font-family:sans-serif;' +
          'font-size:13px;line-height:1.5;">' +
          '<strong>[DEV redirect]</strong> EMAIL_OVERRIDE_TO is set, so this message ' +
          'was rerouted from its real recipients. In production it would have gone to:' +
          '<br><strong>to:</strong> ' + escapeHtml(fmtRecipients(payload.to)) +
          '<br><strong>cc:</strong> ' + escapeHtml(fmtRecipients(payload.cc)) +
          '<br><strong>bcc:</strong> ' + escapeHtml(fmtRecipients(payload.bcc)) +
          '</div>';

        const wrapped = Object.assign({}, payload, {
          to: overrideTo,
          cc: undefined,
          bcc: undefined,
          subject: '[DEV] ' + (payload.subject || ''),
          html: banner + (payload.html || '')
        });
        return inner.emails.send(wrapped);
      }
    };
  }
}

module.exports = { Resend };
