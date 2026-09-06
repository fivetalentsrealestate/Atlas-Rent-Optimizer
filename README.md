# Atlas Rent Optimizer — installable PWA

An unofficial Atlas Earth calculator. Works fully offline once installed, and
plans coverage for Super Rent Boost weekends.

**Not affiliated with Atlas Reality, Inc.** No account, no backend, no analytics,
no network calls at runtime except the Google Fonts stylesheet (which is cached
after the first load, so the app still works with no connection).

## Files

```
index.html            markup + styles
app.js                calculator, SRB planner, persistence, install/SW wiring
sw.js                 service worker — offline cache
manifest.webmanifest  install metadata
icons/                app icons (any + maskable, 192 & 512, Apple touch)
```

## Deploying

The service worker needs **HTTPS** (or `localhost`). Any static host works; all
three below are free and take about two minutes.

**Cloudflare Pages** — Create a project → "Upload assets" → drag this whole
folder in → Deploy. You get `something.pages.dev`.

**Netlify** — Go to app.netlify.com/drop and drag the folder onto the page.

**GitHub Pages** — Push these files to a repo, then Settings → Pages → deploy
from branch, root. Note the site lands under `/<repo-name>/`; the paths here are
all relative, so that works without changes.

Test locally first with `python3 -m http.server 8777` and open
`http://localhost:8777` — service workers are permitted on localhost over HTTP.

## Installing on a phone

- **Android / Chrome** — an "Install app" bar appears at the top. One tap.
- **iPhone / Safari** — Share → *Add to Home Screen*. iOS gives no install
  prompt, so the app detects iOS and shows that instruction instead.

Once installed it launches standalone (no browser chrome) and runs with no
connection.

## Updating after you edit a file

Bump `CACHE_VERSION` in `sw.js` (`aro-v1` → `aro-v2`) and redeploy. Without that,
returning visitors keep the cached copy. The worker calls `skipWaiting()` and
`clients.claim()`, so a new version takes effect on the next load.

## About the SRB reminders

Two mechanisms, and they are not equally reliable:

- **In-app reminders** (the "Enable reminders" button) use `setTimeout` plus the
  Notification API. They fire while the app is open or recently backgrounded.
  Mobile operating systems suspend background timers aggressively, so a reminder
  eight hours out will often not arrive if the app has been closed the whole time.
  Genuinely reliable push would need a server sending Web Push with VAPID keys —
  deliberately out of scope here, since it would mean running a backend.

- **Calendar export** (the "Download calendar reminders" button) writes a
  standard `.ics` file with one alarmed event per top-up plus one for the window
  itself. Your phone's own calendar fires these, so they work whether or not the
  app is running. **This is the one to use.**

The planner defaults to the next Thursday 4pm – Saturday midnight Central, the
pattern events have historically followed, computed in that timezone with proper
DST handling and displayed in the viewer's local time. Adjust the dates when the
real ones are announced.

## Data and privacy

Everything a visitor types is kept in their own browser's `localStorage` under
`atlas-rent-optimizer-v1`. Nothing is transmitted anywhere. Different devices
keep separate copies by design.

## Model assumptions

Parcel rates, badge thresholds and boost-tier bands are community-documented
rather than published by Atlas Reality, and can change without notice. Costs
used: parcel 100 AB, badge 200 AB, legendary upgrade 2,500 AB. New parcels are
modelled at the average rarity draw, 1.58 × 10⁻⁹/sec. All constants sit at the
top of `app.js` (`RATES`, `TIERS`, `BADGES`) if you need to correct them.

## If you later put this in an app store

Keeping the game's name out of the app title and icon, and the "unofficial"
notice prominent, reduces trademark risk — but doesn't eliminate it. Apple's
guideline 4.2 also rejects thin website wrappers; the offline mode here helps,
and the SRB notifications would help more. Worth a legal opinion before paying
the $99/year.
