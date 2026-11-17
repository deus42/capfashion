# Photos and working assets

- `photos/`: original uploaded photos, preserved without alteration.
- `derived/`: contact sheets, crops and other working copies.
- `references/`: downloaded illustrative web references from the chat, with provenance in `sources/references.local.json`.

These directories are local and ignored by Git. Preserve source order and filenames in the local manifest. Do not place private images in shared Vault or a public gallery.

All personal originals/selfies remain reference material, independent of the current base-photo or wardrobe selection. New uploads live in `.local/app-data/media/uploads/`, exact original-derived crops in `media/identity-*/`; generated try-ons and packshots live only in `media/renders/` and `media/packshots/`. The ignored `.local/personal-photo-references.json` records original filenames, paths, source dates, bytes and SHA-256. Site gallery «Мої фото» is separate from «Згенероване» and «Натхнення». Original records are protected from deletion; derived/generated images never replace their bytes.
