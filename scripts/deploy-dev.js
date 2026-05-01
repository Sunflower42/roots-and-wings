// Deploy the current branch as a Vercel preview, then re-point the
// stable rw-dev.vercel.app alias at the new deployment. Use this in
// place of `vercel deploy` when you want collaborators on the dev URL
// to see your latest commit immediately.
//
// Usage:
//   npm run deploy:dev
//   (or directly: node scripts/deploy-dev.js)

const { spawnSync } = require('child_process');

const ALIAS = 'rw-dev.vercel.app';

function run(cmd, args, opts) {
  console.log('\n$ ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'pipe', encoding: 'utf8', shell: true }, opts || {}));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error('Command failed with exit code', r.status);
    process.exit(r.status || 1);
  }
  return (r.stdout || '') + (r.stderr || '');
}

const deployOut = run('vercel', ['deploy', '--yes']);

// Vercel CLI prints the deployment URL multiple times in different
// lines (Inspect, Preview, Production). Pull the *.vercel.app deploy
// URL — there's typically one matching the project's auto-hash form.
const urlMatches = deployOut.match(/https:\/\/[a-z0-9-]+-communications-3881s-projects\.vercel\.app/g);
if (!urlMatches || urlMatches.length === 0) {
  console.error('\nCould not find a deployment URL in vercel deploy output.');
  console.error('Run `vercel deploy --yes` manually and copy the URL, then:');
  console.error('  vercel alias set <url> ' + ALIAS);
  process.exit(1);
}
// Use the most-mentioned URL — that's the new deployment (Inspect URLs
// have a different shape: /projects/.../<hash> not <hash>-<scope>.app).
const counts = {};
urlMatches.forEach(u => { counts[u] = (counts[u] || 0) + 1; });
const newUrl = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
console.log('\nDeployment URL detected:', newUrl);

run('vercel', ['alias', 'set', newUrl, ALIAS]);

console.log('\n✓ https://' + ALIAS + ' now points to ' + newUrl);
