# Cap Fashion — local site

Personal capsule-wardrobe site from the [v1 specification](../docs/superpowers/specs/2026-11-15-cap-fashion-design.md). Sections: Home, Capsules, Try-on studio, Gallery, Wardrobe (Elements-style), Shopping, Queue, Legend; Profile opens from the avatar. The UI follows FASHN's layout and visual language in simplified form: icon rail, serif display titles (self-hosted Noto Serif Display), Geist UI type, image-first tiles. FASHN's logo, name and assets are not used.

## Run

```sh
cd app
npm install        # first time only
npm start          # build the UI and serve http://127.0.0.1:4317
```

`npm run serve` starts the server without rebuilding. For UI work, run `npm run dev:server` and `npm run dev:client` (Vite on 5317, proxying the API).

Checks: `npm run check`, which runs typecheck, server tests (acceptance A02, A04–A09, A11) and the production build.

## Running as a background service

The site runs as the user LaunchAgent `ai.deus.capfashion` (`~/Library/LaunchAgents/ai.deus.capfashion.plist`). It starts at login, restarts on crash and logs to `~/Library/Logs/capfashion/`. If it stopped during a generation run, it resumes the run on start; jobs that were only queued wait for "Запустити".

- After UI changes: `cd app && npm run build`. No restart is needed: the server reads `dist/` from disk.
- After server changes: `launchctl kickstart -k gui/$(id -u)/ai.deus.capfashion`.
- Stop: `launchctl bootout gui/$(id -u)/ai.deus.capfashion`.

## Addresses

- Mac: http://127.0.0.1:4317
- Private domain: **https://capfashion.exmachina**, served by the owner's existing `exmachina-domains` gateway (route added 17.11.2026; see that gateway's README). Each device needs Tailscale DNS and the Exmachina root profile installed once.
- Tailnet fallback: `https://<this-mac>.<tailnet>.ts.net:10443` via `tailscale serve`.

## Photo intake and outfit analyzer

- **Додати фото** is the only upload control (`/api/upload?kind=intake`). Codex triages each photo (JSON schema, read-only sandbox, one upload at a time):
  - a single person full length or face becomes a base photo, with the agent's standard check;
  - garments become candidates marked «нова», or extra evidence on an existing unconfirmed candidate (model match or the same title);
  - a label close-up fills only empty brand/size/composition.
  Identity is never inferred by comparing faces, and confirmed items are never changed by recognition. A packshot is queued for each new item, or for a photographed item that lacks a cover.
- **Підібрати образи** (`POST /api/analyze {prompt}`) asks Codex to build 4–6 outfits from existing items only. The result is saved as a capsule of kind `selection` («Підбірки»); ids outside the wardrobe are dropped.
- Interactive jobs (intake, analyzer, try-on) run before batch packshots.
- Every look should show the owner: new selections queue a try-on per look, and `POST /api/renders/missing` queues one for every look without a render (needs base photos). Covers show the render or an explicit generating/queued state; capsule pages list their items separately.
- Variety: the analyzer receives existing looks and selection names to avoid; an empty request gets an unused theme; the server drops looks that repeat an existing one except for a single piece and numbers repeated names.

## Editing and deleting

Capsules, selections, looks, items, renders, packshots, products, needs and queue jobs can be edited or deleted from their cards; deletes need confirmation and cascade (`DELETE /api/<collection>/:id`). Chat originals and uploads retained as references cannot be deleted from the photo archive. Inactive and merged items are hidden except in the «Неактуальні» filter.

## Performance

API responses and static assets are gzip-compressed (state ≈ 28 KB on the wire). `/api/state` omits result prompts and non-try-on job snapshots. Thumbnails come in three sizes (160/480/960), are generated in the background for every new photo and on start, and concurrent requests for one file share a single `sips` run.

## Data

### Earlier recommendations and inspiration

«Капсули → Усі образи» combines the catalogue across capsules and selections. Representatives differ in at least two of top / layer / bottom / shoes; one-slot changes and accessory changes stay in secondary variant groups. This is a structural filter, with visual styling review still required.

«Галерея → Натхнення» shows archived chat illustrations with themes and source attribution. `server/inspiration.ts` imports a checksumed local reference manifest through the shared locked store, deduplicates by SHA-256, and copies display files into `media/inspiration/`. It never sends references through photo intake or changes inventory/base photos. Personal manifests, captions, source mapping and generated results remain in ignored local storage.

- Personal data: `../.local/app-data/` (Git-ignored), containing `db.json`, `db.prev.json` (last valid copy), `media/uploads`, `media/renders`, `media/thumbs` and `jobs/<id>/` (prompt, Codex log, result).
- First start seeds from the 25 chat photos, `.local/wardrobe-candidates.json` (47 candidates), the 14 November capsule/shopping notes and the first Urban Casual concept. Nothing is auto-confirmed.
- Writes are locked, atomic and validated. A stale edit gets `409` instead of overwriting newer data. Originals are never modified. HEIC uploads keep the original and add a JPEG copy (`sips`).

## Try-on generation

"Запустити" adds a job (a frozen snapshot of items and base photos) and processes the queue sequentially with the local Codex CLI. No chat is needed.

- Binary: the Codex bundled with `/Applications/ChatGPT.app` (it knows current models such as `gpt-6.1-sol`); override with `CAPFASHION_CODEX_BIN`.
- Isolation: `codex exec --ignore-user-config --ephemeral -s workspace-write -C .local/app-data/jobs/<id>`. Personal Codex config (including its env block) is not loaded. Inputs are attached with `-i`; the model writes only into the job folder.
- Model and effort are set in Профіль → Генерація.
- The result is saved as "На перевірці". The owner chooses "Прийняти" or "Переробити" with a reason, which queues a linked retry.
- Identity is pinned in `profile.identity`: untouched originals, exact-pixel face/body crops, optional hair-only crop, SHA-256 and owner presentation choices (current: direct front gaze, neat original-length/colour hair, no glasses). New jobs freeze this contract; the runner verifies bytes before calling the image tool and sends identity references first, then face-free garments, at most five files total. Full-person clothing photographs cannot compete with the pinned face. Actual selected input paths are recorded in `jobs/<id>/references.json` and result sources. Old attempts without this contract require a fresh try-on. Prior renders never supply identity or physique.
- All personal originals remain reference material (`preserveAsReference`), separate from generated media. Gallery «Мої фото» shows original records; «Згенероване» contains try-ons/packshots and «Натхнення» holds styling references. New uploads retain original bytes (including HEIC alongside display JPEGs), and removing an item/base selection does not remove the reference archive. Local checksum inventory: `.local/personal-photo-references.json`.
- Owner-designated facial originals use `Photo.referenceRole: 'face'` and appear in «Обличчя», with a profile shortcut. Their original bytes and order are separately archived in `media/face-references/2026-11-17/` with `.local/face-references/2026-11-17.json`. They are not automatically triaged as clothing or used for physique. A rejected identity setup sets `disabledReason`; new/frozen retry jobs stay `needs_data`, and the worker refuses older queued try-ons using that setup. Packshots remain available. Input integrity is not output likeness acceptance.
- Owner removal of rejected faces uses `Result.hiddenAt`: originals and attempt files remain in local history, while the API state omits hidden results, their comparison pairs and queue result links. No site view can choose them as covers or gallery images. Personal rendering is currently stopped by owner instruction; catalogue packshots remain active.

## Packshots and concept images

New wardrobe uploads automatically get a three-dimensional catalogue image on white. Tops and bottoms use an invisible mannequin. Footwear and accessories keep their natural shape and visible depth. Upper garments can use the private file `media/packshot-style/upper.png` under the data directory as a lighting and volume example. Original item photos supply the garment itself. Existing covers can be regenerated with «Нове фото» or `POST /api/packshots` (`{all:true}` or `itemIds`). Desired item types get a concept image (`{allNeeds:true}`). Only a successful PNG from the job's own output path can replace a cover. Both generated image types are stored apart from originals in `media/packshots/`. Capsule and look covers use them in a collage until a try-on exists. Jobs share the queue, with two concurrent workers by default.

## iPhone access (Tailscale)

The server listens only on `127.0.0.1`. To open it from the iPhone inside the tailnet:

1. In Профіль → Генерація та доступ, set the owner's Tailscale login.
2. Publish the loopback port inside the tailnet only (HTTPS port 10443 is free; 443/8443/9443/32401 are used by other services):

   ```sh
   tailscale serve --bg --https=10443 http://127.0.0.1:4317
   ```

3. Open `https://<this-mac>.<tailnet>.ts.net:10443` on the iPhone.

Requests whose Host is not loopback, or that carry proxy headers, must have a `Tailscale-User-Login` header equal to the configured login; otherwise they get 403. Mutating API calls also require the site's `x-capfashion` header, which blocks cross-site form posts. Never use `tailscale funnel` for this site.

Enabled 17 November 2026 with the owner's approval: `https://<this-mac>.<tailnet>.ts.net:10443`, owner login set in settings. The server must be running (`npm start`) for the phone to connect.

Rollback: `tailscale serve --https=10443 off`.
