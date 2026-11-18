"use strict";

const nav = document.getElementById("tool-nav");
const grid = document.getElementById("tool-grid");
const focus = document.getElementById("focus-card");
const search = document.getElementById("tool-search");
let tools = [];
let selectedId = null;

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function logo(tool, extra = "") {
  return `<span class="${extra}" style="background:${safeText(tool.color || "#7161dc")}">${safeText(tool.icon || tool.name.slice(0,1))}</span>`;
}
function chooseTool(id) {
  const tool = tools.find((item) => item.id === id);
  if (!tool) return;
  selectedId = id;
  nav.querySelectorAll(".tool-nav-item").forEach((item) => item.classList.toggle("selected", item.dataset.id === id));
  focus.innerHTML = `
    <div class="focus-detail">
      ${logo(tool, "focus-logo")}
      <div class="focus-text"><span class="focus-overline">SELECTED TOOL · ${safeText(host(tool.url).toUpperCase())}</span><h3>${safeText(tool.name)}</h3><p>${safeText(tool.description)}</p></div>
    </div>
    <div class="focus-actions"><button class="focus-secondary" type="button" id="copy-tool-url">주소 복사</button><a class="focus-launch" href="${safeText(tool.url)}" target="_blank" rel="noopener noreferrer"> ${safeText(tool.name)} 열기 <span>↗</span></a></div>`;
  const copy = document.getElementById("copy-tool-url");
  copy?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(tool.url); copy.textContent = "복사 완료"; }
    catch { copy.textContent = "복사할 수 없음"; }
  });
}
function renderNav() {
  nav.innerHTML = tools.map((tool) => `<button class="tool-nav-item ${tool.id === selectedId ? "selected" : ""}" type="button" data-id="${safeText(tool.id)}">${logo(tool, "tiny-tool-icon")}<span>${safeText(tool.name)}</span></button>`).join("");
  nav.querySelectorAll(".tool-nav-item").forEach((item) => item.addEventListener("click", () => chooseTool(item.dataset.id)));
}
function renderGrid(query = "") {
  const filtered = tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()));
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-card">검색 결과가 없어요. 다른 이름으로 찾아보세요.</div>';
    return;
  }
  grid.innerHTML = filtered.map((tool) => `
    <article class="tool-card">
      <div class="tool-card-top">${logo(tool, "tool-card-logo")}<span class="tool-card-arrow">↗</span></div>
      <h3>${safeText(tool.name)}</h3><p>${safeText(tool.description)}</p>
      <div class="tool-card-bottom"><span>${safeText(host(tool.url))}</span><button class="tool-open" type="button" data-id="${safeText(tool.id)}">선택하기 →</button></div>
    </article>`).join("");
  grid.querySelectorAll(".tool-open").forEach((button) => button.addEventListener("click", () => {
    chooseTool(button.dataset.id);
    document.getElementById("focus-title").scrollIntoView({behavior:"smooth",block:"center"});
  }));
}
async function init() {
  try {
    const response = await fetch("tools.json", {cache:"no-store"});
    if (!response.ok) throw new Error("도구 목록을 불러오지 못했습니다.");
    tools = (await response.json()).filter((tool) => tool.enabled !== false);
    if (!tools.length) throw new Error("등록된 도구가 없습니다.");
    selectedId = tools[0].id;
    renderNav();
    renderGrid();
    chooseTool(selectedId);
  } catch (error) {
    nav.innerHTML = '<p class="nav-loading">도구 목록을 불러오지 못했어요.</p>';
    grid.innerHTML = '<div class="empty-card">페이지를 새로고침해 주세요.</div>';
    focus.innerHTML = '<div class="focus-empty"><span class="focus-icon">!</span><div><strong>도구 목록을 불러오지 못했어요</strong><p>잠시 후 페이지를 새로고침해 주세요.</p></div></div>';
  }
}
search?.addEventListener("input", (event) => renderGrid(event.target.value.trim()));
init();
