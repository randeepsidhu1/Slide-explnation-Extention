# Explain This Slide — MVP implementation plan

Status: implementation in progress; see the checkpoint below for delivered scope.

Updated: October 28, 2026.

Distribution: open-source Chrome extension downloaded from GitHub.

Primary outcome: understand a PDF, ask follow-up questions with page references, and return later to the same saved conversation.

### Current implementation checkpoint

The owner chose to retain the local backend for the MVP. Extension-only distribution and simpler installation are deferred to a separate issue. The first delivered increment provides a bundled PDF.js viewer, local file import, navigation/zoom, all-page text extraction, and explanations of a selected page through the existing backend. The owner manually tested that increment successfully. A local-file-first viewer was built before the conversation panel to validate actual PDF input with the already working backend. The broader milestones below remain incomplete until their exit criteria are met.

Validation for this increment: 10 backend tests and 4 document tests pass. Playwright with Chromium 145 verified the unpacked extension's PDF.js 6.4.299 worker, rendering under extension CSP, extraction of all three fixture pages, navigation/zoom, selected-page-only payloads, stop/page-change cancellation, provider error recovery, invalid-file recovery, and pages without text. Browser AI responses were intercepted; no live Gemini request or billing-tier verification was performed. The owner must restart their existing backend and reload the extension to manually verify the updated live flow. Optional MIME handling is not implemented in this increment.

The second increment adds a conversation panel inside the PDF viewer, a `/chat` backend endpoint, current-page and whole-PDF scope, recent complete-turn history, local lexical retrieval for long PDFs, bounded page images, clickable physical-page citations, context receipts, retry/stop, and new-chat/document isolation. Navigation and zoom preserve the transcript; navigation cancels unfinished turns. Short PDFs supply all extracted text; long PDFs supply up to 20 relevant chunks within a 64000-character source budget. Exhaustive tasks too large for that budget are rejected before inference instead of being answered from incomplete coverage. History uses at most twelve complete turns / 24000 characters, with omissions shown. Images are limited to three per answer; unreadable text coverage is disclosed. Citation validation checks source identity and page range, not semantic entailment.

Validation for the second increment: 14 document/context tests and 19 backend tests pass. Chromium 145 browser checks exercise the real backend validation/citation contract with AI inference mocked, including a genuinely long PDF, distant-page search, follow-ups, scoped evidence, page links, unsafe text, request cancellation, and a late answer after switching PDFs. No live Gemini requests were made during these checks. The owner must restart the backend/reload the extension and manually assess live answer and citation quality. Data is still in memory only; content identity, saved sessions/reading position, local deletion controls, selected-passage context, OCR, multi-round retrieval/batch overviews, streaming, and study tools remain outstanding. This increment does not claim full M3/M4/M5 completion.

## 1. Product contract

A user downloads the repository/release, loads the unpacked extension, configures their own API key in the local backend's `.env`, and runs that backend using Node.js. No account with us or server operated by us is required. The user's selected AI provider receives the material needed for their requests and applies its own billing, quota, and data policies.

The MVP is complete only when the following work together:

| Capability | Expected behavior |
| --- | --- |
| PDF access | Open an accessible PDF from the active tab or choose a local PDF; read it in our study viewer. |
| Whole-document access | Search and connect content across every successfully indexed page, not only the visible page. |
| Context controls | Choose selected passage, current page, or whole document; show what each answer actually used. |
| Citations | Document-based claims include clickable references that open their supporting PDF pages. |
| Persistent conversation | Ask follow-ups in a side panel without replacing earlier answers. |
| Saved sessions | Reopen the same PDF and resume its locally saved conversations and reading position. |
| Screenshot fallback | Explicitly capture the visible tab when the original document is unavailable. |
| Basic study tools | Generate and save a small quiz or flashcard set and bookmark useful explanations. |
| Local cache controls | Reuse extraction/indexing; delete a conversation, forget a document, or clear all local data. |

Deferred: other file formats, cross-document learning memory, cloud sync, accounts, collaboration, spaced repetition scheduling, local AI integration, automatic background study generation, ChatGPT subscription login, Chrome Web Store publication, and a desktop application. Document learning history is included; inferring a persistent learner profile is deferred.

### Core user journeys

1. **First use:** load extension → configure/start local backend with own key → open PDF → ask a question → click a cited page.
2. **Continued study:** select an equation → ask for an explanation → ask “Why?” → get an answer using the relevant previous exchange and cited material.
3. **Return later:** restart Chrome → enter key again → reopen saved PDF → resume the existing conversation and page position without re-indexing unchanged content.
4. **No usable PDF:** invoke screenshot action → preview the capture → send → ask follow-ups in a separate screenshot session.
5. **Remove data:** forget a PDF → its bytes, index, conversations, bookmarks, and study sets disappear and cannot be recreated by an outstanding request.

## 2. Engineering decisions

### Runtime and dependencies

- Keep Manifest V3 and JavaScript ES modules. Use a lightweight development build only where needed to bundle dependencies; ship an already-built extension folder.
- Use PDF.js for rendering, text extraction, text selection, and page navigation. Bundle its worker and assets; do not load executable code from a CDN.
- Use IndexedDB for PDFs, extracted content, indexes, conversations, and study artifacts. Use `chrome.storage.local` only for small preferences. API keys stay in the local backend's environment, loaded from its ignored `.env`.
- Never send keys to the extension, content scripts, sync storage, logs, exports, or source control. Preserve extension-origin validation and bind the backend to loopback only.
- Implement Gemini and OpenAI API-key adapters behind the same interface, Gemini first to reuse existing behavior. Model choices must be verified during implementation rather than copied indefinitely from the prototype. No automatic provider or model switching.
- Keep provider adapters and native `fetch` in the local backend; introduce streaming there when the chat flow needs it. Never call undocumented ChatGPT endpoints or ask for account passwords/session cookies.
- Do not add a framework, vector database, embeddings service, or cloud backend for the MVP. Add dependencies only for concrete requirements such as PDF parsing, safe Markdown/math rendering, and local OCR.

### Application layout

```text
Chrome toolbar / keyboard shortcut
                  │
          background coordinator
           /                 \
 study viewer tab         study side panel
 (PDF.js, selection)       (chat, history, study tools)
           \                 /
             shared application services
       documents · retrieval · sessions · citations
                  │                   │
              IndexedDB        local Node.js backend
                               provider adapters → Gemini / OpenAI
```

The service worker coordinates tab actions, capture, and validated messages. It is not the durable conversation store. The visible panel owns requests to the backend; the backend owns provider inference and the viewer owns PDF rendering/indexing workers. Closing an owning UI interrupts its task safely. Persist checkpoints and reconcile unfinished work when the UI reopens; do not depend on a service worker staying alive.

Suggested modules (names may change; boundaries should not):

```text
extension/
  manifest.json
  background.js
  viewer/                 # PDF tab, page controls, selection bridge
  panel/                  # chat, document library, study tools
  options/                # provider, key, data controls
  core/
    db.js                 # schema, transactions, migrations
    documents.js          # imports, hashing, ownership, removal
    indexing.js           # extraction/OCR checkpoints
    retrieval.js          # local search and context assembly
    conversations.js      # durable turns and history selection
    citations.js          # source validation and navigation
    study.js              # quiz, flashcards, bookmarks
    providers/
      interface.js
      gemini.js
      openai.js
  vendor/                 # bundled runtime dependencies/assets
tests/                    # unit, browser integration, fixtures
scripts/                  # build and release packaging
```

Reuse screenshot capture and outdated-response protection in `background.js` and retain `backend/gemini-provider.js`. Provider modules in the suggested layout belong under `backend/` for the current architecture. Replace the floating card and fallback window with the shared panel once parity is demonstrated. Backend removal belongs to the deferred installation issue.

## 3. PDF acquisition and document identity

Use an explicit **Open PDF in study viewer** action. Acquisition order:

1. Already in our viewer: reuse the existing document and active page.
2. Accessible PDF URL: fetch bytes in an extension context with narrowly scoped access; verify content rather than trusting a `.pdf` suffix.
3. Chrome 151+ MIME handler: feature-detect and offer integrated PDF handling after testing it. This replaces the native viewer; it does not extract arbitrary state from an already open native viewer. Keep an opt-out and native-viewer fallback. Do not make this API a baseline requirement.
4. Local file picker: reliable import path for local files, inaccessible downloads, authenticated links, and unsupported embedded viewers.
5. No document available: offer screenshot mode, clearly marked as limited to visible content.

Avoid assuming authenticated, blob, embedded, POST-generated, or expiring URLs can be fetched again. Show a useful file-picker alternative instead of retrying forever. Request website permissions when needed; do not request access to every site on installation. Never fetch arbitrary URLs supplied by untrusted webpage messages.

Compute `documentId = SHA-256(original PDF bytes)`. Identical content reopened under another name or URL reuses its data. Different bytes create a separate document even if the filename is unchanged. Do not merge histories based on URL or filename alone. For the MVP, a changed PDF starts a new session; manual version linking is deferred.

Store original PDF bytes locally by default so saved sessions and citations work after restart without fetching the source again. Show this behavior on import and offer forgetting the document. File selection does not require broad filesystem permissions. Handle password-protected PDFs with an in-memory password prompt; never persist the password.

Initial application limits: 50 MiB per imported PDF, 500 pages, extraction/OCR concurrency of at most two pages, and bounded image dimensions. Treat these as product defaults, not provider limits; provider payload/context limits may be lower. Reject oversized files before expensive processing. Check storage capacity, catch quota errors, and preserve existing conversations on failed import. Validate these defaults against fixtures before release.

## 4. Whole-document access and answer grounding

### Index once, reuse locally

- Extract all pages with stable physical page numbers (1-based), optional printed page labels, headings, and text chunks. Preserve page boundaries, text positions where feasible, and extraction version.
- Start with a local lexical index (BM25 or equivalent) and heading/page lookup. No external embedding requests in the MVP.
- Detect pages with little usable text. Offer local English OCR for scanned pages with progress and cancellation; bundle the required runtime/model assets in the release. Flag OCR-derived text and unreadable pages. Additional OCR languages are deferred.
- Render page images on demand for equations, charts, and visual questions; text extraction alone does not establish understanding of a diagram. Use a bounded image cache.
- Persist page checkpoints. On interrupted indexing, resume incomplete pages without reprocessing completed pages. Display indexed-page coverage; never label a partial index as complete.

### Context selection

| Mode | Context sent |
| --- | --- |
| Selected passage | Selected text, its page identity, minimal surrounding context, and an image crop/page if requested. |
| Current page | Current page text and relevant page image; no silent expansion to the entire PDF. |
| Whole document | Retrieval across all indexed pages, current-page context when relevant, and pertinent conversation history. |
| Screenshot | User-approved visible-tab capture and that screenshot session's history; no implied PDF access. |

For whole-document questions, include a document outline, retrieve relevant chunks across the full index, and allow bounded follow-up searches/page reads when the first results are insufficient. Start with a maximum of three retrieval rounds per answer. Expose exactly which pages were used and whether coverage is limited. If the budget is exhausted or evidence is missing, say so rather than fabricate completeness.

Distinguish targeted questions from **exhaustive document tasks**. A whole-PDF summary, quiz covering the entire PDF, or “list every definition” must visit every readable page through bounded batches and combine results, or explicitly report incomplete coverage. A few retrieved excerpts do not satisfy these requests. Preview the extra processing and require the user's action to start; reuse local intermediate results keyed by document, prompt/version, and model. Never trigger paid document-wide processing merely by opening a PDF.

Send the entire short PDF directly only when the selected adapter/model supports it and its byte/token limits permit it; keep local page identity for citations. This is an optimization, not a dependency of document access. For longer documents use the local index and page images. Start with a conservative context budget and reserve output capacity; show a recoverable limit message if a model's constraints cannot be established. Never silently truncate selected material or present a rough token estimate as exact billing.

### Citations

Assign source IDs to excerpts/images before inference: `{ documentId, physicalPage, chunkId, excerpt }`. Require the model to reference those IDs. Convert only known IDs into clickable page chips; reject invented, out-of-range, or unrelated-document IDs. Persist citation sources with the answer so later index rebuilds do not break it.

Clicking a reference focuses/opens our viewer at the physical page and highlights the excerpt when position data exists. Display printed page labels separately to avoid page-number ambiguity. Range validation prevents invalid navigation but does not prove that a claim is supported; validate grounding with the evaluation fixtures. Answers without usable evidence must be labeled accordingly, with no fabricated reference. General teaching examples should be identified as examples rather than quoted document facts.

Treat PDF text, OCR results, screenshots, and prior assistant output as untrusted content. They must not override instructions, request keys, change providers, execute code, or authorize network requests. Render model text safely; allow only validated citation actions and safe links. Support readable math and Markdown without raw HTML execution.

## 5. Saved conversations and storage

Suggested IndexedDB entities:

| Entity | Essential fields |
| --- | --- |
| Document | content hash, title, byte size, page count, timestamps, PDF blob, reading position, processing version/status |
| Page/chunk | document ID, page number/label, text, extraction method, chunk ID, positions, indexing status |
| Index/cache | document ID, format version, search data, optional page images and intermediate summaries |
| Conversation | UUID, document ID or screenshot-session ID, title, created/updated timestamps |
| Message | UUID, conversation ID, turn/request ID, role, content, status, timestamp, citations, context receipt, provider/model |
| Study artifact | UUID, document ID, type, items or bookmarked-message reference, citations, created/updated timestamps |

Keys live outside this database. Do not persist screenshot bytes by default; retain screenshot session text with a visible “image not retained” marker after the session ends. PDF bytes and question histories are local application data, not encrypted backups or cloud storage.

Save the user message before starting inference. Persist assistant output at bounded checkpoints and finalize it atomically. Use explicit states: queued, streaming, complete, cancelled, interrupted, failed. After a restart, unfinished turns become interrupted and offer a manual retry; do not replay paid requests automatically. Never feed failed or incomplete assistant messages into later history as established answers.

Each outgoing answer uses recent complete turns plus older exchanges selected for relevance and, when necessary, a derived conversation summary. Preserve the full original transcript locally. Mark summaries as derived, retain their source message IDs, and do not replace source evidence with a summary. Regenerate/invalidate derived memory when its source conversation is deleted. No cross-document history enters a prompt without a future explicit feature.

One active generation per conversation. Switching tabs/documents must not retarget a pending answer. Bind requests to immutable document/conversation IDs; maintain an ownership/revision guard for writes. Synchronize separate extension windows through durable state and change notifications. Cancelling or deleting a conversation/document aborts outstanding jobs and blocks late responses from recreating deleted records.

Data controls:

- **Delete conversation:** remove its messages and derived conversation memory; retain the PDF and its index.
- **Clear document cache:** remove regenerable extraction/index/render caches; retain PDF, conversations, source snapshots, and study artifacts; allow rebuilding.
- **Forget document:** remove PDF bytes and all related data, including conversations and study artifacts.
- **Clear all local data:** cancel jobs and remove every extension application record/cache/preference; explain that the separately configured backend `.env` remains and must be removed locally to erase its key.

Show approximate storage use and explain the scope of each action. Deletion here does not revoke provider-side retention. Pin user conversations/artifacts against automatic eviction; evict only regenerable caches. Add schema migrations before the first release and test upgrades without losing history. Explain that uninstalling the extension or changing its identity can make local data unavailable; export/import backups are a later feature.

## 6. Provider requests and user experience

The internal adapter accepts normalized text/images, selected history, instructions, cancellation signal, and model settings; it emits text deltas, usage when available, completion, and normalized errors. Provider-specific wire formats stay inside adapters. Validate model capabilities for text/image input. Start with direct inline content, avoiding remote file storage and its cleanup lifecycle.

Keys remain in the local backend `.env`; document how to replace/remove them and restart the server. Provide a backend connection test, active provider/model indicator, and clear quota/auth/network errors. Document that keys use provider API billing/quota and do not automatically draw on a ChatGPT subscription. Do not claim the extension can verify a key's billing tier or guarantee free usage.

Use explicit aborts and a total request deadline. Preserve the existing bounded retry behavior for transient pre-response failures; do not automatically retry a partially streamed answer or an uncertain completed request. Quota/auth failures do not retry. Retry, cancellation, and usage display must not suggest that provider charges can always be reversed.

Panel elements: document title and processing coverage; conversation list; transcript; context selector; composer; send/stop/retry; source chips; “Why?”, “Give an example”, and “Explain this equation” actions. Each answer includes an expandable context receipt: mode, pages used, history inclusion, provider/model, and any coverage limitations. Keep the active document visibly identified when switching tabs. Explicitly open the panel from a user gesture, following Chrome's API requirements.

Screenshot capture must occur before opening/resizing the panel, or use an explicit preview/recapture flow, so the capture matches what the user intended. Hide the old injected card if present. Capture only on a user action, never continuously. No page citations are invented for screenshot answers.

## 7. Delivery milestones

Complete these in dependency order. Each milestone must leave a working increment and record validation evidence before proceeding. M2 depends on M1; M3 on M2; M4 on M3; M5 on M4; M6 on M5; M7 on M6.

### M0 — Prove PDF integration with the local backend

- [ ] Add development/release scripts without changing the current user flow yet.
- [ ] Verify extension-to-backend PDF requests with the existing Gemini adapter first; use a small opt-in live smoke request, never a repository key. Add the second adapter after this path works.
- [ ] Prove PDF.js parsing/rendering inside extension CSP and side-panel opening from a user gesture.
- [ ] Verify backend-key isolation and expected interruption behavior when the viewer/panel closes.
- [ ] Record tested Chrome version, chosen compatible models, dependency versions, and any provider/browser blockers.

**Exit:** a tiny PDF renders and its selected-page explanation returns through the configured local backend. Provider-specific blockers are visible before large implementation work starts. Live checks requiring credentials remain pending until performed; do not claim mocked tests establish live compatibility.

### M1 — Panel, settings, and durable foundations

- [ ] Implement backend adapter contract, connection status, streaming, cancellation, and normalized errors.
- [ ] Add side-panel chat shell and migrate screenshot mode, including preview and capture timing.
- [ ] Add IndexedDB schema/migration layer and durable request state. Test session isolation and cancellation.

**Exit:** fresh install → backend configuration/start → screenshot explanation → follow-up → manual retry on failure, with no secrets in extension messages or stored histories.

### M2 — PDF viewer and reliable imports

- [ ] Add file picker and accessible-active-tab import; verify bytes, limits, password errors, and permission failures.
- [ ] Add content hashing, local PDF storage, library, page navigation, text selection, and reading-position persistence.
- [ ] Add optional MIME handling only after the baseline import paths work; test enable/disable and native fallback.

**Exit:** the same PDF reopened from a new path reuses one document; two different PDFs with the same name stay separate. Cached PDFs reopen after browser restart. Inaccessible URLs offer a useful alternative.

### M3 — Whole-document indexing and local search

- [ ] Implement page extraction, versioned chunks, local index, progress, cancellation, and resumable checkpoints.
- [ ] Implement local English OCR for scanned pages and on-demand page rendering for visual context.
- [ ] Add search/page lookup and truthful coverage reporting for partial, unreadable, or failed pages.

**Exit:** a query finds a known fact on the final page of a long PDF while page one is visible. A scanned fixture becomes searchable after OCR. Reopening an unchanged indexed PDF does not re-extract it.

### M4 — Grounded PDF conversations

- [ ] Implement the three PDF context modes and context receipts.
- [ ] Implement bounded retrieval, follow-up search/page reads, visual inputs, and explicit exhaustive-document processing.
- [ ] Add source-ID citation validation, page navigation/highlighting, safe Markdown/math, and insufficient-evidence behavior.

**Exit:** cross-page questions use relevant distant pages; citations open the correct source PDF/page; selected/current-page modes respect their boundaries. A whole-document summary covers all readable pages or visibly declares incomplete coverage.

### M5 — Resume and manage conversations per PDF

- [ ] Add multiple named conversations per PDF, autosave/checkpoints, restore, and reading-position resume.
- [ ] Add relevant history selection and derived summaries without losing original messages.
- [ ] Handle interrupted turns, concurrent views, request ownership, and tab/document switches.
- [ ] Implement conversation deletion, cache clearing, forgetting, and clearing all data with late-write guards.

**Exit:** after browser restart, the user resumes the same PDF conversation and a relevant follow-up references the earlier discussion. No answers leak between PDFs; deletion during generation leaves no recreated records.

### M6 — Basic study tools

- [ ] Bookmark/unbookmark explanations and list them per PDF.
- [ ] Generate a small flashcard set with question/answer reveal and citations; save, review, and delete it.
- [ ] Generate a short quiz with answers/explanations hidden until submitted or revealed; save locally with citations.
- [ ] Let users choose the source scope. Whole-document sets use the exhaustive path or disclose actual page coverage. Validate generated structure before saving.

**Exit:** users reopen a PDF later and find their saved explanations, quiz, and flashcards. Removing the document removes all linked artifacts. No scheduling or learner-profile engine is needed.

### M7 — Release and end-to-end validation

- [ ] Complete the acceptance matrix below and resolve data-loss, incorrect-citation, credential exposure, and installation blockers.
- [ ] Package a ZIP containing a ready-to-load extension, pinned dependencies/assets, licenses/notices, and no keys, test data, or development-only runtime files.
- [ ] Rewrite README for the new architecture; document provider costs/privacy, local storage, limits, install/update steps, and known PDF/browser limitations. Clearly separate development build requirements from user installation.
- [ ] Test installation and update from extracted releases in a clean Chrome profile with the documented local backend setup.
- [ ] Choose an open-source license with the owner before publishing, and preserve extension identity across updates where possible. Document data persistence boundaries.
- [ ] Retain and test the local backend. Prepare release notes; publishing itself is a separate explicit action.

**Exit:** every included product capability has browser evidence, a fresh user can follow the README, updates preserve saved sessions under the tested identity, and no runtime request reaches infrastructure operated by us.

## 8. Verification and release gates

Use unit tests for the logic that can lose data or produce misleading answers: content identity, retrieval ranking/coverage, context limits, citation mapping, stream parsing across arbitrary chunks, persistence transitions, deletion guards, and migrations. Use browser integration tests for actual extension APIs and IndexedDB behavior. Keep paid provider calls out of automated tests by default; use mocked responses plus an explicit live smoke check per provider before release.

Fixtures should be small, synthetic, and safe to distribute: text PDF, diagram/equation PDF, scanned English PDF, password-protected PDF, corrupt/non-PDF input, same-name/different-content pair, identical-content/different-name pair, and a longer PDF with known facts at the beginning/middle/end plus a clearly irrelevant question.

| Scenario | Release gate |
| --- | --- |
| Cross-document isolation | Switching between two PDFs never mixes history, sources, or responses. |
| Whole-document grounding | Known distant facts are retrievable; exhaustive tasks account for every readable page. |
| Citation quality | References navigate correctly and support evaluated claims; missing evidence is explicit. |
| Visual/scanned material | Image-based explanations work; OCR coverage/errors are shown honestly. |
| Persistence | Browser restart, UI closure, and normal extension update preserve finalized work. |
| Interruptions | Stop, provider timeout, panel closure, and worker restart leave recoverable states without automatic paid replay. |
| Provider failure | Invalid key, quota, unsupported model, offline network, malformed stream, and partial output produce actionable states. |
| Deletion/concurrency | Delete/forget during generation or indexing cannot resurrect data; quota failure does not damage old sessions. |
| Permissions/import | Denied host access, local selection, native PDF viewer, embedded PDF, and unavailable MIME API have tested outcomes. |
| Screenshot mode | Capture matches preview, contains no old card, and never claims full-document context. |
| Study tools | Saved artifacts persist, match declared scope, validate structure, and follow document deletion. |
| Safety/accessibility | Keyboard use, focus, accessible labels, readable math, safe links, malicious PDF/model text, and secret redaction are checked. |
| Distribution | A clean-profile user can run the extension and local backend using the documented installation steps and their own key. |

Performance targets to measure on a named reference laptop: indexed-document reopening shows saved conversation without re-indexing; search over the 500-page fixture stays interactive; extraction/OCR yields to UI input and reports progress; memory does not grow with all full-resolution pages rendered at once. Record actual timings and peak memory in release notes instead of promising hardware-independent latency.

## 9. First implementation session

1. Read this plan and inspect the current manifest/background/provider/tests; do not assume planned modules already exist.
2. Check repository instructions and working-tree changes. Preserve unrelated work.
3. Complete M0 and record the results in this document, including blockers and adjusted limits.
4. Implement M1 through M7 as separate reviewable increments. Update checkboxes only when exit criteria are evidenced.
5. Recheck official documentation when implementing provider/browser integrations. If a documented capability is unavailable in the tested environment, retain a useful fallback and record the limitation rather than silently dropping scope.
6. Do not create external issues, publish releases, or add paid infrastructure as an incidental implementation step. Prepare artifacts locally; execute external actions when requested.

## 10. Deferred GitHub issue draft

**Title:** Support document formats beyond PDF

**Problem:** The first release supports PDF documents and screenshot fallback. Students also use presentation decks, word-processing files, and ebooks.

**Proposed scope:** evaluate PPTX, DOCX, and EPUB adapters behind a shared document interface; preserve logical sections/slides, visual content, stable citations, content identity, and saved conversations. Define format-specific navigation and conversion limitations before implementation.

**Acceptance criteria:** import each explicitly chosen format, retrieve across the document, cite navigable sources, resume its saved sessions, and delete all associated data. Avoid treating a text-only extraction as full visual fidelity. Final format order and implementation belong to the issue, not this MVP.

## 11. Documentation references

Checked while preparing this plan; verify again during implementation. Proposed architecture and application limits above are engineering decisions, not claims of provider guarantees.

- [Chrome side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel): extension panel and user-gesture requirements.
- [Chrome extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests): host permissions and extension-origin requests.
- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): avoid depending on worker globals for durable state.
- [Chrome MIME handler](https://developer.chrome.com/docs/extensions/reference/api/mimeHandler): Chrome 151+ PDF handling, stream access, and native fallback.
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/): document loading and page rendering.
- [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses) and [file inputs](https://developers.openai.com/api/docs/guides/file-inputs): adapter behavior and compatible PDF inputs.
- [OpenAI browser credential guidance](https://developers.openai.com/api/reference/typescript): browser credential exposure tradeoff.
- [Gemini document understanding](https://ai.google.dev/gemini-api/docs/document-processing) and [billing](https://ai.google.dev/gemini-api/docs/billing): provider-specific capabilities and user-owned usage.
- [OpenAI ChatGPT sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [credential guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions): requirements to revisit if subscription login is prioritized later.
