import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = await readFile(resolve(root, "apps/extension/service-worker.js"), "utf8");
const sidepanelSource = await readFile(resolve(root, "apps/extension/sidepanel.js"), "utf8");
const sidepanelHtml = await readFile(resolve(root, "apps/extension/sidepanel.html"), "utf8");
const defaults = JSON.parse(await readFile(resolve(root, "apps/extension/data/tools.json"), "utf8"));
const cases = [];

function test(name, run) {
  cases.push({ name, run });
}

function makeEvent() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    async emit(...args) { return Promise.all(listeners.map((listener) => listener(...args))); },
    get listeners() { return listeners; }
  };
}

function createHarness({ tabs = [], storage = {} } = {}) {
  const state = {
    tabs: structuredClone(tabs),
    storage: structuredClone(storage),
    navigations: [],
    created: []
  };
  const events = {
    installed: makeEvent(),
    message: makeEvent(),
    updated: makeEvent()
  };

  const chrome = {
    runtime: {
      getURL: (path) => `extension://test/${path}`,
      onInstalled: events.installed,
      onMessage: events.message
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: state.storage[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, state.storage[key]]));
          return structuredClone(state.storage);
        },
        async set(values) { Object.assign(state.storage, structuredClone(values)); }
      }
    },
    tabs: {
      onUpdated: events.updated,
      async query(options = {}) {
        return structuredClone(state.tabs.filter((tab) => !options.active || tab.active));
      },
      async update(id, changes) {
        const tab = state.tabs.find((item) => item.id === id);
        if (!tab) throw new Error("No tab with id");
        if (changes.url) {
          tab.url = changes.url;
          delete tab.pendingUrl;
          state.navigations.push({ tabId: id, url: changes.url });
          await events.updated.emit(id, { url: changes.url, status: "loading" }, structuredClone(tab));
          await events.updated.emit(id, { status: "complete" }, structuredClone(tab));
        }
        Object.assign(tab, changes);
        return structuredClone(tab);
      },
      async create(options) {
        const tab = { id: state.tabs.length + 1, windowId: 1, url: options.url, active: options.active };
        state.tabs.push(tab);
        state.created.push(structuredClone(tab));
        return structuredClone(tab);
      }
    },
    sidePanel: {
      async setOptions() {},
      async setPanelBehavior() {}
    }
  };

  vm.runInNewContext(workerSource, {
    chrome,
    URL,
    Promise,
    Map,
    Array,
    Object,
    JSON,
    Error,
    fetch: async () => ({ ok: true, json: async () => structuredClone(defaults) })
  }, { filename: "service-worker.js" });

  async function send(message) {
    const listener = events.message.listeners[0];
    assert.ok(listener, "service worker message listener should be registered");
    return new Promise((resolveResponse, reject) => {
      try {
        const keepsChannelOpen = listener(message, {}, resolveResponse);
        if (keepsChannelOpen !== true) reject(new Error("message listener must keep the response channel open"));
      } catch (error) {
        reject(error);
      }
    });
  }

  return { state, send };
}

test("default menu puts Codex directly below ChatGPT and uses MV3 Side Panel", async () => {
  assert.deepEqual(defaults.map((service) => service.id), [
    "chatgpt", "codex", "lovable", "github", "cursor", "vercel", "infinityfree"
  ]);
  const manifest = JSON.parse(await readFile(resolve(root, "apps/extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("storage"));
});

test("one active browser tab moves between ChatGPT and Codex and remembers each path", async () => {
  const { state, send } = createHarness({ tabs: [
    { id: 42, windowId: 1, url: "https://chatgpt.com/c/class-chat?draft=temporary#private", active: true }
  ] });

  const toCodex = await send({ type: "activate-service", serviceId: "codex" });
  assert.equal(toCodex.kind, "navigated");
  assert.equal(toCodex.tabId, 42);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.created.length, 0);
  assert.equal(state.storage.serviceUrls.chatgpt, "https://chatgpt.com/c/class-chat");
  assert.equal(state.tabs[0].url, "https://chatgpt.com/codex");

  state.tabs[0].url = "https://chatgpt.com/codex/workspace-7?token=temporary#private";
  await send({ type: "get-state" });
  assert.equal(state.storage.serviceUrls.codex, "https://chatgpt.com/codex/workspace-7");

  const toChatGPT = await send({ type: "activate-service", serviceId: "chatgpt" });
  assert.equal(toChatGPT.kind, "navigated");
  assert.equal(toChatGPT.tabId, 42);
  assert.equal(state.tabs[0].url, "https://chatgpt.com/c/class-chat");

  const backToCodex = await send({ type: "activate-service", serviceId: "codex" });
  assert.equal(backToCodex.kind, "navigated");
  assert.equal(backToCodex.tabId, 42);
  assert.equal(state.tabs[0].url, "https://chatgpt.com/codex/workspace-7");
  assert.equal(state.tabs.length, 1);
  assert.equal(state.created.length, 0);
});

test("clicking the currently active service does not reload or navigate it", async () => {
  const { state, send } = createHarness({ tabs: [
    { id: 5, windowId: 1, url: "https://chatgpt.com/c/active-chat", active: true }
  ] });
  const result = await send({ type: "activate-service", serviceId: "chatgpt" });
  assert.equal(result.kind, "already-active");
  assert.equal(state.navigations.length, 0);
  assert.equal(state.created.length, 0);
  assert.equal(state.tabs.length, 1);
});

test("start button opens ChatGPT in the existing active tab", async () => {
  const { state, send } = createHarness({ tabs: [
    { id: 17, windowId: 1, url: "https://example.com/lesson", active: true }
  ] });
  const result = await send({ type: "start-workspace" });
  assert.equal(result.kind, "navigated");
  assert.equal(result.tabId, 17);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.created.length, 0);
  assert.equal(state.tabs[0].url, "https://chatgpt.com/");
});

test("service state shows current, remembered, and not-yet-visited tools", async () => {
  const { send } = createHarness({
    tabs: [{ id: 9, windowId: 1, url: "https://lovable.dev/projects/lesson", active: true }],
    storage: { serviceUrls: { github: "https://github.com/lovvv98-ui/vibe-coding-workspace" } }
  });
  const result = await send({ type: "get-state" });
  assert.equal(result.statuses.lovable.kind, "current");
  assert.equal(result.statuses.github.kind, "saved");
  assert.equal(result.statuses.codex.kind, "ready");
  assert.equal(result.selectedServiceId, "lovable");
});

test("workspace UI has no iframe and does not create a tab for service selection", async () => {
  assert.doesNotMatch(sidepanelHtml, /<iframe\b/i);
  assert.doesNotMatch(workerSource, /chrome\.tabs\.create\s*\(/);
  assert.doesNotMatch(workerSource, /chrome\.tabs\.reload\s*\(/);
  assert.doesNotMatch(workerSource, /chrome\.cookies|browser\.cookies/);
  assert.match(sidepanelSource, /current tab|현재 탭/i);
});

let failures = 0;
for (const item of cases) {
  try {
    await item.run();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error);
  }
}

console.log(`\n${cases.length - failures}/${cases.length} workspace checks passed`);
if (failures > 0) process.exitCode = 1;
