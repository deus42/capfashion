# Source recovery status

Checked: 15 November 2026. **All 14 visible conversation turns and all 25 listed user photo uploads are recovered locally.**

Supplementary recovery checked 17 November 2026: **all 29 illustrative reference assets are now archived and imported into the site's «Натхнення» gallery**. The 17 formerly unavailable HTTPS URLs returned JPEGs; each file has a size and SHA-256 receipt. Repeat import adds zero records. The original 15 November manifest is preserved under ignored `output/inspiration-import/`.

## Source and exports

- Chat: [Нагадай чорну п’ятницю](https://chatgpt.com/c/6af7f006-e118-83eb-b866-adda58c27655), dated 14 November 2026.
- [Full visible browser export](../sources/chatgpt/browser-conversation.json): exact rendered text, DOM message IDs, visible links and per-turn image counts. Exported UTF-16 length of 31,083 code units matches the saved file.
- [Readable chronological transcript](../sources/chatgpt/2026-11-14-fashion-capsules.md): all 14 user/assistant pairs, from the initial Black Friday question to the final jacket-liner photo.
- [Chat file inventory](../sources/chatgpt/browser-file-inventory.json), [local checksum/provenance manifest](../sources/manifest.local.json), [photo gallery](../output/source-gallery.html).
- The earlier partial connector JSON/transcript and pagination receipts remain in `sources/chatgpt/` as provenance, superseded by the full browser export for coverage.

## Verified coverage

| Material | Result |
| --- | --- |
| Visible conversation | 14 user/assistant pairs; merged scroll windows have an unambiguous order |
| User uploads | 25 named JPEG files, all copied; 11,382,125 bytes total |
| User photo references | 25 across batches of 10, 10, 4 and 1, matching the file-panel count |
| Other downloadable documents | No non-image document was listed in the chat's file panel |
| Curated notes | Confirmed preferences, original three capsules, later variations, wardrobe observations and shopping proposals |
| Extra illustrative web images | 29 archived and available in the site (17 November); previously 12 archived / 17 unavailable |

All copied files have size and SHA-256 entries in the local manifests. A native download of `IMG_1034.jpeg` matched its connector-provided copy exactly. The 25-upload set is complete against the observed file list; no cloud conversation or unrelated original was deleted.

## Limits

- Camera-original resolution/metadata is not established; these are files as supplied by ChatGPT. The first ten connector files are 1152 × 1536 JPEGs.
- Provided filenames and the file-panel sequence are preserved. Individual filename-to-message mapping is not independently verified; local gallery numbers are navigation labels.
- The [reference manifest](../sources/references.local.json) preserves all 29 archived illustrative assets and their source URLs. Web illustrations are separate from the 25 user uploads. Gallery titles/themes are visual curation; exact illustration-to-message mapping is not established.
- The export covers the visible conversation branch. Hidden reasoning, internal tool calls, deleted material and alternate branches are outside the claim.
- Historical prices, promotions and store facts were preserved as source content and were not revalidated as current recommendations.
