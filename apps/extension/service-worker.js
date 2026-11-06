"use strict";

const SERVICES_KEY = "services";
const TABS_KEY = "serviceTabs";
const SELECTED_KEY = "selectedServiceId";
const pendingCreations = new Map();

async function getDefaults() {
  const response = await fetch(chrome.runtime.getURL("data/tools.json"));
  if (!response.ok) throw new Error("기본 서비스 목록을 불러오지 못했습니다.");
  return response.json();
}

async function getServices() {
  const stored = await chrome.storage.local.get(SERVICES_KEY);
  if (Array.isArray(stored[SERVICES_KEY])) return stored[SERVICES_KEY];
  return getDefaults();
}

function getUrlKind(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isCodexPath(pathname) {
  return pathname === "/codex" || pathname.startsWith("/codex/");
}

function matchesService(service, tab) {
  const target = getUrlKind(service.url);
  // A newly-created tab may expose pendingUrl before url while navigation starts.
  const actual = getUrlKind(tab?.url || tab?.pendingUrl || "");
  if (!target || !actual || target.hostname.toLowerCase() !== actual.hostname.toLowerCase()) return false;

  if ((service.id === "codex" || service.kind === "codex") && target.hostname.toLowerCase() === "chatgpt.com") {
    return actual.hostname.toLowerCase() === "chatgpt.com" && isCodexPath(actual.pathname);
  }
  if ((service.id === "chatgpt" || service.kind === "chatgpt") && target.hostname.toLowerCase() === "chatgpt.com") {
    return actual.hostname.toLowerCase() === "chatgpt.com" && !isCodexPath(actual.pathname);
  }
  return true;
}

async function getTabMap() {
  const stored = await chrome.storage.local.get(TABS_KEY);
  return stored[TABS_KEY] && typeof stored[TABS_KEY] === "object" ? stored[TABS_KEY] : {};
}

async function saveTabMap(tabMap) {
  await chrome.storage.local.set({ [TABS_KEY]: tabMap });
}

async function findMatches(service) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => matchesService(service, tab));
}

function tabChoice(tab) {
  return {
    id: tab.id,
    title: (tab.title || tab.url || tab.pendingUrl || "열린 탭").slice(0, 100),
    url: tab.url || tab.pendingUrl || ""
  };
}

async function getServiceState() {
  const services = await getServices();
  const tabMap = await getTabMap();
  const availableTabs = await chrome.tabs.query({});
  const nextMap = { ...tabMap };
  const statuses = {};

  for (const service of services) {
    if (!service.enabled) {
      statuses[service.id] = { kind: "disabled", count: 0 };
      continue;
    }
    const saved = availableTabs.find((tab) => tab.id === tabMap[service.id] && matchesService(service, tab));
    const matches = saved ? [saved] : availableTabs.filter((tab) => matchesService(service, tab));
    if (saved) {
      statuses[service.id] = { kind: "open", count: matches.length };
    } else if (matches.length === 1) {
      nextMap[service.id] = matches[0].id;
      statuses[service.id] = { kind: "open", count: 1 };
    } else if (matches.length > 1) {
      delete nextMap[service.id];
      statuses[service.id] = { kind: "duplicate", count: matches.length };
    } else {
      delete nextMap[service.id];
      statuses[service.id] = { kind: "missing", count: 0 };
    }
  }

  if (JSON.stringify(nextMap) !== JSON.stringify(tabMap)) await saveTabMap(nextMap);
  const stored = await chrome.storage.local.get(SELECTED_KEY);
  return { services, statuses, selectedServiceId: stored[SELECTED_KEY] || null };
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function activateService(serviceId) {
  const services = await getServices();
  const service = services.find((item) => item.id === serviceId && item.enabled);
  if (!service) return { kind: "error", message: "사용할 수 없는 서비스입니다." };

  await chrome.storage.local.set({ [SELECTED_KEY]: service.id });
  const tabMap = await getTabMap();
  let tab = null;
  if (Number.isInteger(tabMap[service.id])) {
    try {
      const saved = await chrome.tabs.get(tabMap[service.id]);
      if (matchesService(service, saved)) tab = saved;
    } catch {
      // 닫힌 탭의 ID는 URL 검색 결과로 갱신합니다.
    }
  }

  const matches = await findMatches(service);
  if (tab) {
    await focusTab(tab);
    return { kind: "opened", tabId: tab.id };
  }
  if (matches.length === 1) {
    tabMap[service.id] = matches[0].id;
    await saveTabMap(tabMap);
    await focusTab(matches[0]);
    return { kind: "opened", tabId: matches[0].id };
  }
  if (matches.length > 1) {
    return { kind: "choose", serviceId, candidates: matches.map(tabChoice) };
  }
  return { kind: "missing", serviceId };
}

async function chooseServiceTab(serviceId, tabId, shouldFocus) {
  const services = await getServices();
  const service = services.find((item) => item.id === serviceId && item.enabled);
  if (!service) return { kind: "error", message: "서비스 설정을 찾을 수 없습니다." };
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { kind: "error", message: "선택한 탭이 이미 닫혔습니다. 다시 시도해 주세요." };
  }
  if (!matchesService(service, tab)) {
    return { kind: "error", message: "선택한 탭의 주소가 서비스와 다릅니다. 목록을 새로고침해 주세요." };
  }
  const tabMap = await getTabMap();
  tabMap[service.id] = tab.id;
  await saveTabMap(tabMap);
  await chrome.storage.local.set({ [SELECTED_KEY]: service.id });
  if (shouldFocus) await focusTab(tab);
  return { kind: "opened", tabId: tab.id };
}

async function createServiceTabOnce(serviceId, active) {
  const services = await getServices();
  const service = services.find((item) => item.id === serviceId && item.enabled);
  if (!service) return { kind: "error", message: "사용할 수 없는 서비스입니다." };

  // Recheck immediately before creating. The tab may have been opened by another
  // panel action since the user first saw the "tab missing" prompt.
  const matches = await findMatches(service);
  if (matches.length === 1) {
    const tabMap = await getTabMap();
    tabMap[service.id] = matches[0].id;
    await saveTabMap(tabMap);
    await chrome.storage.local.set({ [SELECTED_KEY]: service.id });
    await focusTab(matches[0]);
    return { kind: "opened", tabId: matches[0].id };
  }
  if (matches.length > 1) {
    return { kind: "choose", serviceId, candidates: matches.map(tabChoice) };
  }

  const tab = await chrome.tabs.create({ url: service.url, active });
  const tabMap = await getTabMap();
  tabMap[service.id] = tab.id;
  await saveTabMap(tabMap);
  await chrome.storage.local.set({ [SELECTED_KEY]: service.id });
  return { kind: "opened", tabId: tab.id };
}

async function createServiceTab(serviceId, active) {
  // Prevent rapid repeated clicks from creating multiple tabs for one service.
  if (pendingCreations.has(serviceId)) return pendingCreations.get(serviceId);
  const creation = createServiceTabOnce(serviceId, active);
  pendingCreations.set(serviceId, creation);
  try {
    return await creation;
  } finally {
    if (pendingCreations.get(serviceId) === creation) pendingCreations.delete(serviceId);
  }
}

async function prepareAllTabs() {
  const services = (await getServices()).filter((service) => service.enabled);
  const tabMap = await getTabMap();
  const allTabs = await chrome.tabs.query({});
  const results = [];

  for (const service of services) {
    const saved = allTabs.find((tab) => tab.id === tabMap[service.id] && matchesService(service, tab));
    if (saved) {
      results.push({ serviceId: service.id, kind: "reused" });
      continue;
    }
    const matches = allTabs.filter((tab) => matchesService(service, tab));
    if (matches.length === 1) {
      tabMap[service.id] = matches[0].id;
      results.push({ serviceId: service.id, kind: "reused" });
      continue;
    }
    if (matches.length > 1) {
      delete tabMap[service.id];
      results.push({ serviceId: service.id, kind: "duplicate", candidates: matches.map(tabChoice) });
      continue;
    }
    try {
      const tab = await chrome.tabs.create({ url: service.url, active: false });
      tabMap[service.id] = tab.id;
      allTabs.push(tab);
      results.push({ serviceId: service.id, kind: "created" });
    } catch {
      results.push({ serviceId: service.id, kind: "error" });
    }
  }
  await saveTabMap(tabMap);
  return { kind: "prepared", results };
}

async function reconcileTabs() {
  try {
    await getServiceState();
  } catch {
    // Startup may race with extension storage initialization; the panel retries on open.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.sidePanel) return;
  chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(reconcileTabs);

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
  const tabMap = await getTabMap();
  let changed = false;
  for (const [serviceId, tabId] of Object.entries(tabMap)) {
    if (tabId === removedTabId) {
      delete tabMap[serviceId];
      changed = true;
    }
  }
  if (changed) await saveTabMap(tabMap);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "get-state": return getServiceState();
      case "activate-service": return activateService(message.serviceId);
      case "choose-tab": return chooseServiceTab(message.serviceId, message.tabId, true);
      case "bind-tab": return chooseServiceTab(message.serviceId, message.tabId, false);
      case "create-service-tab": return createServiceTab(message.serviceId, true);
      case "prepare-all": return prepareAllTabs();
      default: return { kind: "error", message: "지원하지 않는 요청입니다." };
    }
  };
  run().then(sendResponse).catch((error) => sendResponse({ kind: "error", message: error?.message || "작업을 완료하지 못했습니다." }));
  return true;
});
