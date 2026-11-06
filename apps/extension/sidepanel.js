"use strict";

const listElement = document.getElementById("service-list");
const noticeElement = document.getElementById("notice");
const helpDialog = document.getElementById("help-dialog");
let currentState = null;
let noticeTimer = null;

const browserName = /Edg\//.test(navigator.userAgent) ? "Microsoft Edge" : /Chrome\//.test(navigator.userAgent) ? "Google Chrome" : "브라우저";

async function request(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

function showNotice(message, kind = "info") {
  clearTimeout(noticeTimer);
  noticeElement.textContent = message;
  noticeElement.className = `notice ${kind}`;
  noticeElement.hidden = false;
  noticeTimer = setTimeout(() => { noticeElement.hidden = true; }, 5000);
}

function statusPresentation(status) {
  switch (status?.kind) {
    case "current": return { label: "현재 화면", detail: "이 서비스가 현재 작업 탭에 열려 있어요", state: "open" };
    case "saved": return { label: "이어서 열기", detail: "마지막 작업 주소를 이 기기에 저장했어요", state: "saved" };
    case "disabled": return { label: "사용 중지", detail: "설정에서 다시 켤 수 있어요", state: "disabled" };
    default: return { label: "시작 전", detail: "선택하면 현재 탭에서 열려요", state: "ready" };
  }
}

function safeId(value) {
  return /^[a-z0-9-]+$/.test(value || "") ? value : "custom";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function render() {
  if (!currentState) return;
  const services = currentState.services.filter((service) => service.enabled);
  const selectedService = currentState.services.find((service) => service.id === currentState.selectedServiceId);
  document.getElementById("browser-label").textContent = selectedService
    ? `${browserName} · ${selectedService.name} 화면`
    : `${browserName} · 작업 화면`;
  document.getElementById("tool-count").textContent = String(services.length).padStart(2, "0");
  listElement.replaceChildren();

  if (services.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "사용 중인 서비스가 없습니다. 설정에서 서비스를 추가하거나 켜 주세요.";
    listElement.append(empty);
    return;
  }

  for (const service of services) {
    const presentation = statusPresentation(currentState.statuses[service.id]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `service-item${currentState.selectedServiceId === service.id ? " selected" : ""}`;
    button.dataset.serviceId = service.id;
    button.setAttribute("aria-current", currentState.selectedServiceId === service.id ? "true" : "false");
    button.setAttribute("aria-label", `${service.name}. ${presentation.label}. ${presentation.detail}`);
    button.title = `${presentation.label} · ${presentation.detail}`;
    button.innerHTML = `<span class="service-icon icon-${safeId(service.id)}">${escapeHtml(service.icon || service.name.slice(0, 2))}</span><span class="service-copy"><strong>${escapeHtml(service.name)}</strong></span><span class="service-status ${presentation.state}"><span class="status-dot"></span>${presentation.label}</span><span class="service-chevron" aria-hidden="true">›</span>`;
    button.addEventListener("click", () => openService(service));
    listElement.append(button);
  }
}

async function refresh() {
  try {
    currentState = await request("get-state");
    render();
  } catch {
    showNotice("작업공간 정보를 불러오지 못했어요. 확장 프로그램을 새로고침해 주세요.", "error");
  }
}

async function openService(service) {
  const result = await request("activate-service", { serviceId: service.id });
  if (result.kind === "navigated") {
    if (currentState) currentState.selectedServiceId = service.id;
    render();
    showNotice(`${service.name} 화면으로 전환했습니다. 현재 탭 하나를 계속 사용합니다.`, "success");
  } else if (result.kind === "already-active") {
    showNotice(`${service.name}이(가) 이미 현재 화면입니다.`);
  } else {
    showNotice(result.message || "서비스 화면을 전환하지 못했어요.", "error");
  }
}

document.getElementById("settings-button").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
document.getElementById("help-close-button").addEventListener("click", () => helpDialog.close());
document.getElementById("help-close-action").addEventListener("click", () => helpDialog.close());

chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.services || changes.serviceUrls)) refresh();
});

refresh();
