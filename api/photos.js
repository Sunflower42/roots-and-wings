const { google } = require('googleapis');
const { ALLOWED_ORIGINS } = require('./_config');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = '915526936965-ibd6qsd075dabjvuouon38n7ceq4p01i.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'rootsandwingsindy.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleAuth(req) {
  var authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    var ticket = await oauthClient.verifyIdToken({
      idToken: authHeader.slice(7),
      audience: GOOGLE_CLIENT_ID
    });
    var payload = ticket.getPayload();
    var domain = (payload.email || '').split('@')[1] || '';
    return domain === ALLOWED_DOMAIN;
  } catch (e) {
    return false;
  }
}

function getAdminAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
    clientOptions: {
      subject: 'communications@rootsandwingsindy.com'
    }
  });
  return auth;
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Require authenticated @rootsandwingsindy.com Google account
  if (!(await verifyGoogleAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var auth = getAdminAuth();
    var admin = google.admin({ version: 'directory_v1', auth: auth });

    // List all users in the domain
    var users = [];
    var pageToken = null;
    do {
      var params = {
        domain: 'rootsandwingsindy.com',
        maxResults: 500,
        projection: 'basic',
        fields: 'users(primaryEmail,thumbnailPhotoUrl,name),nextPageToken'
      };
      if (pageToken) params.pageToken = pageToken;
      var result = await admin.users.list(params);
      if (result.data.users) {
        users = users.concat(result.data.users);
      }
      pageToken = result.data.nextPageToken;
    } while (pageToken);

    // Build email -> photo URL map
    var photos = {};
    users.forEach(function(user) {
      if (user.thumbnailPhotoUrl) {
        photos[user.primaryEmail] = user.thumbnailPhotoUrl;
      }
    });

    res.status(200).json({ photos: photos });
  } catch (err) {
    console.error('Photos API error:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
};
