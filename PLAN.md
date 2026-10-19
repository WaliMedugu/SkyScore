# SkyScore — Full Build Plan

**Credit for young farmers, underwritten from space.**
Team Tensor Labs · InnovateX 2026 (Track A: Credit Solutions for Youths) · Abuja regional, 20 Oct 2026

This is the engineering blueprint for the complete product: a satellite analysis engine, a public API, a bank console with a public website, and a Flutter field app. Everything below is built for real, with real satellite data. Only the parts that need Ecobank's own systems (core banking, BVN lookups, real SMS) are simulated, and each sits behind an adapter so the real thing can be swapped in.

---

## 1. What the system does, end to end

```
 Agent (Flutter)             SkyScore API                         Data sources (free)
 ───────────────             ────────────                         ───────────────────
 1 Register farmer  ───────► identity adapter (BVN, sandbox)
 2 Map farm (GPS/tap) ─────► farms
 3 Submit application ─────► analysis job ──────────────────────► Sentinel-2 optical (greenness, cloud, water)
                              │                                    Sentinel-1 radar (sees through cloud)
                              │                                    ESA WorldCover 2021 + Impact Observatory 2017-23 land cover
                              │                                    NASA POWER rainfall 2017→today
                              ▼
                             engine: seasons → cultivation evidence → SkyScore → offer
 4 Show score + offer ◄────── application (APPROVED / REVIEW / DECLINED, ghost-farm flag)
 5 Farmer consents (OTP) ──► loan + tranche-1 voucher ───────────► SMS adapter (outbox)
 6 Dealer scans voucher ───► redeem → core-banking adapter pays dealer (ledger)
 7 Weekly satellite check ─► monitoring: green-up → release tranche 2 / hold; stress; flood → insurance
 8 Farmer repays via USSD ─► USSD (Africa's Talking format) → core-banking debit → ledger → loan closed
 Loan officer (web) ───────► portfolio map, review queue, farm detail, alerts, policy, USSD simulator
 Anyone (web /explore) ────► draw any field in Nigeria → live analysis → score (ghost-farm test for judges)
```

## 2. Components and stack

| Component | Path | Stack | Why |
|---|---|---|---|
| Engine | `packages/engine` | TypeScript, pure functions, Vitest | All scoring logic in one tested, explainable place; used by API and scripts |
| API | `apps/api` | Node 24, Hono, `node:sqlite`, Zod | One process, no native dependencies, runs offline on a laptop; OpenAPI docs |
| Web | `apps/web` | Vite, React 19, TypeScript, Leaflet, d3-scale/shape | Public site + `/explore` + bank console; served by the API in production |
| Field app | `apps/field` | Flutter 3.47, http, flutter_map, geolocator, mobile_scanner, qr_flutter, shared_preferences | Android APK for agents and dealers; Windows build, and a web build hosted at `/field/` |
| Data snapshots | `data/snapshots` | JSON | Real analyses of showcase and portfolio farms so the demo works with no internet |
| Scripts | `scripts` | TypeScript (tsx) | Find real farms, build snapshots, seed |

Run model: `npm install` → `npm run seed` → `npm start` serves API + web on `http://<laptop>:8080`. Phones join over Wi-Fi/hotspot.

## 3. Satellite analysis (the core)

Verified against live services on 18 Oct 2026.

### 3.1 Sources
| Source | Endpoint | What we read | Notes |
|---|---|---|---|
| Sentinel-2 L2A (10 m) | Planetary Computer STAC + `/data/v1/item/statistics` | One call per photo: NDVI stats, cloud fraction (SCL 3/8/9/10), water fraction (SCL 6) | Expression `(B08-B04)/(B08+B04);((SCL==3)|(SCL==8)|(SCL==9)|(SCL==10))*1.0;(SCL==6)*1.0` |
| Sentinel-1 RTC (radar) | same | VV, VH backscatter → dB, radar vegetation index RVI = 4·VH/(VV+VH) | Fills the May–Aug cloud gap; flood = VV < −18 dB |
| ESA WorldCover 2021 | same, `categorical=true` | % cropland (class 40) in the field | Land-cover cross-check |
| Impact Observatory LULC 2017–2023 | same | % crops (class 5) per year | Per-year cross-check; known to label smallholder fields "rangeland" (11), so weighted low |
| NASA POWER | `power.larc.nasa.gov` monthly | Rainfall per month 2017→now | Drought/excess-rain context, insurance trigger |
| True-colour / NDVI images | `/data/v1/item/bbox/{bbox}/{w}x{h}.png` | Time-lapse frames of the field | Cached as PNG |
| Base map | Esri World Imagery tiles | High-res context imagery | Attribution shown |

### 3.2 Resilience
The Planetary Computer connection drops intermittently (seen in testing). The client therefore has: 20 s timeouts, 4 retries with exponential backoff and jitter, concurrency limit 6, a SQLite response cache (past scenes are immutable → cached forever), and an **offline mode** that answers only from cache/snapshots.

### 3.3 Scene selection
Per farm: search 2018-01-01 → today, `eo:cloud_cover < 80`, keeping the 2 lowest-cloud scenes per rainy month and 1 per dry month for **history**. The **monitoring seasons** (the current and previous year) are read in full: every photo April–November (`eo:cloud_cover < 99`, because a green reading through cloud still proves a crop) and every Sentinel-1 pass February–November. Radar uses one viewing track per year (the one with most passes) so readings compare. Drop a photo from history if the field's own cloud fraction > 15% or fewer than 60% of pixels are valid. The history model judges every year on the same photo budget (2 clearest per rainy month), because peak statistics drift upward with more photos.

### 3.4 Season model (Nigeria's single rainy season, North/Middle Belt)
For each season year Y, on a smoothed daily NDVI curve (median-of-3 + linear interpolation, gaps > 45 days left open):
- `preMin` = min NDVI 1 Mar–20 Jun (land prepared / bare)
- `peak`, `peakDate` = max NDVI 1 Jul–31 Oct (radar RVI rise, from monthly medians, used when the optical peak window is cloud-blocked)
- `postMin` = min NDVI 1 Nov Y – 31 Jan Y+1 (harvested)
- `amplitude` = peak − preMin, `senescence` = peak − postMin
- `homogeneity` = NDVI std across field pixels at peak (fields are uniform, bush is patchy)
- `flood` = water fraction > 0.2 or radar VV < −18 dB in Jul–Oct
- `rainfallAnomaly` = (May–Oct rain − 2017–now mean) / mean

**Cultivation evidence (0–1)** per season, from a transparent points system: amplitude ≥ 0.25, preMin ≤ 0.35, peak ≥ 0.5, senescence ≥ 0.2, homogeneity ≤ 0.12, minus a penalty when dry-season NDVI stays high (woodland) or the whole year stays below 0.2 (buildings/rock). Label: `CULTIVATED` (≥ 0.65), `UNCERTAIN`, `NOT_CULTIVATED` (< 0.35), `NO_DATA`. Thresholds are calibrated on real farm vs. non-farm fields during seeding (§7) and live in policy.

### 3.5 Neighbourhood comparison
For each season's best peak photo, one extra stats call over a ~1.2 km box around the farm. The farm's peak NDVI is ranked against that box's pixel histogram → **percentile vs. neighbours** (crop vigour factor).

## 4. SkyScore (0–100, explainable)

| Factor | Points | Measure |
|---|---|---|
| Farming history | 30 | Share of the last 6 evaluable seasons with `CULTIVATED`; recent seasons weigh more |
| Crop vigour | 20 | Mean peak percentile vs. neighbours |
| Consistency | 10 | Coefficient of variation of peak NDVI across cultivated seasons |
| Climate resilience | 15 | Flood seasons, drought exposure, and how the field held up in dry years |
| Land-cover agreement | 10 | WorldCover cropland share (+ IO crop share trend) |
| Farmer profile | 15 | BVN verified (5), IITA/hub training (5), cooperative or prior on-time repayment (5) |

Bands: **A** ≥ 80 · **B** 65–79 · **C** 50–64 · **D** 35–49 · **E** < 35.
Decision: A/B → recommend approve; C → officer review, smaller loan; D/E → decline with reasons and next steps.
**Ghost-farm rule:** ≤ 1 cultivated season in the last 6 **and** land-cover cropland < 25% → `GHOST_FARM`, score capped at 15, auto-decline. Every point carries a plain-English reason.

**Gates that turn an automatic approval into an officer review** (all in policy):
- *Land-cover gate:* WorldCover cropland < 20% — the maps disagree with the satellite story.
- *History gate:* fewer than 3 clearly farmed seasons, or under half of the readable ones.
- *KYC gate:* BVN not verified — KYC must be complete before any disbursement.

**Calibration on real fields (Oct 2026):** the 4 showcase farms score 86–97 (band A); 30 portfolio farms 48–97; a town and a woodland score 15 (ghost). The bush at Zuma Rock greens up like a crop in 2024–25 and is sent to review by the land-cover gate rather than approved.

## 5. Offer, loan and money flow

- **Input package per hectare** (policy, editable; sample 2026 prices): maize = hybrid seed 25 kg ₦45,000 + NPK 15-15-15 ×4 bags ₦160,000 + herbicide 4 L ₦24,000 (tranche 1) + urea ×2 bags ₦90,000 (tranche 2). Rice, sorghum, soybean, millet, groundnut, cowpea, cassava, yam packages also defined.
- **Amount** = package × hectares × band multiplier (A 1.0, B 0.85, C 0.6), capped at ₦500,000 for a first loan; cap rises after on-time repayment (graduation ladder).
- **Pricing** (policy): 6% flat for the season + 4% parametric insurance premium. Ecobank sets real pricing.
- **Tranches:** T1 (seed, NPK, herbicide) on acceptance as a voucher; T2 (urea) released only when satellite green-up is verified 4–7 weeks after planting, otherwise held and an agent visit is raised.
- **Vouchers:** code `SKY-XXXX-XXXX` + QR; redeemable at any registered agro-dealer; on redemption the dealer's Ecobank account is paid. No cash reaches the farmer, so the loan can't be diverted.
- **Repayment:** after harvest (crop calendar), by USSD or agent; partial payments allowed.
- **Ledger:** double-entry (`loan_receivable`, `dealer_settlement`, `interest_income`, `insurance_premium`, `farmer_account`); every movement balanced and auditable.
- **Loan states:** `OFFERED → ACCEPTED → ACTIVE (T1 issued) → T1_REDEEMED → T2_RELEASED | T2_HELD → REPAID | DEFAULTED | RESTRUCTURED`, plus `DECLINED`.

## 6. Monitoring (in season)
Runs on demand and on a timer, for the real "today" or a **replay date** (so a past season can be replayed week by week with real data in the demo).
| Rule | Trigger | Action |
|---|---|---|
| Green-up proven | A clear photo with NDVI ≥ bare level + 0.15, **or** any photo ≥ 0.45 even if flagged cloudy (cloud only lowers NDVI), **or** radar VH ≥ +3 dB over the bare pre-season on the same track | From week 4: release T2 voucher; the planting date is read from the first green photo |
| No crop (evidence of absence) | After week 7: ≥ 2 clear photos of bare ground, or flat radar over ≥ 3 passes | Hold T2, critical alert, agent visit |
| Unverified | After week 7 with clouds hiding everything and radar inconclusive | Warning for an agent visit; T2 waits — clouds alone never trigger "no crop" |
| Crop stress | Last two clear readings ≥ 0.15 below a healthy crop of that age | Alert + advice SMS |
| Flood | Water ≥ 20% on a mostly clear photo, or VV ≤ −20 dB (or two passes ≤ −18 dB); paddy rice only counts deep water after week 6 | Alert, insurance claim, restructuring offer |
| Harvest | NDVI falls ≥ 0.2 from the season's peak after maturity | Repayment reminder SMS |
| Overdue | Still owing after the due date (which includes grace) | Defaulted, alert, SMS |

Alerts whose condition clears (the crop came up, or recovered) are closed automatically.

## 7. Real data for the demo
`scripts/find-farms.ts` searches farming areas in Kaduna, Kano, Niger and the FCT: it samples 1-ha squares that WorldCover marks as cropland, checks recent seasons for a clear crop cycle, and keeps the best. It also picks **non-farm controls** (woodland, town) for the ghost-farm demo. `scripts/build-snapshots.ts` runs the full analysis and writes JSON snapshots:
- 4 showcase farms with full 2018→2026 history (with saved time-lapse photos) + 3 non-farm controls (a town, a woodland, the bush at Zuma Rock);
- 30 portfolio farms in 4 clusters (2020→2026, every photo of 2024–26), turned into 32 farmers, a repaid 2024 season and the 2025 season monitored week by week from the actual photos.
Farmer names and identities are synthetic. Satellite data is real.

## 8. API (REST, `/api/v1`, JWT, OpenAPI at `/openapi.json`, docs at `/docs`)
- `POST /auth/login`, `GET /auth/me`
- `GET|POST /farmers`, `GET /farmers/{id}`, `POST /farmers/{id}/verify-bvn`
- `GET|POST /farms`, `GET /farms/{id}`, `GET /farms/{id}/analysis`, `POST /farms/{id}/analyze`, `GET /farms/{id}/scenes`, `GET /scenes/{sceneId}/image?farm=&kind=rgb|ndvi`
- `POST /analyses` (any polygon, sandbox), `GET /jobs/{id}`, `GET /jobs/{id}/events` (SSE)
- `GET|POST /applications`, `GET /applications/{id}`, `POST /applications/{id}/decision`, `POST /applications/{id}/otp`, `POST /applications/{id}/accept`
- `GET /loans`, `GET /loans/{id}`, `POST /loans/{id}/monitor`, `POST /loans/{id}/repayments`, `GET /loans/{id}/ledger`
- `GET /vouchers/{code}`, `POST /vouchers/{code}/redeem`
- `GET /dealers`, `GET /portfolio/summary`, `GET /portfolio/map` (GeoJSON)
- `GET /alerts`, `POST /alerts/{id}/ack`, `GET /sms`
- `POST /ussd` (Africa's Talking compatible, `text/plain` CON/END)
- `GET|PUT /policy`, `GET /health`
Roles: `officer`, `agent`, `dealer`, `admin`. Demo users are seeded (credentials in `apps/api/src/seed/users.ts`).

## 9. Design system (Ecobank brand × Aspen Search layout)
**Colour (from ecobank.com):** Navy `#023448` (Aspen's charcoal role), Deep Blue `#005B82`, Sky Blue `#0082BB`, Lime `#BED600` (Aspen's mint role; also "healthy crop"), Mist `#F7F7F7`, Fog `#ECECEC`, Line `#D8D8D8`, Slate `#4E4E4E`. Status: healthy = lime, watch = amber `#F5B400`, stress = `#E4572E`, flood = sky blue, ghost/no data = `#9AA5AB`.
**Type:** Geist (Swiss grotesk, free, close to Aspen's Suisse Intl) at display sizes with −4% tracking and regular weight; Geist Mono uppercase for labels, buttons and metadata.
**Layout language from Aspen:** strict modular grid with visible 1 px rules; square corners; colour-block cells; oversized stat numerals with small captions at the bottom; `■ SECTION` mono labels; `LABEL →` mono buttons; halftone (dithered) imagery — here, real Sentinel-2 photos of Nigerian farmland rendered as navy dots; a live clock in the nav (Lagos / Accra / Lomé / Nairobi, Ecobank cities); light/dark toggle.
Same tokens in Flutter (`ThemeData`, zero radius, Geist fonts bundled).

## 10. Screens
**Web — public:** Landing (hero grid, "LOOK BEFORE YOU LEND.", problem stats, how it works, ghost-farm proof, why Ecobank, data credits) · `/explore` (draw any field → live analysis streaming in; showcase farms one tap away).
**Web — console** (`/console`, officer login): Overview (stat tiles, health mix, activity) · Portfolio map · Applications queue · Application/loan detail (score + factors, NDVI history with seasons, radar and rainfall, time-lapse, land cover, neighbours, offer, decision, tranches, replay monitor, ledger, SMS) · Alerts · Dealers & vouchers · USSD simulator · Policy editor · link to API docs. **Dealer page** `/dealer` (enter code → confirm delivery).
**Flutter — SkyScore Field:** login & server · home · new application (farmer + BVN → crop & planting → map boundary by GPS walk or taps → review) · live analysis · result & offer · OTP consent · voucher QR · farmers & farm detail · dealer mode (scan & redeem) · settings.

## 11. Security, privacy, compliance
JWT with role checks on every route; PINs hashed (scrypt); consent recorded for BVN lookup and data use (NDPA 2023); farm imagery is public data and only the field polygon is stored; audit log of every decision; secrets in `.env`; no real money moves in the sandbox.

## 12. Build order and checks
1. Engine + unit tests (season model, evidence, score, offer, ledger, monitoring).
2. Satellite client + analysis CLI; find real farms; build snapshots (calibrate thresholds on real data).
3. API + DB + adapters + jobs/SSE + USSD + OpenAPI; API tests.
4. Web: design system → landing → explore → console → dealer → USSD; verified in the browser.
5. Flutter app; verified on Windows/web; Android APK built.
6. End-to-end run of every flow; offline-mode run; README + team brief update.

## 13. Known limits (say these honestly)
- Cloud cover hides May–Aug optical data; radar narrows the gap but isn't a perfect substitute.
- Satellites prove a field is farmed, not who farms it: identity relies on BVN, the agent's GPS walk, and hub/cooperative membership.
- Thresholds are calibrated on a small real sample; a pilot would recalibrate on Ecobank's repayment data.
- Core banking, BVN and SMS are sandboxed adapters until Ecobank grants API access.
