"use strict";

const SERVICES_KEY = "services";
const editor = document.getElementById("service-editor-list");
const toast = document.getElementById("toast");
let services = [];
let toastTimer = null;

async function defaults() {
  const response = await fetch(chrome.runtime.getURL("data/tools.json"));
  if (!response.ok) throw new Error("기본 설정을 읽지 못했습니다.");
  return response.json();
}

async function loadServices() {
  const stored = await chrome.storage.local.get(SERVICES_KEY);
  services = Array.isArray(stored[SERVICES_KEY]) ? stored[SERVICES_KEY] : await defaults();
  render();
}

function showToast(message, kind = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function render() {
  document.getElementById("service-summary").textContent = `${services.length}개 서비스 · 표시 순서대로 사이드 패널에 나타납니다`;
  editor.replaceChildren();
  if (services.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "등록된 서비스가 없습니다. 기본 서비스를 복원하거나 새 서비스를 추가하세요.";
    editor.append(empty);
    return;
  }

  services.forEach((service, index) => {
    const card = document.createElement("article");
    card.className = "service-card";
    card.dataset.id = service.id;
    const builtIn = service.builtIn ? "기본 서비스" : "내 서비스";
    card.innerHTML = `<div class="service-card-top"><span class="service-index">${String(index + 1).padStart(2, "0")}</span><div class="service-label"><strong>${escapeHtml(service.name)}</strong><small>${builtIn}</small></div><label class="enabled-toggle"><input class="enabled-input" type="checkbox" ${service.enabled ? "checked" : ""}> 사용</label></div><div class="service-fields"><label>서비스 이름<input class="name-input" type="text" maxlength="40" value="${escapeHtml(service.name)}" required></label><label>접속 URL<input class="url-input" type="url" value="${escapeHtml(service.url)}" required></label></div><div class="service-actions"><button class="move-up" type="button" aria-label="위로 이동" ${index === 0 ? "disabled" : ""}>위로 ↑</button><button class="move-down" type="button" aria-label="아래로 이동" ${index === services.length - 1 ? "disabled" : ""}>아래로 ↓</button><button class="save-button" type="button">변경 저장</button><button class="delete-button" type="button">삭제</button></div>`;
    card.querySelector(".move-up").addEventListener("click", () => moveService(index, -1));
    card.querySelector(".move-down").addEventListener("click", () => moveService(index, 1));
    card.querySelector(".save-button").addEventListener("click", () => saveCard(card, service));
    card.querySelector(".delete-button").addEventListener("click", () => deleteService(service));
    card.querySelector(".enabled-input").addEventListener("change", (event) => updateEnabled(service.id, event.currentTarget.checked));
    editor.append(card);
  });
}

function validateUrl(rawValue) {
  let parsed;
  try { parsed = new URL(rawValue.trim()); } catch { throw new Error("접속 주소를 확인해 주세요. 예: https://example.com/"); }
  if (!(["https:", "http:"].includes(parsed.protocol)) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("http 또는 https 웹 주소를 입력해 주세요.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("주소에 검색어, 토큰 또는 # 뒷부분은 저장할 수 없습니다. 기본 페이지 주소를 입력해 주세요.");
  }
  return parsed;
}

function hostPattern(parsed) {
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

async function ensureHostPermission(parsed) {
  const origin = hostPattern(parsed);
  // Request immediately from the Save/Add click so browsers retain the user gesture.
  return chrome.permissions.request({ origins: [origin] });
}

async function saveServices(next) {
  await chrome.storage.local.set({ [SERVICES_KEY]: next });
  services = next;
  render();
}

async function removeOldPermission(oldUrl, nextServices) {
  try {
    const parsed = validateUrl(oldUrl);
    const inUse = nextServices.some((item) => {
      try { return hostPattern(validateUrl(item.url)) === hostPattern(parsed); } catch { return false; }
    });
    if (!inUse && await chrome.permissions.contains({ origins: [hostPattern(parsed)] })) {
      await chrome.permissions.remove({ origins: [hostPattern(parsed)] });
    }
  } catch {
    // 기본 권한이나 제거할 수 없는 주소는 브라우저에 둡니다.
  }
}

async function saveCard(card, service) {
  const name = card.querySelector(".name-input").value.trim();
  if (!name) return showToast("서비스 이름을 입력해 주세요.", "error");
  let parsed;
  try { parsed = validateUrl(card.querySelector(".url-input").value); }
  catch (error) { return showToast(error.message, "error"); }
  if (!await ensureHostPermission(parsed)) return showToast("도메인 권한이 허용되지 않아 변경을 저장하지 않았습니다.", "error");

  const next = services.map((item) => item.id === service.id ? { ...item, name, url: parsed.href } : item);
  await saveServices(next);
  if (service.url !== parsed.href) await removeOldPermission(service.url, next);
  showToast(`${name} 설정을 저장했습니다.`);
}

async function updateEnabled(serviceId, enabled) {
  const next = services.map((service) => service.id === serviceId ? { ...service, enabled } : service);
  await saveServices(next);
  showToast(enabled ? "서비스를 사이드 패널에 표시합니다." : "서비스를 숨겼습니다.");
}

async function moveService(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= services.length) return;
  const next = [...services];
  [next[index], next[target]] = [next[target], next[index]];
  await saveServices(next);
}

async function deleteService(service) {
  if (!confirm(`“${service.name}” 서비스를 목록에서 삭제할까요? 저장된 마지막 방문 주소도 목록에서 지웁니다.`)) return;
  const next = services.filter((item) => item.id !== service.id);
  await saveServices(next);
  const stored = await chrome.storage.local.get("serviceUrls");
  const savedUrls = { ...(stored.serviceUrls || {}) };
  delete savedUrls[service.id];
  await chrome.storage.local.set({ serviceUrls: savedUrls });
  const selected = await chrome.storage.local.get("selectedServiceId");
  if (selected.selectedServiceId === service.id) await chrome.storage.local.set({ selectedServiceId: null });
  await removeOldPermission(service.url, next);
  showToast(`${service.name}을(를) 목록에서 삭제했습니다.`);
}

document.getElementById("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("new-name").value.trim();
  if (!name) return showToast("서비스 이름을 입력해 주세요.", "error");
  let parsed;
  try { parsed = validateUrl(document.getElementById("new-url").value); }
  catch (error) { return showToast(error.message, "error"); }
  if (!await ensureHostPermission(parsed)) return showToast("도메인 권한이 허용되지 않아 서비스를 추가하지 않았습니다.", "error");
  const id = `custom-${crypto.randomUUID()}`;
  const next = [...services, { id, name, url: parsed.href, description: "사용자 추가 서비스", icon: name.slice(0, 2).toUpperCase(), color: "#596b61", kind: "domain", enabled: true, builtIn: false }];
  await saveServices(next);
  event.currentTarget.reset();
  showToast(`${name} 서비스를 추가했습니다.`);
});

document.getElementById("restore-button").addEventListener("click", async () => {
  if (!confirm("기본 7개 서비스를 순서대로 복원할까요? 현재 이름과 URL 변경, 추가 서비스는 사라집니다.")) return;
  const builtIns = await defaults();
  await saveServices(builtIns);
  const stored = await chrome.storage.local.get("serviceUrls");
  const ids = new Set(builtIns.map((item) => item.id));
  const savedUrls = Object.fromEntries(Object.entries(stored.serviceUrls || {}).filter(([id]) => ids.has(id)));
  const selected = await chrome.storage.local.get("selectedServiceId");
  await chrome.storage.local.set({
    serviceUrls: savedUrls,
    selectedServiceId: ids.has(selected.selectedServiceId) ? selected.selectedServiceId : null
  });
  showToast("기본 서비스 7개를 복원했습니다.");
});

loadServices().catch((error) => showToast(error.message || "설정을 불러오지 못했습니다.", "error"));
