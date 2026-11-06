"use strict";

const grid = document.getElementById("tool-grid");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function iconClass(id) {
  return /^[a-z0-9-]+$/.test(id) ? `icon-${id}` : "icon-custom";
}

async function renderTools() {
  try {
    const response = await fetch("tools.json", { cache: "no-store" });
    if (!response.ok) throw new Error("서비스 정보를 불러오지 못했습니다.");
    const tools = await response.json();
    grid.replaceChildren();
    tools.forEach((tool, index) => {
      const article = document.createElement("article");
      article.className = "tool-card";
      article.innerHTML = `<div class="tool-card-top"><span class="tool-number">0${index + 1}</span><span class="tool-logo ${iconClass(tool.id)}">${escapeHtml(tool.icon)}</span><a class="external-arrow" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(tool.name)} 새 탭에서 열기">↗</a></div><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.description)}</p><span class="tool-url">${escapeHtml(new URL(tool.url).hostname)}</span></article>`;
      grid.append(article);
    });
  } catch {
    grid.innerHTML = '<p class="tool-error">서비스 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>';
  }
}

renderTools();
