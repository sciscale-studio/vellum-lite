# Vellum Lite

**The lightest Markdown reader** — a tiny, local, good-looking reader for the
Markdown your AI agent just wrote. Open a file, scan the outline, read it on a
calm page. No account, no cloud, no vault.

Vellum Lite is the free, open-source edition: a ~5 MB desktop app built with
[Tauri](https://tauri.app) (Rust + React).

## Features

- **Local-first** — open `.md` / `.mdx` / `.markdown` straight from disk
- **Rich Markdown** — GFM tables, task lists, syntax-highlighted code
- **Math** — KaTeX for inline and display math
- **Diagrams** — Mermaid and Vega-Lite
- **Frontmatter** — YAML frontmatter rendered as a structured Properties panel
- **Outline** — jump anywhere from a live document outline
- **Tabs & recent files** — open several files; `Ctrl+Tab` to switch
- **Search** — `Ctrl+F` in-page search with match highlighting
- **Font scaling** and **light / dark** themes
- **File association** — register as the default `.md` app on Windows, macOS, Linux
- **Live reload** — on-disk changes are picked up automatically

## Download

Pre-built installers are at **[sciscale.org/vellum](https://sciscale.org/vellum)**
— Windows `.exe`/`.msi` and macOS `.dmg`. The builds aren't code-signed yet, so
SmartScreen / Gatekeeper may ask for confirmation the first time.

## Vellum Pro

**Pro** is an optional one-time paid upgrade that adds rendered-view editing,
selection translation (bring-your-own-key, or SciScale-hosted), and three extra
reading styles. Lite stays free and open-source — Pro just unlocks the heavier
tools when AI-written Markdown needs revision. Details at
[sciscale.org/vellum](https://sciscale.org/vellum).

## Build from source

Requires Node.js, the Rust toolchain, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install

# build the desktop installers (output under src-tauri/target/release/bundle)
npm run tauri:build:lite

# or just the web frontend
npm run build:lite
```

## License

[GPL-3.0](LICENSE) © 2026 Yue Li / SciScale.

Originally forked from [scos-lab/markview](https://github.com/scos-lab/markview).

---

A [SciScale Studio](https://wow.sciscale.org) project.
