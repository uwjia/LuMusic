// Pins sync-versions behavior: full fan-out, dependency/version fields
// elsewhere left alone, idempotent second run, missing field is an error.
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { syncVersions } from '@/../scripts/sync-versions.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'lumusic-sync-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fixture = () => {
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'lumusic', version: '0.2.0' })
  );
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    '{\n  "productName": "LuMusic",\n  "version": "0.1.0"\n}\n'
  );
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    '[package]\nname = "lumusic"\nversion = "0.1.0"\n\n[dependencies]\ntauri = { version = "2", features = ["tray-icon"] }\n'
  );
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.lock'),
    '[[package]]\nname = "serde"\nversion = "1.0.1"\n\n[[package]]\nname = "lumusic"\nversion = "0.1.0"\ndependencies = []\n'
  );
};

const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

describe('syncVersions', () => {
  it('fans the package.json version out to tauri.conf.json, Cargo.toml and Cargo.lock', () => {
    fixture();
    syncVersions(root);

    expect(read('src-tauri/tauri.conf.json')).toContain('"version": "0.2.0"');
    expect(read('src-tauri/Cargo.toml')).toContain('version = "0.2.0"');
    expect(read('src-tauri/Cargo.lock')).toContain('name = "lumusic"\nversion = "0.2.0"');
  });

  it('leaves dependency versions and other lockfile packages untouched', () => {
    expect(read('src-tauri/Cargo.toml')).toContain('tauri = { version = "2"');
    expect(read('src-tauri/Cargo.lock')).toContain('name = "serde"\nversion = "1.0.1"');
  });

  it('is idempotent — a second run reports zero updates', () => {
    const before = {
      conf: read('src-tauri/tauri.conf.json'),
      toml: read('src-tauri/Cargo.toml'),
      lock: read('src-tauri/Cargo.lock')
    };
    const logs = syncVersions(root);
    expect(logs.updated).toBe(0);
    expect(read('src-tauri/tauri.conf.json')).toBe(before.conf);
    expect(read('src-tauri/Cargo.toml')).toBe(before.toml);
    expect(read('src-tauri/Cargo.lock')).toBe(before.lock);
  });

  it('throws when a version field is missing', () => {
    writeFileSync(
      path.join(root, 'src-tauri/tauri.conf.json'),
      '{\n  "productName": "LuMusic"\n}\n'
    );
    expect(() => syncVersions(root)).toThrow(/no version field found in src-tauri\/tauri\.conf\.json/);
  });
});
