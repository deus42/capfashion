# Capfashion

Personal fashion and capsule-wardrobe workspace, initialized 15 November 2026.

The source chat is **“Нагадай чорну п’ятницю”**, dated 14 November 2026. All 14 visible user/assistant turns and all 25 listed photo uploads are now local. The original three capsule choices, later variants and shopping notes are preserved with source attribution. See [source status](docs/source-status.md).

## Start here

- [Project brief](docs/project.md)
- [Source recovery and coverage](docs/source-status.md)
- [Capsule plans](docs/capsules/README.md)
- [Recovered wardrobe notes](docs/wardrobe.md)
- [Shopping notes](docs/shopping-list.md)
- [Local photo index](output/source-gallery.html)
- [Archived reference illustrations](output/reference-gallery.html)
- [Original documents](sources/README.md)
- [Photo handling](assets/README.md)
- [Agent instructions](AGENTS.md); [Claude entrypoint](CLAUDE.md)

## Structure

```text
docs/                 Curated project and capsule notes
sources/chatgpt/      Local chat exports (ignored)
sources/documents/    Local original documents (ignored)
assets/photos/        Local original photos (ignored)
assets/derived/       Working copies (ignored)
output/               Generated reports/previews (ignored)
tasks/worklogs/       Local execution checkpoints (ignored)
```

This is a documentation workspace with local Git history. A software application or deployment has not been specified. Original personal material stays outside Git; no remote publication is configured.

## Vault

Run from this directory before work:

```sh
node /Users/deus/Projects/Vault-Tec/scripts/vault-preflight.mjs
```

The shared project record is [Capfashion Current State](/Users/deus/Projects/Vault-Tec/35%20Context/Projects/Capfashion%20Current%20State.md). Vault holds the project map and workflow context; source photos and raw chats remain here locally.
