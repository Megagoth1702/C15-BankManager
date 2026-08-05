#!/usr/bin/env bash
# Ensure portable Node exists under ../runtime for the Local Live pack.
set -euo pipefail

LAUNCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
PACK_ROOT="$(cd "$LAUNCHER_DIR/.." && pwd)"
MANIFEST="$LAUNCHER_DIR/runtime-manifest.json"
RUNTIME_ROOT="$PACK_ROOT/runtime"
NODE_DIR="$RUNTIME_ROOT/node"
LOG="$PACK_ROOT/launcher.log"

log() {
  local line
  line="$(date -Iseconds 2>/dev/null || date) [ensure-node] $*"
  echo "$line"
  echo "$line" >>"$LOG" 2>/dev/null || true
}

uname_s="$(uname -s | tr '[:upper:]' '[:lower:]')"
uname_m="$(uname -m)"
case "$uname_s" in
  darwin)
    if [ "$uname_m" = "arm64" ]; then PLATFORM_KEY="darwin-arm64"; else PLATFORM_KEY="darwin-x64"; fi
    NODE_BIN="$NODE_DIR/bin/node"
    ;;
  linux)
    PLATFORM_KEY="linux-x64"
    NODE_BIN="$NODE_DIR/bin/node"
    ;;
  *)
    echo "Unsupported OS: $uname_s" >&2
    exit 1
    ;;
esac

if [ -x "$NODE_BIN" ]; then
  log "Portable Node already present: $NODE_BIN"
  exit 0
fi

if [ ! -f "$MANIFEST" ]; then
  echo "Missing runtime-manifest.json" >&2
  exit 1
fi

parse_manifest() {
  if command -v node >/dev/null 2>&1; then
    node --input-type=module -e "
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const p = m.platforms[process.argv[2]];
if (!p) process.exit(2);
process.stdout.write([m.nodeVersion, p.url, p.sha256].join('\n'));
" "$MANIFEST" "$PLATFORM_KEY"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json
m=json.load(open(r'''$MANIFEST'''))
p=m['platforms']['$PLATFORM_KEY']
print(m['nodeVersion'])
print(p['url'])
print(p['sha256'])
"
    return
  fi
  echo "Need node or python3 once to read manifest, or install Node LTS from https://nodejs.org/" >&2
  exit 1
}

META="$(parse_manifest)"
VER="$(printf '%s\n' "$META" | sed -n '1p')"
URL="$(printf '%s\n' "$META" | sed -n '2p')"
EXPECTED="$(printf '%s\n' "$META" | sed -n '3p')"

TMP="$RUNTIME_ROOT/download-tmp"
rm -rf "$TMP"
mkdir -p "$TMP"
ARCHIVE="$TMP/node.tgz"

echo ""
echo "  First run: downloading Node.js v${VER} (official nodejs.org)…"
echo "  $URL"
echo ""

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$ARCHIVE"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$ARCHIVE" "$URL"
else
  echo "Need curl or wget to download Node." >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  GOT="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  GOT="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
else
  echo "No shasum/sha256sum; skipping checksum (not ideal)." >&2
  GOT="$EXPECTED"
fi

if [ "$GOT" != "$EXPECTED" ]; then
  echo "SHA256 mismatch. Expected $EXPECTED got $GOT" >&2
  exit 1
fi
log "Checksum OK"

rm -rf "$NODE_DIR"
mkdir -p "$RUNTIME_ROOT"
tar -xzf "$ARCHIVE" -C "$TMP"
NESTED="$(find "$TMP" -maxdepth 1 -type d -name 'node-v*' | head -1)"
if [ -z "$NESTED" ]; then
  echo "Unexpected archive layout" >&2
  exit 1
fi
mv "$NESTED" "$NODE_DIR"

if [ ! -x "$NODE_BIN" ]; then
  echo "node binary missing after extract: $NODE_BIN" >&2
  exit 1
fi

echo "$VER" >"$RUNTIME_ROOT/node-version.txt"
rm -rf "$TMP"
log "Installed portable Node v$VER → $NODE_BIN"
echo "  Node ready."
echo ""
