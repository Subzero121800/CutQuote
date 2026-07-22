# CutQuote

Address-to-address pricing for **lawn mowing, snow removal, and leaf cleanup**.
A time + mileage + fuel cost engine with two modes:

- **Owner / Operator** — full cost build-up: labor, windshield time, truck fuel, equipment fuel, materials, margin, minimum charge. Produces a work ticket you can print or copy.
- **Homeowner** — a fair-price range check so you know what a quote *should* look like before the trucks show up.

Built by Joseph C McGinty Jr // ResilientMind AI ©2026.
If CutQuote helped you win a job — or dodge a bad quote — you can [buy me a coffee](https://buymeacoffee.com/jcinc). ☕

## Run it locally

It's a fully static app — no build step, no dependencies, no API keys.

```bash
./run-dev.sh          # serves http://localhost:8000 and opens your browser
./run-dev.sh 3000     # any other port
```

Or just double-click `index.html` — the geocoding services work from a `file://` page too. (The local server is recommended so the manifest and headers behave like production.)

## Deploy to Netlify (60 seconds)

### Option 1 — drag and drop

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag this whole folder onto the page
3. Done. Netlify gives you a live URL immediately.

### Option 2 — Git deploy

1. Push this folder to a GitHub repo
2. In Netlify: *Add new site → Import from Git* → pick the repo
3. Build command: none. Publish directory: `/` (root). (`netlify.toml` already says this.)

`_headers` ships sensible security headers including a Content-Security-Policy scoped to the two routing services and Google Fonts.

## Project layout

```text
index.html            app shell & markup
css/styles.css        all styling, incl. print stylesheet (ticket-only printing)
js/app.js             pricing engines, geocoding/routing, persistence, rendering
run-dev.sh            local dev server (./run-dev.sh [port])
manifest.webmanifest  PWA manifest (installable on phones)
favicon.svg           icon
netlify.toml          Netlify config (no build, publish root)
_headers              security headers / CSP
CutQuote.jsx          original React prototype (not used by the site; kept for reference)
```

## Features

- Three services: lawn (terrain, obstacles, frequency, 5 mower classes), snow (depth, 5 equipment classes, ice melt, priority surcharge, seasonal contract), leaf (tree cover, haul-away & dump fees)
- Real road miles & drive minutes between any two US addresses
- Manual miles/minutes fallback whenever routing is unavailable
- **📐 Measure from the sky** — fly to the job address on aerial imagery and tap the corners of the lawn or driveway; acreage / square footage auto-fills the quote. Optional county parcel-record lookup with your own [Regrid](https://regrid.com) API token.
- **✍ Mobile contract signing** — turn the operator work ticket into a service agreement, hand the phone to the customer for a finger signature (contractor + customer pads), and print / save a clean PDF contract
- **Prepaid billing** — bill per visit, prepay a block of N visits, or prepay the whole season, with an operator-set prepay discount shown as a "due at signing" total on the contract
- Print / save-PDF work tickets (print styles show just the ticket)
- Copy quote as plain text for texting a customer
- Everything you type is saved on-device (localStorage) — no accounts, no tracking
- One-click reset to defaults

## How routing works

- **Geocoding** is a fallback chain (all free, no keys):
  1. **US Census Bureau geocoder** (TIGER data, via JSONP) — authoritative for US street addresses, including rural house numbers OpenStreetMap doesn't have
  2. **OpenStreetMap Nominatim** — best for towns, cities, and landmarks
  3. If the exact house number isn't in either dataset, the app locates the street or town center and labels the distance as approximate (≈)
  - Street-looking queries ("612 Cemetery Rd…") try Census first; town-looking queries ("Perryopolis, PA") try Nominatim first.
- **Driving distance & time:** OSRM public demo server (free, no key)
- If every service is down, the app falls back to manual miles/minutes entry.

> The OSRM demo server is best-effort community infrastructure — fine for personal
> and light use. For production traffic, self-host OSRM or use a keyed routing
> provider and swap the URL in the `osrm()` function in `js/app.js`.

## What is estimated vs. real

- **Real:** road miles, drive minutes, all cost math
- **Measured by you:** lot acreage and driveway square footage, via the 📐 MEASURE
  tool (tap the corners on aerial imagery — imagery © Esri, fallback USGS).
  Fully automatic address-in → acreage-out needs a parcel API; paste your own
  Regrid token into the measure dialog to pull the county-recorded lot size.
  Always verify against the county parcel record.

## Contracts

The ✍ SIGN CONTRACT button (operator mode) turns the current work ticket into a
service agreement: your business name, the customer, the address, the itemized
scope and price, editable terms, and billing — per visit, a prepaid block of
visits, or a prepaid season, with your prepay discount computed into a
"due at signing" total. Both parties sign right on the phone; the printed /
PDF version is a clean document with no app controls on it.
Nothing is uploaded anywhere — the contract exists only on your device and in
the PDF you save or share.

---

Routing & geocoding © OpenStreetMap contributors, via Nominatim and OSRM.
Estimates only — not a contract.
