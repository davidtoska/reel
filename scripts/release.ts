// Makes a real release of reel-format, reel-player and reel-schema: GitHub release + npm.
//
//   npm run release -- patch          1.0.1 → 1.0.2   (bug fixes, docs)
//   npm run release -- minor          1.0.1 → 1.1.0   (new helpers, backward compatible)
//   npm run release -- major          1.0.1 → 2.0.0   (breaking changes in the JS API)
//   npm run release -- patch --dry-run   shows what would happen, changes nothing
//
// The three packages always get the same version. Before releasing, write what changed under
// "## Unreleased" at the top of CHANGELOG.md – those lines become the release notes.
//
// Steps: checks (clean main, up to date, gh logged in) → versions and CHANGELOG → build, typecheck,
// test → commit and push → GitHub release vX.Y.Z → the "Publish" workflow publishes to npm (trusted
// publishing) → waits until npm shows the new version.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PACKAGES = ['reel-schema', 'reel-format', 'reel-player'];
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const bump = args.find(a => ['patch', 'minor', 'major'].includes(a));
const dryRun = args.includes('--dry-run');

const fail = (message: string): never => { console.error(`\n✖ ${message}\n`); process.exit(1); };
const step = (message: string) => console.log(`\n▸ ${message}`);
const run = (cmd: string, cmdArgs: string[], opts: { quiet?: boolean } = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit' }) ?? '';
const out = (cmd: string, cmdArgs: string[]) => execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

if (!bump) fail('Say what kind of release: npm run release -- patch | minor | major  (add --dry-run to try)');

// --- Checks -----------------------------------------------------------------------------------------

step('Checking the repository');
if (out('git', ['branch', '--show-current']) !== 'main') fail('Switch to the main branch first: git checkout main');
if (out('git', ['status', '--porcelain'])) fail('There are uncommitted changes. Commit them (or stash them) first.');
run('git', ['fetch', '--quiet', 'origin', 'main'], { quiet: true });
if (out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-parse', 'origin/main'])) fail('main is not the same as GitHub. Run git pull (or git push) first.');
try { out('gh', ['auth', 'status']); } catch { fail('The GitHub CLI is not logged in. Run: gh auth login'); }

const pkgPath = (p: string) => join(ROOT, 'packages', p, 'package.json');
const readPkg = (p: string) => JSON.parse(readFileSync(pkgPath(p), 'utf8'));
const current = readPkg('reel-format').version as string;
for (const p of PACKAGES) if (readPkg(p).version !== current) fail(`${p} is at ${readPkg(p).version}, the others at ${current}. Make them equal first.`);

const [maj, min, pat] = current.split('.').map(Number);
const next = bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
const tag = `v${next}`;
if (out('git', ['tag', '--list', tag])) fail(`The tag ${tag} exists already.`);

// --- CHANGELOG ----------------------------------------------------------------------------------------

const changelog = readFileSync(CHANGELOG, 'utf8');
const unreleased = /^## Unreleased[^\n]*\n([\s\S]*?)(?=^## )/m.exec(changelog);
if (!unreleased) fail('CHANGELOG.md has no "## Unreleased" section. Add one at the top with what changed.');
const notes = unreleased![1].trim();
if (!notes || /^_?Nothing yet/i.test(notes)) fail('The "## Unreleased" section in CHANGELOG.md is empty. Write what changed there first.');

console.log(`\n  ${current} → ${next} for ${PACKAGES.join(', ')}\n\n  Release notes:\n${notes.split('\n').map(l => `    ${l}`).join('\n')}`);
if (dryRun) { console.log('\n(dry run: nothing changed)\n'); process.exit(0); }

step('Updating versions and CHANGELOG');
const date = new Date().toISOString().slice(0, 10);
writeFileSync(CHANGELOG, changelog.replace(/^## Unreleased[^\n]*\n/m, `## Unreleased\n\n_Nothing yet._\n\n## ${next} – ${date}\n`));
for (const p of PACKAGES) {
  const pkg = readPkg(p);
  pkg.version = next;
  if (pkg.dependencies?.['reel-format']) pkg.dependencies['reel-format'] = `^${next}`;
  writeFileSync(pkgPath(p), `${JSON.stringify(pkg, null, 2)}\n`);
}
run('npm', ['install', '--package-lock-only', '--silent']);

step('Building, type-checking and testing');
try {
  run('npm', ['run', 'build']);
  run('npm', ['run', 'typecheck']);
  run('npm', ['test']);
} catch {
  run('git', ['checkout', '--', '.']);
  fail('Build or tests failed – nothing was released, and the version changes were undone.');
}

step(`Committing and pushing ${tag}`);
run('git', ['commit', '-am', `Release ${tag}`]);
run('git', ['push', 'origin', 'main']);

step('Creating the GitHub release');
const notesFile = join(mkdtempSync(join(tmpdir(), 'reel-release-')), 'notes.md');
writeFileSync(notesFile, `${notes}\n`);
run('gh', ['release', 'create', tag, '--title', next, '--notes-file', notesFile, '--target', 'main']);

// --- Wait for npm -------------------------------------------------------------------------------------

step('Waiting for the Publish workflow and npm (a few minutes)');
const npmVersion = (p: string) => { try { return out('npm', ['view', p, 'version']); } catch { return ''; } };
for (let i = 0; i < 60; i++) {
  await sleep(15_000);
  const versions = PACKAGES.map(npmVersion);
  if (versions.every(v => v === next)) {
    console.log(`\n✔ Released ${next}`);
    console.log(`  GitHub: https://github.com/davidtoska/reel/releases/tag/${tag}`);
    for (const p of PACKAGES) console.log(`  npm:    https://www.npmjs.com/package/${p}/v/${next}`);
    process.exit(0);
  }
  const latest = out('gh', ['run', 'list', '--workflow', 'publish.yml', '--limit', '1', '--json', 'status,conclusion', '-q', '.[0].status + " " + .[0].conclusion']);
  if (latest.startsWith('completed failure')) fail('The Publish workflow failed. See: gh run view --log-failed  (or the Actions tab on GitHub)');
  process.stdout.write('.');
}
fail('npm does not show the new version after 15 minutes. Check the Actions tab on GitHub.');
