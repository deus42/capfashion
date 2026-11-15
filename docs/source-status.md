# Source recovery status

Checked: 15 November 2026. Status: **correct chat identified; partial recovery verified**.

## Source

- Chat: [Нагадай чорну п’ятницю](https://chatgpt.com/c/6af7f006-e118-83eb-b866-adda58c27655), 14 November 2026.
- Retrieval: Codex app `read_thread`, maximum supported 10 turns and 20,000 characters per item; all returned page cursors followed to exhaustion.
- Original connector response: [local JSON](../sources/chatgpt/6af7f006-e118-83eb-b866-adda58c27655.json).
- Readable chronological text: [local transcript](../sources/chatgpt/2026-11-14-fashion-capsules.md).
- Provenance and photo checksums: [local manifest](../sources/manifest.local.json).
- [Photo index](../output/source-gallery.html).

## Verified coverage

| Material | Recovered | Limit |
| --- | --- | --- |
| Conversation | 5 visible user/assistant turns | Opening Black Friday/style/capsule-selection discussion is absent from returned text |
| Recovered photo files | 10 JPEGs, 4,042,056 bytes | Visible user messages reference 25 images: batches of 10, 10, 4 and 1 |
| Capsule notes | 4 combinations summarized from recovered assistant text | Direct user selection/acceptance is absent |
| Downloadable documents | None exposed in returned turns | Full-chat document coverage remains unknown |

All 10 copied files match the connector-provided source bytes by SHA-256. Provided filenames and connector order are preserved. Camera-original resolution/metadata is not established by this preview-file retrieval. The connector does not associate returned file paths with individual messages; photo-to-message mapping remains unverified.

## Remaining recovery

- Retrieve at least 15 further images referenced in visible messages; filenames are not exposed by the connector.
- Recover the opening discussion and any documents/earlier attachments there.
- Confirm original message/photo mapping before using image numbers as garment identifiers.

The connector reports `hasMore: false` after five visible turns, but those turns refer to earlier capsule choices. End of pagination establishes exhaustion of available connector output, not a complete original conversation. Both browser sessions reached a different account with older history; no source material was taken from that account.

The cloud conversation and unrelated originals were retained. Recovery is not complete until missing material is retrieved or the user explicitly accepts this coverage boundary.
