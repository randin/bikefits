# Bike Fit Explorer & Comparison Tool

A web-based interface to browse, compare, and overlay your bike fit geometry files, and generate sharing/comparison links for [bikegeocalc.com](https://www.bikegeocalc.com/).

## Features
- **Visual Overlay**: Real-time canvas representation showing a wireframe overlay of two selected bikes to easily see fit and frame differences.
- **Side-by-Side Geometry Table**: Comprehensive breakdown of all geometry dimensions with automatically calculated difference badges (e.g. `+10mm (taller)`, `-1.5°`, `equal`).
- **Interactive Search & Selection**: Click to select/deselect bike files. Selecting a third bike automatically swaps the oldest selection.
- **Custom Fit Drag & Drop**: Load new JSON files instantly directly from your browser to compare them without committing or pushing.
- **Dynamic BikeGeoCalc URL Generator**: Generate precise, ready-to-share URLs for bikegeocalc.com.

---

## How to Use Locally
1. Run a local development web server inside this directory (to allow the page to fetch the JSON configurations correctly):
   ```bash
   npx serve .
   # OR
   python3 -m http.server 8000
   ```
2. Open the URL (e.g., `http://localhost:8000` or similar) in your browser.
3. Choose two files to overlay and compare!

---

## Hosting on GitHub Pages
To host this repository on GitHub Pages so you can view it anywhere:
1. Go to your repository settings on GitHub (`https://github.com/randin/bikefits/settings`).
2. Navigate to **Pages** in the left sidebar.
3. Under **Build and deployment**, set the Source to **Deploy from a branch**.
4. Select the branch (usually `main`) and root folder (`/`), then click **Save**.
5. After a minute or two, your page will be live at `https://randin.github.io/bikefits/`.

---

## Adding or Removing Bike Fits
When you add or remove `.json` bike fit files in this repository (including inside subdirectories like `unowned/`):
1. Run the generation script to update the index of fits (`files.json`):
   ```bash
   node generate-list.js
   ```
2. Commit and push the new files and the updated `files.json`:
   ```bash
   git add .
   git commit -m "Add new bike fit config and update index"
   git push origin main
   ```
3. Your GitHub Pages site will automatically rebuild and show the new fits!
