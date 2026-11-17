# Project brief

## Purpose

Keep the existing fashion/capsule work, original photos and future wardrobe decisions in one local workspace with reliable continuity between agents.

## Current scope

- Source recovery is complete: preserve all 25 photos, the visible conversation and their provenance.
- Build a source-backed candidate wardrobe catalogue; every item requires owner confirmation.
- Maintain the [Cap Fashion v1 specification](superpowers/specs/2026-11-15-cap-fashion-design.md), accepted as the implementation basis on 17 November 2026, and the local site in `app/` that implements it.
- Keep agent instructions, task checkpoints and the Vault project map synchronized.

## Working method

Confirmed in the recovered user messages: comfortable, relaxed smart casual for a remote-work lifestyle; an interest in Tommy Hilfiger/Tom Tailor-style outfits alongside existing sportswear; little use for formal suits. The user preferred the original three capsule proposals and asked to reproduce them exactly. Navy chinos and white Adidas Stan Smith were explicitly confirmed as already owned. These are source decisions, not new assumptions.

Originals are evidence. Curated notes distinguish direct user decisions, visible garment observations, assistant proposals and unresolved questions. Each capsule plan should identify its use case, included item/photo references, combinations, gaps and acceptance status; create a plan when source material supports it.

Use copies for photo transformations. Keep original filenames and order in a local source manifest even when readable working names are introduced. Record missing or unavailable attachments explicitly.

## Boundaries

Personal originals and derived images stay in ignored local storage. The user separately authorized scoped prototypes in FASHN and through Codex, and site-triggered local Codex generation; this is not public-sharing, subscription-purchase or deployment authorization. The site runs on loopback; iPhone access through `tailscale serve` needs the owner's explicit go-ahead.

## Current next step

Use the local site: upload new front-facing base photos in Профіль (to the base-photo standard), confirm wardrobe candidates, then run the corrected Urban Casual try-on from Примірка and review it there. Owner measurements and item confirmations remain open inputs. The source-status note retains the separate web-illustration limits.
