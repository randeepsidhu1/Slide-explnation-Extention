# Explain This Slide

The next version is planned in [the MVP implementation plan](docs/MVP_PLAN.md): a PDF study companion with whole-document access, page citations, and saved conversations. For now, the extension uses a local Node.js backend and your own Gemini API key. Simplifying installation and removing the backend are deferred.

A local Chrome extension that explains the visible slide or learning webpage and includes a PDF study viewer. Click its toolbar icon to choose **Explain visible tab** or **Open PDF study viewer**. **Alt+Shift+E** explains the visible tab (or the selected page in our study viewer); **Alt+Shift+P** opens the PDF viewer. Screenshot explanations appear in a card on ordinary pages or a small extension window when injection is blocked.

This prototype uses **Gemini's Free tier**. It does not use a ChatGPT subscription or an OpenAI API key. OpenAI's Sign in with ChatGPT plan-usage flow for publicly released, closed-source apps requires selection and registration as a private/commercial partner; the self-registration flow is for open-source or personal local tools. See [OpenAI's quickstart](https://developers.openai.com/siwc/quickstart) and [client registration guidance](https://developers.openai.com/siwc/request-client-id).

## Requirements

- Chrome
- Node.js 20.6 or newer (needed for built-in `.env` loading)
- A Gemini API key from a Google AI Studio project with **Free** shown as its billing tier and **no billing account attached**

The backend uses `gemini-3.5-flash-lite`, which Google lists with Free-tier pricing and image input. [Model details](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [pricing](https://ai.google.dev/gemini-api/docs/pricing). Gemini billing is determined by the key's project. This application cannot inspect a key's billing tier itself, so **you must verify the project in [Google AI Studio Projects](https://aistudio.google.com/app/projects) before using the key**. Do not link billing or upgrade that project. Google documents that upgrading to paid requires linking a billing account, while an unbilled project remains on the Free tier. [Gemini billing guide](https://ai.google.dev/gemini-api/docs/billing).

## Run locally

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder in this repository.
2. Copy the extension's 32-character **ID** shown on that page.
3. Open `backend/.env` (created for local setup). On a fresh clone, copy `backend/.env.example` to `backend/.env` first. Fill in these values:

   ```dotenv
   GEMINI_API_KEY=your-key-from-an-unbilled-project
   EXTENSION_ID=your-extension-id
   GEMINI_UNBILLED_PROJECT_CONFIRMED=1
   ```

   Set the confirmation to `1` only after verifying the project is unbilled. The `.env` file is ignored by Git; keep the real key there, never in `.env.example` or the extension source. Existing terminal environment variables take precedence over `.env` values.

4. From the repository root, run `cd backend` then `npm start`. The startup command automatically loads `backend/.env`; no package installation or shell-specific environment commands are needed. Restart the backend after changing `.env`.
5. Open learning material, click the extension icon, and select **Explain visible tab**, or use **Alt+Shift+E**. Change shortcuts at `chrome://extensions/shortcuts`.

The backend listens only on `127.0.0.1:8787` and accepts requests from the configured extension ID. Keep it running while using the extension. Each trigger captures only the visible portion of the selected tab, not the whole document. On a PDF, navigate to the desired page before triggering. Chrome does not permit injection into some pages, including its PDF viewer, `chrome://` pages, and the Web Store. The extension window handles the first two when capture is permitted; Chrome may still refuse capture on protected pages.

## Study a PDF

After updating the code, restart the backend and click **Reload** on the extension card at `chrome://extensions`.

1. Click the extension icon → **Open PDF study viewer**, or press **Alt+Shift+P**.
2. Click **Open PDF** and choose a local PDF (up to 50 MiB and 500 pages).
3. Use the arrows or page-number field to navigate; use the zoom control to adjust the page.
4. Click **Explain this page**. The selected page's image and extracted text go through your backend to Gemini, and the explanation appears in the conversation panel.
5. Expand **Page text & document reading** to inspect the page text and progress through all pages. Extraction runs locally and does not call AI. Pages without extractable text use their rendered image for explanations.

### Ask questions and follow up

- Type a question in the panel and click **Ask**, or press **⌘/Ctrl+Enter**. Follow up with another question, **Why?**, **Give an example**, or **Explain the equation**.
- Choose **Current page** to use only that page as document evidence. **Explain this page** always uses this scope, regardless of the question selector.
- Choose **Whole PDF** once local extraction finishes. Short PDFs supply all extracted text; longer PDFs use local lexical search across the document to select relevant passages. Up to three page images accompany the text. Search is based on words and recent question context; it does not guarantee finding every synonymous or indirectly related passage.
- Click the blue **p. N** references to navigate to a cited physical PDF page. Hover a reference to preview its excerpt. Printed page labels can differ from physical page numbers.
- Expand the context beneath an answer to see the supplied pages, image pages, text coverage, provider/model, and how many previous exchanges were included. Source validation checks that a reference belongs to supplied material; it cannot prove the model interpreted that material correctly.
- Navigate and zoom without clearing earlier messages. Changing pages stops an unfinished question and keeps its cancelled state in the transcript. **Stop** also cancels an in-flight request. **New chat** clears the tab's current conversation.

Recent complete exchanges are sent as conversation context, capped at 12 exchanges / 24000 characters. Earlier messages remain visible even when omitted from a request; failed and cancelled turns are not reused as answers. Current-page evidence remains restricted even if earlier discussion mentioned other pages.

PDFs are limited to 50 MiB / 500 pages. Long documents use bounded excerpts (up to 64000 source-text characters), not an exhaustive review on every question. Full summaries/complete-list requests that exceed this budget stop with an explanation before calling AI; batch summaries are a later feature. Whole-PDF search cannot search scanned or unreadable text; coverage gaps are shown, and such pages can still be discussed through their image in **Current page** mode. Text selection, OCR, and automatic import from an already open PDF tab are not implemented. Password-protected PDFs need an unlocked copy.

The PDF, index, and conversation live only in the viewer tab. Closing/reloading it or opening another PDF clears them; saved sessions across visits are the next step. Requests are stopped locally and cancellation is forwarded by the backend, but the provider may already have processed the request.

## Privacy and limits

Capture happens only after selecting **Explain visible tab** or pressing its shortcut. The card is hidden before a new screenshot is taken. PDF import, text extraction, and search stay local. An explicit question sends the chosen sources, bounded page images, and selected conversation history through the backend to Google. The extension and backend do not save PDFs, screenshots, explanations, or history to disk. The backend does not log their contents. The Gemini API key stays in the backend environment and is never bundled into the extension.

The screenshot is sent to Google. Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) states that Free-tier content may be used to improve its products. Review the [Gemini API terms](https://ai.google.dev/gemini-api/terms) before capturing sensitive material.

Free-tier rate limits vary by model and project. When Gemini returns a quota error, the card shows an error and the backend does not retry or switch to another model or provider. The code cannot prevent charges if a **paid project key** is supplied or if billing is later enabled on the key's project; keeping that project unbilled is the required billing safeguard.

For temporary 503 service-unavailable errors, the backend retries the same model twice, waiting 1 second and then 2 seconds, within a shared 60-second request deadline. It never switches models automatically. If all three attempts fail, test Gemini 3.5 Flash-Lite in Google AI Studio using the same project to help check availability. After updating backend files, press Ctrl+C in its PowerShell window and run `npm start` again to load the changes.

## Development

Run `npm test` inside `backend` for the request and provider adapter tests. The integration is isolated in `backend/gemini-provider.js`; the `/explain` response contract stays the same if the provider changes later.

The extension includes PDF.js 6.4.299 and its worker/assets under `extension/vendor/pdfjs/` (Apache-2.0; bundled font/codec notices are included). No dependency installation is required to load the extension. PDF.js provides [document loading and page rendering](https://mozilla.github.io/pdf.js/examples/).

For development, use Node.js 22.13 or newer at the repository root:

```sh
npm ci
npm run vendor       # reproduce the bundled PDF.js files
npm test             # PDF extraction and document lifecycle tests
npx playwright install chromium
npm run test:browser # temporary browser profile, mocked AI; no key or running backend needed
```

The browser check covers the actual unpacked extension and real backend request validation with mocked AI inference: PDF rendering, navigation/zoom, page/whole-document context, distant-page retrieval, follow-up history, citation navigation, safe rendering, cancellation/retry, and isolation between documents. Live Gemini availability and answer/citation quality still require a manual test with your configured local backend.
