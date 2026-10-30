#!/usr/bin/env node
/**
 * One-command launcher for LuMusic.
 *
 * Usage:
 *   node scripts/start.mjs             # desktop app in dev mode (tauri dev)
 *   node scripts/start.mjs --mock      # browser-only dev mode (in-memory data)
 *   node scripts/start.mjs --build     # production bundle (tauri build)
 *   node scripts/start.mjs --check     # full quality gate (typecheck + tests)
 *
 * The script verifies the toolchain, installs npm dependencies when missing,
 * (re)generates bundle icons, then hands over to the requested task.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const log = (msg) => console.log(`[start] ${msg}`);
const fail = (msg) => {
  console.error(`[start] ERROR: ${msg}`);
  process.exit(1);
};

// ---------- CLI flags ----------

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/start.mjs [mode]',
      '',
      'Modes:',
      '  (default)  desktop app in dev mode (tauri dev)',
      '  --mock     browser-only dev mode (in-memory data, no Rust needed)',
      '  --build    production bundle (tauri build)',
      '  --check    full quality gate (typecheck + frontend & backend tests)',
      '  --help     show this help',
    ].join('\n'),
  );
  process.exit(0);
}

const unknown = args.filter((a) => !['--mock', '--build', '--check'].includes(a));
if (unknown.length > 0) {
  fail(`unknown option(s): ${unknown.join(', ')} (see --help)`);
}

const mode = args.includes('--mock')
  ? 'mock'
  : args.includes('--build')
    ? 'build'
    : args.includes('--check')
      ? 'check'
      : 'dev';

// ---------- Helpers ----------

/** Runs a command, returns { ok, stdout }. Prints nothing on success. */
function probe(command, cliArgs = []) {
  const result = spawnSync(command, cliArgs, {
    encoding: 'utf8',
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { ok: result.status === 0, stdout: String(result.stdout ?? '') };
}

/** Resolves an executable to a full path (cross-platform `which`). */
function which(command) {
  const probeCmd = isWindows ? 'where' : 'which';
  const result = spawnSync(probeCmd, [command], {
    encoding: 'utf8',
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? String(result.stdout).trim().split(/\r?\n/)[0] : null;
}

/** Runs a long-lived command as a child; forwards SIGINT and exit code. */
function run(label, command, cliArgs) {
  log(`${label}: ${command} ${cliArgs.join(' ')}`);
  const child = spawn(command, cliArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows,
  });
  const forward = (signal) => child.kill(signal);
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (err) => fail(`failed to start "${command}": ${err.message}`));
}

// ---------- Toolchain checks ----------

function checkToolchain() {
  if (!which('npm')) {
    fail('npm was not found on PATH. Install Node.js >= 20 from https://nodejs.org');
  }

  // The desktop pipeline additionally needs a Rust toolchain.
  if (mode !== 'mock' && mode !== 'check') {
    const cargo = probe('cargo', ['--version']);
    if (!cargo.ok) {
      fail(
        'cargo was not found on PATH. Install Rust via https://rustup.rs ' +
          '(desktop mode needs the MSVC toolchain on Windows). ' +
          'Tip: use --mock to run the UI in a plain browser without Rust.',
      );
    }
    log(`toolchain: ${cargo.stdout.trim()}`);

    if (isWindows) {
      // cl.exe is required by the MSVC linker; warn (not fail) since it may
      // still be resolvable through the environment in some setups.
      if (!which('cl')) {
        log('warning: cl.exe not found on PATH; the MSVC Build Tools may be missing.');
      }
    }
  }
}

// ---------- Bootstrap steps ----------

function ensureDependencies() {
  if (!existsSync(path.join(root, 'node_modules'))) {
    log('node_modules missing - installing npm dependencies (first run takes a few minutes)...');
    const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: root,
      stdio: 'inherit',
      shell: isWindows,
    });
    if (result.status !== 0) fail('npm install failed');
  } else {
    log('dependencies: node_modules present');
  }
}

function ensureIcons() {
  const iconDir = path.join(root, 'src-tauri', 'icons');
  const required = ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.png'];
  if (required.every((name) => existsSync(path.join(iconDir, name)))) {
    log('icons: present');
    return;
  }
  log('icons: generating bundle icons...');
  const result = spawnSync(process.execPath, ['scripts/gen-icons.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail('icon generation failed');
}

// ---------- Main ----------

log(`mode: ${mode}`);
checkToolchain();
ensureDependencies();
if (mode !== 'mock') {
  ensureIcons();
}

switch (mode) {
  case 'mock':
    run('launching browser dev mode (mock data)', 'npx', ['vite', '--mode', 'mock']);
    break;
  case 'build':
    run('building release bundle', 'npx', ['tauri', 'build']);
    break;
  case 'check':
    run('running quality gate', 'npm', ['run', 'check']);
    break;
  default:
    run('launching desktop app', 'npx', ['tauri', 'dev']);
    break;
}
