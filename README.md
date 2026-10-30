# LuMusic

A local music player built with **Rust (Tauri 2) + React 19 + Vite**, with a
strictly layered architecture and tests accompanying every behavior.

## Features

- Custom frameless title bar that matches the app theme (drag region,
  minimize / maximize / close; native controls are disabled in `tauri.conf.json`)
- Scan a music folder and build a searchable, sortable library (MP3 / FLAC / WAV / OGG)
- Automatic mojibake repair: legacy GBK/Big5/Shift-JIS tags misread as Latin-1
  (e.g. `ÄãºÃ` -> `你好`) are fixed with a high-confidence heuristic
  (`domain/encoding.rs`, Western titles are never rewritten)
- Play / pause / seek / volume, shuffle, repeat (off / all / one) with auto-advance
- Playlists: create, rename, delete, add/remove/reorder tracks
- Auto playlists from the folder structure: one playlist per first-level
  folder, root-level files go to `Default`, everything into `All Tracks`;
  clicking a playlist opens it, double-clicking a row plays it (sequential /
  loop-all / loop-one via the transport bar)
- State persisted across restarts (library cache, playlists, volume, last folder)
- Progress/state pushed to the UI via Tauri events (~4 Hz progress, event-driven state)

## Architecture

Dependencies point strictly downwards; each layer is testable in isolation.

```text
┌─ Frontend (src/) ──────────────────────────────────────────────┐
│ features/   UI modules (library, player, playlists, settings)  │
│ stores/     zustand stores - all backend calls go through api/ │
│ api/        PlayerApi interface + tauri impl + mock impl       │
│ types/      DTOs mirroring Rust serde types                    │
├─ Backend (src-tauri/src/) ─────────────────────────────────────┤
│ app/    thin Tauri commands + PlayerService orchestration      │
│         + poller thread (auto-advance, progress events)        │
│ infra/  IO adapters behind traits: fs_scan (walkdir),          │
│         metadata (lofty), audio (symphonia decode + rodio      │
│         output on a dedicated thread), persistence (JSON)      │
│ domain/ pure logic: Track, LibraryIndex, Queue (shuffle/       │
│         repeat rules), Playlists, scan rules - zero IO         │
└────────────────────────────────────────────────────────────────┘
```

Notable design decisions:

- **`rodio` output is not `Send`**, so the engine owns a dedicated audio
  thread and exposes a channel-based proxy (`infra/audio/engine.rs`).
- **Accurate seeking** is implemented by a custom `rodio::Source` adapter
  around symphonia's `FormatReader::seek` (`infra/audio/symphonia_source.rs`),
  with a shared position tracker for progress reporting.
- **Scanning does not block playback**: the heavy phase (walk + tag read)
  runs on a blocking thread without the service lock; only the merge step
  locks briefly (`app/commands.rs::scan_library`).
- **Frontend mock API** (`src/api/mock.ts`) mirrors backend semantics, so the
  UI can be developed in a plain browser (`npm run dev:mock`) and component
  tests never touch Tauri IPC.

## Getting started

One-command launcher (checks the toolchain, installs deps, generates icons,
then starts the app):

```bash
npm start            # desktop app in dev mode (tauri dev)
npm start -- --mock  # browser-only dev mode (mock data, no Rust needed)
npm start -- --build # production bundle
npm start -- --check # full quality gate

# Platform entry points (no npm required):
#   Windows: double-click start.cmd      POSIX shell: ./start.sh
```

Equivalent manual commands:

```bash
npm install          # frontend deps
npm run tauri dev    # run the desktop app (debug)
npm run tauri build  # bundle installers
npm run dev:mock     # browser-only development (in-memory mock data)
```

## Testing

```bash
npm run check       # typecheck + vitest + cargo test (the full gate)
npm run test        # frontend unit/component tests (vitest)
npm run test:rust   # backend unit tests (cargo test)
```

Current coverage: **84 backend** + **65 frontend** tests. The working rule for
this repo: any behavior change ships with a test that pins it.

| Layer                 | Test style                                                   |
| --------------------- | ------------------------------------------------------------ |
| `domain`              | pure unit tests (seeded shuffle, repeat edge cases, pruning) |
| `infra`               | real fixtures via `tempfile`/`hound` (WAV decode, seek)      |
| `app` (PlayerService) | mock scanner/metadata/persistence/**audio engine**           |
| stores / hooks        | vitest with the api module mocked at the seam                |
| components            | testing-library user behavior (double-click play, sliders)   |

## Project layout

```text
src/                  React frontend (see Architecture)
src-tauri/            Rust backend (see Architecture)
scripts/gen-icons.mjs deterministic app icon generation (no binary assets)
```

## Non-goals (for now)

Lyrics, equalizer, gapless playback, tag editing, album-art extraction.
