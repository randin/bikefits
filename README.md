# Bike Fit Explorer & Comparison Tool

**Live Site:** [https://randin.github.io/bikefits/](https://randin.github.io/bikefits/)

A web-based interface to browse, compare, and overlay your bike fit geometry files

## Features

- **A/B comparison** — pick a fit as **A** (your reference), then click through others as **B**. Use the `A`/`B` buttons on any row to place a fit in a specific slot, and ⇄ to swap.
- **Geometry overlay** — both bikes drawn to scale, aligned at the **BB** (best for fit) or the **rear axle**. Switching fits animates between them so differences are easy to see.
- **Measure on the drawing** — hover any measurement to draw its dimension on both bikes; click a row to pin it (`Esc` to clear).
- **Contact points** — how the saddle, bars and hoods move from A to B, measured from each bike's BB.
- **Measurements** — fit, frame and cockpit numbers with B − A differences, plus the raw BikeGeoCalc coordinates. Toggle *Only differences* to hide identical rows.
- **Shareable links** — the URL keeps the selection (e.g. `?a=Aethos-54&b=unowned/Strael54R`); your last comparison is remembered.
- **BikeGeoCalc** — open or copy a BikeGeoCalc link for the selected fit(s).
- **Local files** — drag a BikeGeoCalc JSON anywhere onto the page to preview it without committing.
- Light and dark themes, keyboard friendly (`/` to search, arrow keys in the list).

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

---

## Project Structure

- `index.html` — page markup
- `assets/css/styles.css` — design system and layout (light/dark themes)
- `assets/js/app.js` — UI, selection state, list and measurements
- `assets/js/geometry.js` — fit model: derived points, measurements, BikeGeoCalc link builder
- `assets/js/scene.js` — canvas drawing, animation and dimension annotations
- `assets/js/icons.js` — inline SVG icons
