# Master data

Source spreadsheets (kept in the repo root):

- `SITE LIST  2026.xlsx` → 73 running sites (name, full address, pincode).
- `staff convayance.xlsx` → 33 staff (name; designation/department inferred
  from in-cell labels like *Driver*, *electrician*, *Plumber*, *Helper*,
  *Site Supervisor*, *Sales Exe*).

These are flattened into `data/seed-data.json`, consumed by `prisma/seed.ts`.

## Geocoding

Addresses are geocoded to coordinates at seed time. The bundled extractor maps
each address's 6-digit pincode to an approximate centroid (a curated table of
the 38 pincodes in the dataset, spanning Delhi NCR, Gurugram, Faridabad, Noida,
plus out-station sites: Agra, Jaipur, Lucknow, Kanpur, Gwalior, Indore, Raipur,
Ludhiana, Amritsar, Bathinda, Mohali, Bengaluru). A small deterministic jitter
separates co-located sites so the distance engine produces non-zero legs.

**For production accuracy**, set `GOOGLE_MAPS_API_KEY` and re-geocode each site
to street-level precision (the Sites admin screen stores exact lat/lng per
site, and the distance engine then uses Google road distances directly).

## Regenerating `data/seed-data.json`

The JSON was produced by a one-off Python pass over the two `.xlsx` files using
`openpyxl` (pincode → centroid map + designation inference). Edit the curated
pincode table / inference rules in that script if the source data grows, or
maintain sites directly through the in-app **Sites** admin once deployed.

## Conveyance rates (seeded defaults)

| Mode | Rate |
|------|------|
| Bike | ₹4 / km |
| Car  | ₹11 / km |
| Metro | ₹60 flat / trip |
| Bus  | ₹30 flat / trip |
| Cab / Auto | actual fare (receipt-based) |

Editable at **Settings** (Super Admin).
