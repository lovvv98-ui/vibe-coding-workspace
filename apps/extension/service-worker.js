"use strict";

const SERVICES_KEY = "services";
const SERVICE_URLS_KEY = "serviceUrls";
const SELECTED_KEY = "selectedServiceId";

async function getDefaults() {
  const response = await fetch(chrome.runtime.getURL("data/tools.json"));
  if (!response.ok) throw new Error("기본 서비스 목록을 불러오지 못했습니다.");
  return response.json();
}

async function getServices() {
  const stored = await chrome.storage.local.get([SERVICES_KEY, SERVICE_URLS_KEY, SELECTED_KEY]);
  const services = Array.isArray(stored[SERVICES_KEY]) ? stored[SERVICES_KEY] : await getDefaults();
  const currentServices = services.filter((service) => service?.id !== "codex" && service?.kind !== "codex");
  const updates = {};

  if (Array.isArray(stored[SERVICES_KEY]) && currentServices.length !== services.length) {
    updates[SERVICES_KEY] = currentServices;
  }

  const savedUrls = stored[SERVICE_URLS_KEY];
  if (savedUrls && typeof savedUrls === "object" && !Array.isArray(savedUrls) && "codex" in savedUrls) {
    const currentUrls = { ...savedUrls };
    delete currentUrls.codex;
    updates[SERVICE_URLS_KEY] = currentUrls;
  }

  if (stored[SELECTED_KEY] === "codex") updates[SELECTED_KEY] = null;
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  return currentServices;
}

function parseWebUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function matchesService(service, rawUrl) {
  const target = parseWebUrl(service.url);
  const actual = parseWebUrl(typeof rawUrl === "string" ? rawUrl : rawUrl?.url || rawUrl?.pendingUrl || "");
  if (!target || !actual || target.hostname.toLowerCase() !== actual.hostname.toLowerCase()) return false;

  if (service.id === "chatgpt" && target.hostname.toLowerCase() === "chatgpt.com" &&
      (actual.pathname === "/codex" || actual.pathname.startsWith("/codex/"))) return false;

  return true;
}

function safeServiceUrl(service, rawUrl) {
  const parsed = parseWebUrl(rawUrl);
  if (!parsed || !matchesService(service, parsed.href)) return null;
  // Keep the page path so the user's project or conversation can be revisited.
  // Do not persist query strings or fragments, which can contain temporary tokens.
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function getSavedUrls() {
  const stored = await chrome.storage.local.get(SERVICE_URLS_KEY);
  return isObject(stored[SERVICE_URLS_KEY]) ? stored[SERVICE_URLS_KEY] : {};
}

async function saveCurrentLocation(service, rawUrl, savedUrls = null) {
  const url = safeServiceUrl(service, rawUrl);
  if (!url) return savedUrls || await getSavedUrls();
  const urls = savedUrls || await getSavedUrls();
  if (urls[service.id] !== url) {
    urls[service.id] = url;
    await chrome.storage.local.set({ [SERVICE_URLS_KEY]: urls });
  }
  return urls;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function getServiceState() {
  const services = await getServices();
  const activeTab = await getActiveTab();
  let savedUrls = await getSavedUrls();
  const currentService = services.find((service) => service.enabled && activeTab && matchesService(service, activeTab)) || null;

  if (currentService && activeTab) {
    savedUrls = await saveCurrentLocation(currentService, activeTab.url || activeTab.pendingUrl, savedUrls);
    await chrome.storage.local.set({ [SELECTED_KEY]: currentService.id });
  }

  const statuses = {};
  for (const service of services) {
    if (!service.enabled) {
      statuses[service.id] = { kind: "disabled" };
      continue;
    }
    if (currentService?.id === service.id) {
      statuses[service.id] = { kind: "current" };
      continue;
    }
    const remembered = safeServiceUrl(service, savedUrls[service.id]);
    statuses[service.id] = remembered ? { kind: "saved" } : { kind: "ready" };
  }

  return {
    services,
    statuses,
    selectedServiceId: currentService?.id || null,
    currentTabId: activeTab?.id ?? null
  };
}

async function activateService(serviceId) {
  const services = await getServices();
  const service = services.find((item) => item.id === serviceId && item.enabled);
  if (!service) return { kind: "error", message: "사용할 수 없는 서비스입니다." };

  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    return { kind: "error", message: "Edge에서 웹페이지 탭을 하나 연 뒤 다시 선택해 주세요." };
  }

  let savedUrls = await getSavedUrls();
  const currentService = services.find((item) => item.enabled && matchesService(item, activeTab));
  if (currentService) {
    savedUrls = await saveCurrentLocation(currentService, activeTab.url || activeTab.pendingUrl, savedUrls);
  }

  if (currentService?.id === service.id) {
    await chrome.storage.local.set({ [SELECTED_KEY]: service.id });
    return { kind: "already-active", tabId: activeTab.id };
  }

  const targetUrl = safeServiceUrl(service, savedUrls[service.id]) || service.url;
  await chrome.storage.local.set({ [SERVICE_URLS_KEY]: savedUrls, [SELECTED_KEY]: service.id });
  const navigated = await chrome.tabs.update(activeTab.id, { url: targetUrl });
  return { kind: "navigated", tabId: navigated.id, serviceId: service.id };
}

async function rememberActiveNavigation(tabId, changeInfo, tab) {
  if (!tab?.active || (!changeInfo.url && changeInfo.status !== "complete")) return;
  try {
    const services = await getServices();
    const service = services.find((item) => item.enabled && matchesService(item, tab));
    if (!service) return;
    await saveCurrentLocation(service, tab.url || tab.pendingUrl);
    await chrome.storage.local.set({ [SELECTED_KEY]: service.id });
  } catch {
    // The panel requests state again when the navigation completes.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  getServices().catch(() => {});
  if (!chrome.sidePanel) return;
  chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onUpdated.addListener(rememberActiveNavigation);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "get-state": return getServiceState();
      case "activate-service": return activateService(message.serviceId);
      default: return { kind: "error", message: "지원하지 않는 요청입니다." };
    }
  };
  run().then(sendResponse).catch((error) => sendResponse({ kind: "error", message: error?.message || "작업을 완료하지 못했습니다." }));
  return true;
});

