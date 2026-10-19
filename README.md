# SkyScore

**Credit for young farmers, underwritten from space.**
Team Tensor Labs — InnovateX 2026 (Track A: Credit Solutions for Youths), Abuja regional.

SkyScore reads every Sentinel-2 photo and Sentinel-1 radar pass of a farmer's field since 2018, proves the field is real and farmed, scores it 0–100 with plain-language reasons, lends the inputs as dealer vouchers (never cash), and watches the crop all season from space — releasing the second tranche only when the satellites see it come up, flagging stress and floods, and reminding the farmer to repay at harvest by USSD.

Everything runs for real on real satellite data. Only the systems that need Ecobank's own access — core banking, BVN lookup and SMS — are sandbox adapters with production-shaped interfaces.

---

## Run it (one laptop, no internet needed)

Requirements: **Node 22.13+** (tested on Node 24). Flutter 3.47 only if you want to rebuild the field app.

```bash
npm install
```

```bash
npm start
```

`npm start` builds the website and starts the server on **http://localhost:8080**. On first run it creates the demo bank from the saved satellite data (about 3 seconds). The terminal prints the LAN address for phones on the same Wi-Fi.

| Address | What |
|---|---|
| `/` | Public site |
| `/explore` | Draw any field in Nigeria (or pick a real one) and watch the satellites read it |
| `/console` | Loan officer and field agent console |
| `/dealer` | Agro-dealer counter (scan or type a voucher, get paid) |
| `/field/` | The Flutter field app, in the browser |
| `/docs` | API reference (OpenAPI at `/openapi.json`) |

**Demo sign-ins** (sandbox only) are listed in [`apps/api/src/seed/users.ts`](apps/api/src/seed/users.ts): a loan officer, two field agents, two agro-dealers and an admin. Seeded farmers share one USSD PIN, also in that file.

Useful commands:

```bash
npm run seed
```
Wipes the database and rebuilds the demo bank (business date 20 Aug 2025, mid-season).

```bash
npm run dev
```
API with auto-restart plus the website with live reload on http://localhost:5173.

```bash
npm test
```
Engine and API tests (48 tests; the API suite runs offline against the saved snapshots).

### Settings (`.env` in the repo root, all optional)

| Key | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Server port |
| `SKYSCORE_OFFLINE` | off | `1` = answer satellite questions only from saved data (venue without internet) |
| `SKYSCORE_SANDBOX` | on | Shows one-time codes on screen and enables the sandbox deposit tool |
| `SKYSCORE_DEMO_CLOCK` | on | Business dates follow the replayable season clock; `0` = real today |
| `SKYSCORE_LOAN_SEASON` | `2025` | The season the demo book lends in |
| `SKYSCORE_JWT_SECRET` | generated into `data/.secret` | Token signing key |
| `SKYSCORE_USSD_SECRET` | none | If set, the USSD callback needs `?key=` |

---

## Deploy to Vercel

The repo is ready to import as-is: [vercel.json](vercel.json) runs [scripts/build-vercel.mjs](scripts/build-vercel.mjs), which writes Vercel's Build Output directly.

1. On vercel.com: **Add New → Project → Import** this GitHub repository.
2. Leave every setting as detected (framework *Other*, build command from `vercel.json`) and press **Deploy**. No environment variables are required.

What gets deployed:

- **The website and the field app (`/field/`)** as static files on Vercel's CDN.
- **The whole API as one Node.js 24 function** in London (`lhr1`, close to Nigeria and to the satellite archive in West Europe). It carries the 37 real-field snapshots and a pre-seeded demo bank. A cold start copies that bank into the function's `/tmp` in a few milliseconds.
- **The explorer** streams a whole analysis — photos, partial verdicts, the score and an offer for every crop — in a single request, so it works the same on serverless as on a laptop.

Optional environment variables: `SKYSCORE_JWT_SECRET` keeps people signed in across redeploys (otherwise each deployment generates its own key); `SKYSCORE_REGION` moves the function (default `lhr1`); any of the settings above.

Good to know: serverless instances don't share a disk. Each one starts from the seeded bank, and changes made in the console (approvals, new loans, a replayed season) last while that instance is warm and reset on a cold start or a redeploy. That suits demos and judging. For a long session where several devices must see the same changes — say, the field app and the console together at the venue — run `npm start` on a laptop or VM instead.

Test the Vercel build locally:

```bash
npm run build:vercel
```

---

## The five-minute demo

1. **Landing (`/`)** — the halftone images are real Sentinel-2 photos of a field near Zaria, morphing from dry season to rainy season. The live numbers come from the sandbox book.
2. **Explore a real farm (`/explore` → Kachia)** — 273 photos stream in; the eight-year greenness chart shows a crop every rainy season; SkyScore 97, band A, with six explained factors and a sized maize input offer.
3. **Catch a ghost farm** — pick *Gwagwalada town* (or draw a box on any town): SkyScore 15, "no farming history detected — this looks like a ghost farm."
4. **Console overview (`/console`)** — the loan book on a satellite map. Press **Play** on *Season replay*: the business date walks from May to October and every loan is re-checked from space with the photos that existed on that date (green-up, tranche releases, harvest alerts).
5. **Review queue** — open the application sent to review (a thin farming record, or a missing BVN). Approve with a note → **Text the farmer a consent code** → enter the 6-digit code → the loan opens with a QR voucher for tranche 1 and tranche 2 held until green-up. **Check from space now** reads the planting date from the photos.
6. **Agro-dealer (`/dealer`)** — type or scan the voucher → *Inputs handed over* → the dealer's account is paid instantly; the ledger balances.
7. **USSD (`/console/ussd`)** — dial `*326*77#` on a farmer's phone: check the loan, see farm health from space, repay with the PIN.
8. **Field app (`/field/` on a phone, or the APK)** — a field agent maps a field by GPS walk or taps, and watches it scored live.

---

## How it is built

```
packages/engine      Pure TypeScript: season model, SkyScore, offer, monitoring, loan state machine, ledger (26 tests)
packages/satellite   Microsoft Planetary Computer client (STAC + titiler statistics), NASA POWER, retries, cache, offline mode
apps/api             Node + Hono + node:sqlite: REST API, analysis jobs with live SSE, lending, vouchers, USSD, OpenAPI (22 tests)
apps/web             Vite + React 19: public site, field explorer, console, dealer counter (Leaflet + d3)
apps/field           Flutter 3.47: field agent and agro-dealer app (Android, Windows, web)
scripts              Find real farmland, build/refresh the satellite snapshots, calibration and monitoring reports, icons
data/snapshots       37 real fields with their full satellite history and saved photos (works offline)
```

The full engineering blueprint — scoring table, gates, monitoring rules, money flow, API list, design system — is in [PLAN.md](PLAN.md).

### Credit model in one paragraph

Each rainy season is judged from the field's greenness curve (bare before planting, a sharp crop peak, a drop at harvest), with radar filling cloudy months, land-cover maps as a cross-check and NASA rainfall for drought context. The **SkyScore** adds six weighted factors: farming history 30, crop vigour vs. neighbours 20, consistency 10, climate resilience 15, land-cover agreement 10, farmer profile 15. Land with ≤ 1 farmed season in 6 and no cropland on the maps is a **ghost farm** (score capped at 15, declined). Thin farming records, maps that disagree, or a missing BVN send an otherwise approvable case to a loan officer. The offer is the crop's input package × hectares × band multiplier, capped by a graduation ladder that rises with each on-time repayment. Every threshold lives in the credit policy, editable in the console and validated before it's saved.

### Monitoring without false alarms

Rainy-season photos are mostly cloudy, so the monitor proves a crop with any of: a clear photo greener than the bare field, a photo greener than 0.45 *through* cloud (cloud only ever lowers greenness), or radar VH up 3 dB on the same track. It only declares "no crop" from evidence of absence — clear photos of bare ground or flat radar — never from clouds alone.

---

## The field app

```bash
cd apps/field
flutter run -d windows
```

On first launch, enter the server address the terminal printed (for example `http://192.168.1.20:8080`) and sign in as a field agent or agro-dealer.

To rebuild the in-browser copy served at `/field/`:

```bash
npm run build:field
```

Android APK (needs the Android SDK licences accepted on this machine once):

```bash
cd apps/field
flutter build apk --release
```

---

## Data and licences

- Contains modified **Copernicus Sentinel** data (2018–2026), accessed via the **Microsoft Planetary Computer**.
- **ESA WorldCover 2021** (CC BY 4.0); **Impact Observatory / Esri** annual land use land cover (CC BY 4.0); **NASA POWER** rainfall.
- Map imagery on screen © Esri, Maxar, Earthstar Geographics.
- Fonts: **Geist** and **Geist Mono** (SIL Open Font License, see `apps/field/assets/fonts/OFL.txt`).

Refresh the saved fields (needs internet, about 15 minutes; responses are cached so re-runs are quick):

```bash
npm run snapshots
```

## Honest limits

- Satellites prove a field is farmed, not who farms it: identity relies on BVN, the agent's GPS walk and hub or cooperative membership.
- Green-up proves vegetation; a weedy field can look green. The tranche check is backed by the dealer's hand-over record and agent visits.
- Thresholds are calibrated on 37 real fields; a pilot would recalibrate on Ecobank's repayment data.
- Core banking, BVN and SMS are sandbox adapters until Ecobank grants API access. No real money moves.

## Team Tensor Labs

Helen (lead and pitch) · Wali Medugu (engineering) · Joan Ginikachi Azike (research) · Timothy Ojo Adetunji (engineering)
