# Explain This Slide

A local Chrome extension that explains the visible slide, PDF page, or learning webpage on demand. Click its toolbar icon or press **Alt+Shift+E**. A card appears on ordinary pages; Chrome's built-in PDF viewer and other pages that block injection use a small extension window.

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
5. Open learning material and click **Explain this slide**, or use **Alt+Shift+E**. Change the shortcut at `chrome://extensions/shortcuts`.

The backend listens only on `127.0.0.1:8787` and accepts requests from the configured extension ID. Keep it running while using the extension. Each trigger captures only the visible portion of the selected tab, not the whole document. On a PDF, navigate to the desired page before triggering. Chrome does not permit injection into some pages, including its PDF viewer, `chrome://` pages, and the Web Store. The extension window handles the first two when capture is permitted; Chrome may still refuse capture on protected pages.

## Privacy and limits

Capture happens only after clicking the icon or pressing the shortcut. The card is hidden before a new screenshot is taken. The extension and backend keep only the current result in memory and do not save screenshots, explanations, or a history. The backend does not log their contents. The Gemini API key stays in the backend environment and is never bundled into the extension.

The screenshot is sent to Google. Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) states that Free-tier content may be used to improve its products. Review the [Gemini API terms](https://ai.google.dev/gemini-api/terms) before capturing sensitive material.

Free-tier rate limits vary by model and project. When Gemini returns a quota error, the card shows an error and the backend does not retry or switch to another model or provider. The code cannot prevent charges if a **paid project key** is supplied or if billing is later enabled on the key's project; keeping that project unbilled is the required billing safeguard.

For temporary 503 service-unavailable errors, the backend retries the same model twice, waiting 1 second and then 2 seconds, within a shared 60-second request deadline. It never switches models automatically. If all three attempts fail, test Gemini 3.5 Flash-Lite in Google AI Studio using the same project to help check availability. After updating backend files, press Ctrl+C in its PowerShell window and run `npm start` again to load the changes.

## Development

Run `npm test` inside `backend` for the request and provider adapter tests. The integration is isolated in `backend/gemini-provider.js`; the `/explain` response contract stays the same if the provider changes later.
