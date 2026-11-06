"use strict";

const listElement = document.getElementById("service-list");
const noticeElement = document.getElementById("notice");
const tabDialog = document.getElementById("tab-dialog");
const missingDialog = document.getElementById("missing-dialog");
let currentState = null;
let pendingMissingService = null;
let noticeTimer = null;

const browserName = /Edg\//.test(navigator.userAgent) ? "Microsoft Edge" : /Chrome\//.test(navigator.userAgent) ? "Google Chrome" : "브라우저";
document.getElementById("browser-label").textContent = browserName;

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
    case "open": return { label: "탭 열림", detail: "로그인 확인 필요 · 로그인 여부 확인 불가", state: "open" };
    case "duplicate": return { label: "중복 탭", detail: `${status.count}개 중 사용할 탭 선택`, state: "duplicate" };
    case "disabled": return { label: "사용 중지", detail: "설정에서 다시 켤 수 있어요", state: "disabled" };
    default: return { label: "탭 없음", detail: "선택하면 새 탭 열기를 안내해요", state: "missing" };
  }
}

function render() {
  if (!currentState) return;
  const services = currentState.services.filter((service) => service.enabled);
  const selectedService = currentState.services.find((service) => service.id === currentState.selectedServiceId);
  document.getElementById("browser-label").textContent = selectedService ? `${browserName} · ${selectedService.name} 선택됨` : `${browserName} · 작업공간`;
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
    button.innerHTML = `<span class="service-icon icon-${safeId(service.id)}">${escapeHtml(service.icon || service.name.slice(0, 2))}</span><span class="service-copy"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || "웹 서비스")}</small></span><span class="service-status ${presentation.state}"><span class="status-dot"></span>${presentation.label}</span><span class="service-chevron" aria-hidden="true">›</span>`;
    button.addEventListener("click", () => openService(service));
    listElement.append(button);
  }
}

function safeId(value) {
  return /^[a-z0-9-]+$/.test(value || "") ? value : "custom";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function refresh() {
  try {
    currentState = await request("get-state");
    render();
  } catch {
    showNotice("서비스 상태를 불러오지 못했어요. 확장 프로그램을 새로고침해 주세요.", "error");
  }
}

function chooseCandidate(service, candidates, description, bindOnly = false) {
  document.getElementById("dialog-description").textContent = description;
  const candidateList = document.getElementById("candidate-list");
  candidateList.replaceChildren();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      tabDialog.removeEventListener("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(null);

    for (const candidate of candidates) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "candidate-item";
      const title = document.createElement("strong");
      title.textContent = candidate.title || "열린 탭";
      const address = document.createElement("small");
      try { address.textContent = new URL(candidate.url).hostname; } catch { address.textContent = "브라우저 탭"; }
      choice.append(title, address);
      choice.addEventListener("click", async () => {
        choice.disabled = true;
        const result = await request(bindOnly ? "bind-tab" : "choose-tab", { serviceId: service.id, tabId: candidate.id });
        tabDialog.close("selected");
        finish(result?.kind === "opened");
      });
      candidateList.append(choice);
    }
    tabDialog.addEventListener("close", onClose, { once: true });
    tabDialog.showModal();
  });
}

function confirmMissing(service) {
  pendingMissingService = service;
  document.getElementById("missing-title").textContent = `${service.name} 탭을 열까요?`;
  document.getElementById("missing-description").textContent = "새 탭을 열면 서비스 화면에서 직접 로그인할 수 있습니다.";
  missingDialog.showModal();
}

async function openService(service) {
  const result = await request("activate-service", { serviceId: service.id });
  if (result.kind === "opened") {
    currentState.selectedServiceId = service.id;
    render();
    await refresh();
  } else if (result.kind === "choose") {
    const chosen = await chooseCandidate(service, result.candidates, `${service.name}에 해당하는 탭이 여러 개 열려 있습니다. 사용할 작업 화면을 선택하세요.`);
    if (chosen) await refresh();
  } else if (result.kind === "missing") {
    confirmMissing(service);
  } else {
    showNotice(result.message || "탭을 전환하지 못했어요.", "error");
  }
}

document.getElementById("open-missing-button").addEventListener("click", async () => {
  if (!pendingMissingService) return;
  const result = await request("create-service-tab", { serviceId: pendingMissingService.id });
  missingDialog.close("open");
  if (result.kind === "opened") {
    currentState.selectedServiceId = pendingMissingService.id;
    showNotice(`${pendingMissingService.name} 탭을 열었습니다. 사이트에서 직접 로그인해 주세요.`, "success");
    pendingMissingService = null;
    await refresh();
  } else {
    showNotice(result.message || "새 탭을 열지 못했어요.", "error");
  }
});

document.getElementById("prepare-button").addEventListener("click", async (event) => {
  if (!currentState) {
    showNotice("서비스 정보를 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요.");
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  button.classList.add("busy");
  button.setAttribute("aria-busy", "true");
  try {
    const response = await request("prepare-all");
    if (response.kind !== "prepared") throw new Error(response.message || "탭을 준비하지 못했습니다.");
    let reused = 0;
    let created = 0;
    let unresolved = 0;
    for (const result of response.results) {
      if (result.kind === "reused") reused += 1;
      else if (result.kind === "created") created += 1;
      else if (result.kind === "duplicate") {
        const service = currentState.services.find((item) => item.id === result.serviceId);
        const selected = await chooseCandidate(service, result.candidates, `${service.name} 탭이 여러 개 있어요. 수업에서 사용할 탭을 선택해 연결해 주세요.`, true);
        if (selected) reused += 1;
        else unresolved += 1;
      } else unresolved += 1;
    }
    await refresh();
    let message = `탭 준비 완료 · 기존 ${reused}개 재사용 · 새 탭 ${created}개`;
    if (unresolved) message += ` · 선택하지 않은 탭 ${unresolved}개`;
    message += " · 로그인은 각 사이트에서 확인해 주세요.";
    showNotice(message, unresolved ? "info" : "success");
  } catch (error) {
    showNotice(error.message || "탭 준비를 완료하지 못했어요.", "error");
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
    button.removeAttribute("aria-busy");
  }
});

document.getElementById("settings-button").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("help-button").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("help.html") }));
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onRemoved.addListener(() => refresh());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.services || changes.serviceTabs || changes.selectedServiceId)) refresh();
});

refresh();
