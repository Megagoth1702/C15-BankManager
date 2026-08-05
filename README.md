# C15 Offline Preset Manager

A browser-based preset manager for the Nonlinear Labs C15. Edit banks and presets fully offline, or connect the instrument over Wi-Fi and use a desktop-style interface that is faster than the stock Nonlinear Labs UI for browsing, arranging, and bulk work.

**[Open the app](https://megagoth1702.github.io/C15-OfflinePresetManager/)**

As of 24 July 2026 there are 8,559 official and sound-designer presets for the C15 available. Use This tool to reorganize, merge, dock, and rearrange large libraries on a computer, with or without the synthesizer attached. At this stage it covers the same core bank and preset workflows as the instrument’s own interface, built for a real display, mouse, and keyboard.

![Live mode — C15 Offline Preset Manager](img/LiveScreenshot.png)

---

## Getting started

### Offline (works on this site)

Import `.nlbackup` files or bank XML, arrange everything on the canvas, then export a clean backup or individual XML files. All processing stays in the browser. No instrument required.

### Live mode (C15 over Wi-Fi)

Connect the C15 on the same network and edit banks and presets in real time:

- Bank info appears on the canvas (and in tooltips when zoomed out)
- Import, merge, or replace libraries on the instrument from the app
- Selection and layout stay in sync while you work

Live mode cannot run from the GitHub Pages site alone. The site is HTTPS; browsers block the C15’s plain LAN WebSocket (`ws://`) from secure origins. Offline editing of `.nlbackup` and bank XML continues to work here.

To use Live, download the **Local Live pack** from  
**[GitHub Releases (latest)](https://github.com/Megagoth1702/C15-OfflinePresetManager/releases/latest)**  
Unzip, then double-click `Start.bat` (Windows), `Start.command` (macOS), or `Start.sh` (Linux). The pack serves the same app over `http://localhost` so Connect works. The first run downloads a small official Node.js runtime; later starts can pull updates from Releases automatically.

---

## Who this is for

- Users who want a faster day-to-day interface than the stock Nonlinear Labs UI while the C15 is connected over Wi-Fi
- People who download large preset packs and need to mass-import and clean them up quickly
- Anyone who prefers a desktop canvas to prepare a tidy bank layout offline, then push it live or export a backup
- Users merging content from several backups without fighting the instrument’s own interface

---

## Features

### Smart Folder Import + Auto-Dock

Point the app at a folder that contains subfolders (for example by sound designer). Banks from each subfolder are sorted, docked into chains, and spaced so clusters do not overlap.

### Visual docking (same behaviour as the C15)

Docked banks show clear parent/child links:

- Golden border in the left sidebar connecting related banks
- Golden lines between bank headers on the canvas

Move a parent bank and its children follow.

### Bank info

Full bank metadata (name, attributes, related info) is available on the canvas. When zoomed out in performance mode the same info stays reachable via tooltip.

### Extended search

- **Bank search** — locate banks by name (not available in the original C15 software)
- **Preset search** — a small indicator shows whether the match came from name, comment, or device

### Sorting

- Sort banks in the library view
- Sort presets inside a bank by name or creation date

### Drag presets into empty space

Drag presets out of a bank onto empty canvas space exactly as on the instrument.

### Multi-select

- **Banks**: hold `Ctrl` and drag with the left mouse button to marquee-select, or `Ctrl` + click bank headers. Only the selected banks move; docking relationships dissolve automatically if needed.
- **Presets**: `Ctrl` + click for individual selection, `Shift` + click for range selection while keeping previous selections.

### Export options

- Export selected banks as a single `.nlbackup`
- Or export them as individual `.xml` files

### Multi-backup import

Import as many `.nlbackup` files as needed, one after another. Nothing is wiped. Arrange freely, then export one combined backup or push live to the C15.

### Other tools

- Create empty banks
- Golden **c** marks presets that carry a comment; hover to read it
- Rename banks and presets with `F2`
- Re-align button updates the stored coordinates of docked child banks so they match their visual position
- Performance mode: when zoomed out, banks become simplified boxes without individual preset rows

---

## Typical workflows

### Offline

1. Import banks (single `.xml`, multiple `.xml`, folders, or one/multiple `.nlbackup` files)
2. Arrange, dock, search, multi-select, rename, and sort
3. Export a clean `.nlbackup` or individual `.xml` files for the C15

### Live (Wi-Fi)

1. Download the [Local Live pack](https://github.com/Megagoth1702/C15-OfflinePresetManager/releases/latest), unzip, and start it
2. Connect to the C15 on the local network
3. Browse and edit banks/presets with the desktop UI
4. Merge or replace the instrument library, or keep working offline and push when ready

Everything stays on your machine. Library data never leaves the PC except for the local-network conversation with your own C15 in Live mode.

---

## Technical notes

- File import/export and offline editing are 100 % client-side; processing happens in the browser
- Live mode talks only to the C15 on the local network (via the Local Live pack, not from the HTTPS website)
- Round-trip fidelity is preserved. Duplicate bank or preset IDs on import receive new unique IDs automatically
- Very large libraries (the full 8,559 presets) can use noticeable RAM and may show minor jank under some conditions
