#!/bin/bash
# Double-click on macOS (may need: xattr -cr this folder after download)
cd "$(dirname "$0")"
echo ""
echo "  C15 Bank Manager — Local Live pack"
echo ""

chmod +x "./launcher/ensure-node.sh" "./Start.sh" 2>/dev/null || true

if [ ! -x "./runtime/node/bin/node" ]; then
  echo "  Preparing portable Node.js runtime (first run only)…"
  if ! bash "./launcher/ensure-node.sh"; then
    if command -v node >/dev/null 2>&1; then
      echo "  Using system Node…"
      exec node "./launcher/bootstrap.mjs"
    fi
    echo "  Failed to install Node. See launcher.log"
    read -r -p "  Press Enter to close…"
    exit 1
  fi
fi

if [ -x "./runtime/node/bin/node" ]; then
  exec "./runtime/node/bin/node" "./launcher/bootstrap.mjs"
else
  exec node "./launcher/bootstrap.mjs"
fi
