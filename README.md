# C15 Offline Preset Manager

Manage Nonlinear Labs C15 preset banks completely offline - without the instrument.

**[Open the app](https://megagoth1702.github.io/C15-OfflinePresetManager/)**

As of 24th July 2026 there are **8,559** official and sound-designer presets available. This tool lets you reorganize, merge, dock, and rearrange large libraries on a computer before you ever touch the synthesizer.

---
### Who this is for

- ayone who downloads large preset packs and wants to mass-import and clean them up quickly
- people who prefer a fast interface to prepare a tidy bank layout offline
- or anyone who wants to merge content from several backups without the instrument connected
---
### Smart Folder Import + Auto-Dock

Point the app at a folder that contains subfolders (e.g. by sound designer). It creates a helper parent bank for each subfolder, docks every bank inside it, and spaces them so they do not overlap.
### Visual Docking System (similar to C15)

Docked banks are shown clearly:
- Golden border in the left sidebar connecting related banks
- Golden lines between bank headers on the canvas  

When you move a parent bank, its children follow - like in the C15.

---
### Other features

**Extended Search**
- Search banks by name (not available in the original C15 software)
- Ppreset search: a small indicator shows why a preset matched (name, comment, or device)

**Multi-select & Sorting**
- Banks: Hold `Ctrl` and drag with the left mouse button to marquee-select multiple banks, or `Ctrl` + click bank headers. When you move the selection, only the selected banks move. Docking relationships are automatically dissolved if needed.
- Presets: `Ctrl` + click → select individual presets  
  `Shift` + click → range select while keeping previous selections
- Sort presets inside a bank by name or creation date

**Flexible Export**
- Export selected banks as a single `.nlbackup`
- Or export them as individual `.xml` files

**Multi-Backup Import**  
Import as many `.nlbackup` files as you want, one after another. Nothing is wiped. Arrange freely, then export one combined backup for the C15.

**Other useful tools**
- Create empty banks
- golden "c" = preset comment available, hover a preset to see its comments
- Rename banks and presets with `F2`
- Re-align button: updates the stored coordinates of docked child banks so they match their visual position
- Performance mode: when zoomed out, banks become simplified boxes (no individual preset rows)
---
### Typical workflow

1. Import banks (single `.xml`, multiple `.xml`, folders, or one/multiple `.nlbackup` files)
2. Arrange, dock, search, multi-select, rename, and sort as needed
3. Export the result as a clean `.nlbackup` or individual `.xml` files and load them on the C15

Everything stays in the browser. No data leaves your machine.
---
### Technical notes

- **100% client-side**, all processing happens in your browser
- **Round-trip fidelity** is guaranteed. If a duplicate bank or preset ID is detected on import, a new unique ID is generated automatically
- Very large libraries (full 8,559 presets) can use noticeable RAM and show minor jank under some conditions
---
### Screenshots

*(to be added)*

**Docking visualization**  
Golden borders and connection lines make parent/child relationships obvious.

**Search indicators**  
Shows whether a preset was matched by name, comment, or device.