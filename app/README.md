# Capsula app

The web app: a React 19 + Vite interface (`src/`) and a Node 24 server (`server/`) that runs straight from TypeScript. Sections: Home, Capsules, Try-on, Gallery, Wardrobe, Shopping and Profile.

## Run

```sh
cd app
npm install        # first time only
npm start          # build the UI and serve http://127.0.0.1:4317
```

`npm run serve` starts the server without rebuilding. For UI work, run `npm run dev:server` and `npm run dev:client` (Vite on 5317, proxying the API).

Checks: `npm run check` runs the typecheck, the server tests and the production build.

## Two modes

- **Local** (no Google credentials): one wardrobe, stored in `../.local/app-data/` and ignored by Git. It starts empty. AI work runs through the local Codex CLI (`CAPSULA_CODEX_BIN` overrides the binary), with model and effort set in Profile.
- **Accounts** (`GOOGLE_CLIENT_ID` and the other settings in [`../deploy/capsula.env.example`](../deploy/capsula.env.example)): Google sign-in by invitation, one folder per account, the OpenAI API, monthly allowances, a hard monthly budget and rate limits. Without an API key, production runs Codex on the owner's own ChatGPT subscription, and then only the owner can sign in. [`../deploy/README.md`](../deploy/README.md) describes the production setup.

## How it works

- **Add photos** is the only upload control. Each photo is triaged: a person becomes a base photo, garments become wardrobe candidates, and a label close-up fills in brand, size and composition. Faces are never compared to infer identity, and confirmed items are never changed by recognition. HEIC uploads keep the original and add a JPEG copy.
- **Capsules** are distinct styles with a closed set: up to 10 garments, 3 pairs of shoes and 3 accessories (`src/capsule-pieces.ts`). `PATCH /api/capsules/:id {pieces, base}` saves a set; looks outside it are refused (409). New looks and the advisor build only from a saved set, and the next purchase is ranked by the new combinations it adds. `node server/capsule-sets.ts` prints the current sets read-only.
- **Try-ons** freeze a snapshot of the look and the base photos into a job. The face and build come only from the person's own photos, never from earlier renders; each result waits for «Це я?» («Is this me?») and can be redone with a reason.
- **Packshots**: new wardrobe pieces get a catalogue image on white, stored apart from the originals.
- **Shopping** searches real products for a missing piece, with the nearest store or «online», a size from the known sizes and a fit score.

## Data

- Every wardrobe is one `db.json` with `db.prev.json` (the last valid copy) and its media folders. Writes are locked, atomic and validated; a stale edit gets `409` instead of overwriting newer data. Originals are never modified.
- Deletes need confirmation and cascade (`DELETE /api/<collection>/:id`).
- API responses and static assets are gzip-compressed. Thumbnails come in three sizes (160/480/960) and are generated in the background.

## Remote access in local mode

The server listens only on `127.0.0.1`. To reach a local wardrobe from a phone, publish the port inside your tailnet with `tailscale serve` and set your Tailscale login in Profile. Requests whose Host is not loopback, or that carry proxy headers, need a `Tailscale-User-Login` header equal to that login; otherwise they get 403. Mutating API calls also need the `x-capsula` header, which blocks cross-site form posts. Never use `tailscale funnel` for this.
