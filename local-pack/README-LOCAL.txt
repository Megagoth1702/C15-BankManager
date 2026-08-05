C15 Bank Manager — Local Live pack
============================================

Why this pack?
  The website (GitHub Pages) is HTTPS. Browsers block a direct connection to the
  C15 (ws:// on your Wi‑Fi). This pack runs the same app on your PC over
  http://127.0.0.1 so Live mode works.

How to run
  Windows:  double-click  Start.bat
  macOS:    double-click  Start.command
            (if macOS blocks it: right-click → Open, or in Terminal:
             xattr -cr "/path/to/this/folder")
  Linux:    ./Start.sh

First run
  Downloads official Node.js (pinned version) from nodejs.org into the
  "runtime" folder (~30–40 MB). Needs internet once. Later starts work offline
  (except optional update checks).

Updates
  On Start, the pack checks GitHub Releases and can download a newer pack
  automatically. Your "runtime" folder is kept. To skip: set C15BM_SKIP_UPDATE=1

Live mode
  In the app: open the Offline/Live control → enter C15 IP (often 192.168.8.2)
  → Connect. PC and C15 must be on the same network / C15 Wi‑Fi.

Stop
  Close this console window, or press Ctrl+C.
  That stops the local server. Starting again also clears any old server
  left from a previous run (same folder).

Support files
  launcher.log  — startup / update messages if something fails

Downloads / new versions
  https://github.com/Megagoth1702/C15-BankManager/releases/latest

Offline editing also works on the website; only Live needs this pack.
