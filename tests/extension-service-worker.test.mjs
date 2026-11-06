import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = await readFile(resolve(root, "apps/extension/service-worker.js"), "utf8");
const defaultServices = JSON.parse(await readFile(resolve(root, "apps/extension/data/tools.json"), "utf8"));
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
    nextTabId: Math.max(0, ...tabs.map((tab) => tab.id)) + 1,
    created: [],
    focusedWindows: [],
    panelOptions: [],
    panelBehaviors: []
  };
  const events = {
    installed: makeEvent(),
    startup: makeEvent(),
    removed: makeEvent(),
    message: makeEvent()
  };

  const chrome = {
    runtime: {
      getURL: (path) => `extension://test/${path}`,
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.message
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: state.storage[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, state.storage[key]]));
          if (keys && typeof keys === "object") {
            return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, state.storage[key] ?? fallback]));
          }
          return structuredClone(state.storage);
        },
        async set(values) { Object.assign(state.storage, structuredClone(values)); }
      }
    },
    tabs: {
      onRemoved: events.removed,
      async query() { return structuredClone(state.tabs); },
      async get(id) {
        const found = state.tabs.find((tab) => tab.id === id);
        if (!found) throw new Error("No tab with id");
        return structuredClone(found);
      },
      async update(id, changes) {
        const found = state.tabs.find((tab) => tab.id === id);
        if (!found) throw new Error("No tab with id");
        if (changes.active) {
          for (const tab of state.tabs) if (tab.windowId === found.windowId) tab.active = false;
        }
        Object.assign(found, changes);
        return structuredClone(found);
      },
      async create({ url, active }) {
        const tab = {
          id: state.nextTabId++,
          windowId: 1,
          pendingUrl: url,
          title: "",
          active
        };
        state.tabs.push(tab);
        state.created.push(structuredClone(tab));
        return structuredClone(tab);
      }
    },
    windows: {
      async update(id, changes) {
        if (changes.focused) state.focusedWindows.push(id);
      }
    },
    sidePanel: {
      async setOptions(options) { state.panelOptions.push(options); },
      async setPanelBehavior(behavior) { state.panelBehaviors.push(behavior); }
    }
  };

  const context = {
    chrome,
    URL,
    Promise,
    Map,
    Array,
    Number,
    Object,
    JSON,
    Error,
    fetch: async () => ({ ok: true, json: async () => structuredClone(defaultServices) })
  };
  vm.runInNewContext(workerSource, context, { filename: "service-worker.js" });

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

  return { state, events, send };
}

test("default service menu contains the seven tools in teaching order", async () => {
  assert.deepEqual(defaultServices.map((service) => service.id), [
    "chatgpt", "codex", "lovable", "github", "cursor", "vercel", "infinityfree"
  ]);
  const manifest = JSON.parse(await readFile(resolve(root, "apps/extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("storage"));
});

test("extension never embeds third-party pages or reads cookies", async () => {
  const sidepanel = await readFile(resolve(root, "apps/extension/sidepanel.html"), "utf8");
  const extensionFiles = await Promise.all([
    "apps/extension/service-worker.js",
    "apps/extension/sidepanel.js",
    "apps/extension/options.js"
  ].map((path) => readFile(resolve(root, path), "utf8")));
  assert.doesNotMatch(sidepanel, /<iframe\b/i);
  assert.ok(extensionFiles.every((source) => !/chrome\.cookies|browser\.cookies|tabs\.reload\s*\(/.test(source)));
});

test("ChatGPT and Codex switch to their separate existing tabs without creating tabs", async () => {
  const { state, send } = createHarness({ tabs: [
    { id: 10, windowId: 1, url: "https://chatgpt.com/c/lesson-chat", title: "ChatGPT lesson", active: true },
    { id: 11, windowId: 1, url: "https://chatgpt.com/codex", title: "Codex workspace", active: false }
  ] });

  const chatgpt = await send({ type: "activate-service", serviceId: "chatgpt" });
  assert.deepEqual(JSON.parse(JSON.stringify(chatgpt)), { kind: "opened", tabId: 10 });
  assert.equal(state.tabs.find((tab) => tab.id === 10).active, true);

  const codex = await send({ type: "activate-service", serviceId: "codex" });
  assert.deepEqual(JSON.parse(JSON.stringify(codex)), { kind: "opened", tabId: 11 });
  assert.equal(state.tabs.find((tab) => tab.id === 11).active, true);
  assert.equal(state.created.length, 0);
  assert.deepEqual(state.storage.serviceTabs, { chatgpt: 10, codex: 11 });
});

test("tab preparation reuses existing service tabs and creates only missing ones in the background", async () => {
  const { state, send } = createHarness({ tabs: [
    { id: 20, windowId: 1, url: "https://chatgpt.com/c/existing", active: true },
    { id: 21, windowId: 1, url: "https://lovable.dev/projects/lesson", active: false }
  ] });

  const result = await send({ type: "prepare-all" });
  const prepared = JSON.parse(JSON.stringify(result));
  assert.equal(prepared.kind, "prepared");
  assert.equal(prepared.results.find((item) => item.serviceId === "chatgpt").kind, "reused");
  assert.equal(prepared.results.find((item) => item.serviceId === "lovable").kind, "reused");
  assert.equal(state.created.length, 5);
  assert.ok(state.created.every((tab) => tab.active === false));
  assert.equal(state.storage.serviceTabs.chatgpt, 20);
  assert.equal(state.storage.serviceTabs.lovable, 21);
  assert.equal(new Set(state.created.map((tab) => new URL(tab.pendingUrl).hostname)).size, 5);
});

test("duplicate service tabs require a user choice and do not trigger another tab", async () => {
  const { state, send } = createHarness({ tabs: [
    { id: 30, windowId: 1, url: "https://github.com/", title: "GitHub home", active: true },
    { id: 31, windowId: 1, url: "https://github.com/lovvv98-ui/vibe-coding-workspace", title: "Project", active: false }
  ] });

  const result = await send({ type: "activate-service", serviceId: "github" });
  assert.equal(result.kind, "choose");
  assert.equal(result.candidates.length, 2);
  assert.equal(state.created.length, 0);

  const chosen = await send({ type: "choose-tab", serviceId: "github", tabId: 31 });
  assert.deepEqual(JSON.parse(JSON.stringify(chosen)), { kind: "opened", tabId: 31 });
  assert.equal(state.storage.serviceTabs.github, 31);
});

test("repeated create requests for one missing service share a single tab", async () => {
  const { state, send } = createHarness();
  const [first, second] = await Promise.all([
    send({ type: "create-service-tab", serviceId: "vercel" }),
    send({ type: "create-service-tab", serviceId: "vercel" })
  ]);

  assert.equal(first.kind, "opened");
  assert.equal(second.kind, "opened");
  assert.equal(first.tabId, second.tabId);
  assert.equal(state.created.length, 1);
  assert.equal(state.storage.serviceTabs.vercel, first.tabId);
});

test("new tabs are recognized through pendingUrl before navigation finishes", async () => {
  const { state, send } = createHarness();
  const created = await send({ type: "create-service-tab", serviceId: "cursor" });
  const repeated = await send({ type: "create-service-tab", serviceId: "cursor" });

  assert.equal(repeated.tabId, created.tabId);
  assert.equal(state.created.length, 1);
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

console.log(`\n${cases.length - failures}/${cases.length} extension checks passed`);
if (failures > 0) process.exitCode = 1;
