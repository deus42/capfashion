# Cap Fashion — local site

Personal capsule-wardrobe site from the [v1 specification](../docs/superpowers/specs/2026-11-15-cap-fashion-design.md): capsules, wardrobe, try-on studio, shopping list, profile, try-on queue and legend. The UI follows FASHN's layout in simplified form, without FASHN's logo, name or assets.

## Run

```sh
cd app
npm install        # first time only
npm start          # build the UI and serve http://127.0.0.1:4317
```

`npm run serve` starts the server without rebuilding. For UI work, run `npm run dev:server` and `npm run dev:client` (Vite on 5317, proxying the API).

Checks: `npm run check`, which runs typecheck, server tests (acceptance A02, A04–A09, A11) and the production build.

## Data

- Personal data: `../.local/app-data/` (Git-ignored), containing `db.json`, `db.prev.json` (last valid copy), `media/uploads`, `media/renders`, `media/thumbs` and `jobs/<id>/` (prompt, Codex log, result).
- First start seeds from the 25 chat photos, `.local/wardrobe-candidates.json` (47 candidates), the 14 November capsule/shopping notes and the first Urban Casual concept. Nothing is auto-confirmed.
- Writes are locked, atomic and validated. A stale edit gets `409` instead of overwriting newer data. Originals are never modified. HEIC uploads keep the original and add a JPEG copy (`sips`).

## Try-on generation

"Запустити" adds a job (a frozen snapshot of items and base photos) and processes the queue sequentially with the local Codex CLI. No chat is needed.

- Binary: the Codex bundled with `/Applications/ChatGPT.app` (it knows current models such as `gpt-6.1-sol`); override with `CAPFASHION_CODEX_BIN`.
- Isolation: `codex exec --ignore-user-config --ephemeral -s workspace-write -C .local/app-data/jobs/<id>`. Personal Codex config (including its env block) is not loaded. Inputs are attached with `-i`; the model writes only into the job folder.
- Model and effort are set in Профіль → Генерація.
- The result is saved as "На перевірці". The owner chooses "Прийняти" or "Переробити" with a reason, which queues a linked retry.

## iPhone access (Tailscale)

The server listens only on `127.0.0.1`. To open it from the iPhone inside the tailnet:

1. In Профіль → Генерація та доступ, set the owner's Tailscale login.
2. Publish the loopback port inside the tailnet only (HTTPS port 10443 is free; 443/8443/9443/32401 are used by other services):

   ```sh
   tailscale serve --bg --https=10443 http://127.0.0.1:4317
   ```

3. Open `https://<this-mac>.<tailnet>.ts.net:10443` on the iPhone.

Requests whose Host is not loopback, or that carry proxy headers, must have a `Tailscale-User-Login` header equal to the configured login; otherwise they get 403. Mutating API calls also require the site's `x-capfashion` header, which blocks cross-site form posts. Never use `tailscale funnel` for this site.

Rollback: `tailscale serve --https=10443 off`.
