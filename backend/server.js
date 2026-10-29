import http from "node:http";
import { pathToFileURL } from "node:url";
import { explainWithGemini } from "./gemini-provider.js";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const imagePattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export function createServer({ allowedExtensionId = process.env.EXTENSION_ID, explain = (image, page) => {
  if (process.env.GEMINI_UNBILLED_PROJECT_CONFIRMED !== "1") {
    throw new Error("Confirm your key belongs to an unbilled Free-tier project by setting GEMINI_UNBILLED_PROJECT_CONFIRMED=1.");
  }
  return explainWithGemini(image, { apiKey: process.env.GEMINI_API_KEY, page });
} } = {}) {
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    if (request.url !== "/health" && origin !== `chrome-extension://${allowedExtensionId}`) {
      return send(response, 403, { error: "Only the configured Chrome extension may call this local server." });
    }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") return send(response, 204);
    if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
    if (request.method !== "POST" || request.url !== "/explain") return send(response, 404, { error: "Not found." });
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      return send(response, 415, { error: "Expected JSON." });
    }

    let raw = "";
    try {
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > MAX_BODY_BYTES) return send(response, 413, { error: "Screenshot is too large." });
      }
      const payload = JSON.parse(raw);
      const { image, page } = payload || {};
      if (typeof image !== "string" || !imagePattern.test(image)) {
        return send(response, 400, { error: "Expected a JPEG screenshot." });
      }
      if (page !== undefined && (!page || typeof page !== "object" || Array.isArray(page) ||
        !Number.isInteger(page.number) || !Number.isInteger(page.total) ||
        page.number < 1 || page.total > 500 || page.number > page.total ||
        typeof page.text !== "string" || page.text.length > 100000)) {
        return send(response, 400, { error: "Expected valid PDF page context (up to 500 pages and 100000 text characters)." });
      }
      const explanation = await explain(image, page);
      return send(response, 200, { explanation });
    } catch (error) {
      const message = error instanceof SyntaxError ? "Invalid JSON." :
        error.name === "TimeoutError" ? "The AI request timed out. Try again." :
        error.message || "Could not explain this screenshot.";
      return send(response, error instanceof SyntaxError ? 400 : 502, { error: message });
    }
  });
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(body ? JSON.stringify(body) : "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!/^[a-p]{32}$/.test(process.env.EXTENSION_ID || "")) {
    console.error("Set EXTENSION_ID to the 32-character ID shown in chrome://extensions.");
    process.exitCode = 1;
  } else if (!process.env.GEMINI_API_KEY || process.env.GEMINI_UNBILLED_PROJECT_CONFIRMED !== "1") {
    console.error("Set GEMINI_API_KEY and confirm an unbilled Free-tier project with GEMINI_UNBILLED_PROJECT_CONFIRMED=1.");
    process.exitCode = 1;
  } else {
    createServer().listen(8787, "127.0.0.1", () => {
      console.log("Explain This Slide backend listening on http://127.0.0.1:8787");
    });
  }
}
