// Fans the root package.json version out to the Rust side: tauri.conf.json
// (the bundle/installer filename embeds this version), Cargo.toml and
// Cargo.lock (otherwise cargo silently rewrites the lock on next build).
// release-it itself only touches the root manifest and package-lock.json;
// this after:bump hook keeps everything aligned before the release commit
// (release-it stages the whole workdir, so these files land in it).
// Idempotent: files already at the target version are left untouched.
// The v* tag push then triggers .github/workflows/release.yml which builds
// and creates the GitHub Release — so `npm run release` is one command
// from bump to published binaries.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Anchored per file so dependency declarations like
// `tauri = { version = "2", ... }` or other [[package]] blocks in the
// lockfile are never touched.
const jsonVersion = /^(\s*"version": ")[^"]+(")/m;
const cargoPackage = /(^version = ")[^"]+(")/m;
const cargoLockSelf = /(name = "lumusic"\nversion = ")[^"]+(")/;

const FILES = [
  { path: 'src-tauri/tauri.conf.json', pattern: jsonVersion },
  { path: 'src-tauri/Cargo.toml', pattern: cargoPackage },
  { path: 'src-tauri/Cargo.lock', pattern: cargoLockSelf }
];

export function syncVersions(rootDir) {
  const { version } = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  let updated = 0;
  for (const file of FILES) {
    const fileDir = path.join(rootDir, file.path);
    const raw = readFileSync(fileDir, 'utf8');
    if (!file.pattern.test(raw)) throw new Error(`no version field found in ${file.path}`);
    const next = raw.replace(file.pattern, `$1${version}$2`);
    if (next !== raw) {
      writeFileSync(fileDir, next);
      updated += 1;
      console.log(`${file.path} -> ${version}`);
    }
  }
  const summary = { checked: FILES.length, updated, version };
  console.log(
    `checked ${summary.checked} files, ${summary.updated} updated (target ${version})`
  );
  return summary;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  syncVersions(process.cwd());
}
