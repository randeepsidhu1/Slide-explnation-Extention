import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "./server.js";
import { explainWithGemini } from "./gemini-provider.js";

let server;
let base;
before(async () => {
  server = createServer({ allowedExtensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", explain: async () => "The main idea is fractions." });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("accepts a screenshot and returns an explanation", async () => {
  const response = await fetch(`${base}/explain`, {
    method: "POST", headers: { "Content-Type": "application/json", "Origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    body: JSON.stringify({ image: "data:image/jpeg;base64,YQ==" })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { explanation: "The main idea is fractions." });
});

test("rejects other extensions and invalid images", async () => {
  const headers = { "Content-Type": "application/json" };
  const denied = await fetch(`${base}/explain`, { method: "POST", headers: { ...headers, Origin: "https://example.com" }, body: "{}" });
  assert.equal(denied.status, 403);
  const otherExtension = await fetch(`${base}/explain`, { method: "POST", headers: { ...headers, Origin: "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, body: "{}" });
  assert.equal(otherExtension.status, 403);
  const invalid = await fetch(`${base}/explain`, { method: "POST", headers: { ...headers, Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, body: JSON.stringify({ image: "nope" }) });
  assert.equal(invalid.status, 400);
});

test("provider sends an inline image to the free-tier model", async () => {
  let payload;
  let endpoint;
  const result = await explainWithGemini("data:image/jpeg;base64,YQ==", {
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      endpoint = url;
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Explained." }] } }] }) };
    }
  });
  assert.equal(result, "Explained.");
  assert.match(endpoint, /gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(payload.contents[0].parts[1].inline_data.data, "YQ==");
  assert.equal(payload.contents[0].parts[1].inline_data.mime_type, "image/jpeg");
});

test("free-tier quota error does not trigger a paid fallback", async () => {
  let calls = 0;
  await assert.rejects(
    explainWithGemini("data:image/jpeg;base64,YQ==", {
      apiKey: "test-key",
      fetchImpl: async () => { calls++; return { ok: false, status: 429 }; }
    }),
    /free-tier limit reached/
  );
  assert.equal(calls, 1);
});

test("model access errors identify the unavailable model", async () => {
  await assert.rejects(
    explainWithGemini("data:image/jpeg;base64,YQ==", {
      apiKey: "test-key",
      fetchImpl: async () => ({ ok: false, status: 404 })
    }),
    /Gemini 3\.5 Flash-Lite is not available/
  );
});

test("temporary 503 errors retry the same model and recover", async () => {
  const endpoints = [];
  const delays = [];
  let released = 0;
  const result = await explainWithGemini("data:image/jpeg;base64,YQ==", {
    apiKey: "test-key",
    sleep: async (ms) => { delays.push(ms); },
    fetchImpl: async (url) => {
      endpoints.push(url);
      if (endpoints.length < 3) return {
        ok: false, status: 503, body: { cancel: async () => { released++; } }
      };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Recovered." }] } }] }) };
    }
  });
  assert.equal(result, "Recovered.");
  assert.equal(endpoints.length, 3);
  assert.equal(new Set(endpoints).size, 1);
  assert.equal(released, 2);
  assert.deepEqual(delays, [1000, 2000]);
});

test("persistent 503 errors stop after three attempts with a useful message", async () => {
  let calls = 0;
  await assert.rejects(explainWithGemini("data:image/jpeg;base64,YQ==", {
    apiKey: "test-key",
    sleep: async () => {},
    fetchImpl: async () => { calls++; return { ok: false, status: 503 }; }
  }), /still unavailable after 3 attempts/);
  assert.equal(calls, 3);
});
