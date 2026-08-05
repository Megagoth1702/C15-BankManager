# C15 Offline Preset Manager

A fast browser-based preset manager for the Nonlinear Labs **C15** — work fully offline, or connect the instrument **live over Wi‑Fi** and manage banks and presets with a much snappier interface than the stock Nonlinear Labs UI.

**[Open the app](https://megagoth1702.github.io/C15-OfflinePresetManager/)**

As of 24th July 2026 there are **8,559** official and sound-designer presets available. This tool lets you reorganize, merge, dock, and rearrange large libraries on a computer — with or without the synthesizer connected.

At this point you can use it as a **full alternative to the Nonlinear Labs graphical user interface**: the same core bank/preset workflows, designed for speed on a real computer display and mouse/keyboard.

---

### Live mode (C15 over Wi‑Fi)

Connect your C15 on the same network and work **live**:

- See **bank info** on the canvas (and in tooltips when zoomed out)
- Import, merge, and replace libraries on the instrument from the app
- Keep selection and layout in sync while you edit
- Enjoy **much faster performance** than the onboard UI for browsing, arranging, and bulk work

**Important:** Live mode cannot run *on this website* alone. GitHub Pages is HTTPS; browsers block the C15’s plain LAN WebSocket (`ws://`) from secure pages. Offline editing of `.nlbackup` / bank XML still works fully here.

**To use Live:** download the **Local Live pack** from  
**[GitHub Releases (latest)](https://github.com/Megagoth1702/C15-OfflinePresetManager/releases/latest)**  
→ unzip → double-click `Start.bat` (Windows), `Start.command` (macOS), or `Start.sh` (Linux).  
The pack runs the same app on your computer over `http://localhost` so Connect works. First run downloads a small official Node.js runtime once; later starts can update the app automatically from Releases.

---

### Who this is for

- Anyone who wants a **faster day-to-day UI** than the stock Nonlinear Labs interface, with the C15 connected over Wi‑Fi
- People who download large preset packs and want to mass-import and clean them up quickly
- Users who prefer a desktop-style canvas to prepare a tidy bank layout offline, then push it live or export a backup
- Anyone merging content from several backups without fighting the instrument’s own UI

---

### Smart Folder Import + Auto-Dock

Point the app at a folder that contains subfolders (e.g. by sound designer). Banks from each subfolder are sorted, docked into chains, and spaced so clusters do not overlap — without creating empty helper banks for folder names.

### Visual Docking System (similar to C15)

Docked banks are shown clearly:

- Golden border in the left sidebar connecting related banks
- Golden lines between bank headers on the canvas

When you move a parent bank, its children follow — like on the C15.

---

### Other features

**Bank info**
- Full bank metadata is available on the canvas (name, attributes, and related info)
- When zoomed out in performance mode, bank info stays reachable via tooltip

**Extended search**
- **Bank search** — find banks by name (not available in the original C15 software), with a broader search experience for large libraries
- **Preset search** — a small indicator shows why a preset matched (name, comment, or device)

**Sorting**
- **Sort banks** in the library view
- Sort **presets** inside a bank by name or creation date

**Presets into empty space (like the C15)**
- Drag presets out of a bank into empty canvas space to place them the same way you would on the instrument

**Multi-select**
- Banks: Hold `Ctrl` and drag with the left mouse button to marquee-select multiple banks, or `Ctrl` + click bank headers. When you move the selection, only the selected banks move. Docking relationships are automatically dissolved if needed.
- Presets: `Ctrl` + click → select individual presets  
  `Shift` + click → range select while keeping previous selections

**Flexible export**
- Export selected banks as a single `.nlbackup`
- Or export them as individual `.xml` files

**Multi-backup import**  
Import as many `.nlbackup` files as you want, one after another. Nothing is wiped. Arrange freely, then export one combined backup — or push live to the C15.

**Other useful tools**
- Create empty banks
- Golden **c** = preset comment available; hover a preset to see its comments
- Rename banks and presets with `F2`
- Re-align button: updates the stored coordinates of docked child banks so they match their visual position
- Performance mode: when zoomed out, banks become simplified boxes (no individual preset rows)

---

### Typical workflows

**Offline**
1. Import banks (single `.xml`, multiple `.xml`, folders, or one/multiple `.nlbackup` files)
2. Arrange, dock, search, multi-select, rename, and sort as needed
3. Export a clean `.nlbackup` or individual `.xml` files for the C15

**Live (Wi‑Fi)**
1. Download the [Local Live pack](https://github.com/Megagoth1702/C15-OfflinePresetManager/releases/latest), unzip, and Start
2. Connect to your C15 on the local network
3. Browse and edit banks/presets with the faster desktop UI
4. Merge or replace the instrument library, or keep working offline and push when ready

Everything stays on your machine. No library data leaves your PC (aside from talking to your own C15 on the local network in Live mode).

---

### Technical notes

- **100% client-side** for file import/export and offline editing — processing happens in your browser
- **Live mode** talks to the C15 on your local network only (via the Local Live pack; not from the HTTPS website)
- **Round-trip fidelity** is guaranteed. If a duplicate bank or preset ID is detected on import, a new unique ID is generated automatically
- Very large libraries (full 8,559 presets) can use noticeable RAM and show minor jank under some conditions

---

### Screenshots

![Live mode — C15 Offline Preset Manager](img/LiveScreenshot.png)

**Docking visualization**  
Golden borders and connection lines make parent/child relationships obvious.

**Search indicators**  
Shows whether a preset was matched by name, comment, or device.
