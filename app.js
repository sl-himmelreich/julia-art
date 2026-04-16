// PDF.js ESM
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

// Renders higher resolution for crisp display & zoom
const RENDER_SCALE = 1.6;      // on-screen
const LIGHTBOX_SCALE = 3.0;    // zoomed-in high-res

const viewers = {
  reestr: { el: null, pdf: null, pages: [], rendered: false, path: "pdfs/reestr.pdf", title: "Реестр полный 08.04.2026" },
  kuznetsov: { el: null, pdf: null, pages: [], rendered: false, path: "pdfs/kuznetsov.pdf", title: "Кузнецов. История создания коллекции" }
};

// Currently opened lightbox state
let lightboxCtx = { viewer: null, pageIndex: 0 };

// ===== Tabs =====
const tabs = document.querySelectorAll(".tab");
tabs.forEach(tab => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  tab.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const arr = Array.from(tabs);
      const i = arr.indexOf(tab);
      const next = e.key === "ArrowRight" ? arr[(i+1) % arr.length] : arr[(i-1+arr.length) % arr.length];
      activateTab(next.dataset.tab);
      next.focus();
    }
  });
});

function activateTab(name) {
  tabs.forEach(t => {
    const active = t.dataset.tab === name;
    t.setAttribute("aria-selected", active);
    t.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".panel").forEach(p => {
    p.hidden = p.id !== `panel-${name}`;
  });
  // Lazy render on first activation
  const v = viewers[name];
  if (v && !v.rendered) renderPdf(name);
  // scroll up for a clean transition
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== Render a PDF into its viewer container =====
async function renderPdf(name) {
  const v = viewers[name];
  v.el = document.getElementById(`viewer-${name}`);
  v.el.innerHTML = `<div class="pdf-loading"><div class="spinner"></div><div>Загружаем документ…</div></div>`;

  try {
    const loadingTask = pdfjsLib.getDocument({ url: v.path });
    const pdf = await loadingTask.promise;
    v.pdf = pdf;
    v.el.innerHTML = "";
    v.pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const pageEl = document.createElement("div");
      pageEl.className = "pdf-page";
      pageEl.dataset.page = i;
      const num = document.createElement("div");
      num.className = "pdf-page-number";
      num.textContent = `${i} / ${pdf.numPages}`;
      const canvas = document.createElement("canvas");
      pageEl.appendChild(canvas);
      pageEl.appendChild(num);
      v.el.appendChild(pageEl);
      v.pages.push({ pageEl, canvas, pageNum: i });

      pageEl.addEventListener("click", () => openLightbox(name, i - 1));
    }

    // render all pages sequentially (avoids huge memory spikes on big PDFs)
    for (const p of v.pages) {
      await renderPageOnCanvas(pdf, p.pageNum, p.canvas, RENDER_SCALE);
    }

    v.rendered = true;
  } catch (err) {
    console.error(err);
    v.el.innerHTML = `<div class="pdf-error">Не удалось загрузить документ.<br/>${err?.message || ""}</div>`;
  }
}

async function renderPageOnCanvas(pdf, pageNum, canvas, scale) {
  const page = await pdf.getPage(pageNum);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr });
  const ctx = canvas.getContext("2d", { alpha: false });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = (viewport.width / dpr) + "px";
  canvas.style.height = (viewport.height / dpr) + "px";
  await page.render({ canvasContext: ctx, viewport }).promise;
}

// ===== Save / Print =====
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const target = btn.dataset.target;
  if (action === "save") savePdf(target);
  if (action === "print") printPdf(target);
});

function savePdf(name) {
  const v = viewers[name];
  const a = document.createElement("a");
  a.href = v.path;
  // browser "save as" dialog via download attribute
  const filename = name === "reestr"
    ? "Реестр полный 08.04.2026.pdf"
    : "Кузнецов. История создания коллекции.pdf";
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function printPdf(name) {
  const v = viewers[name];
  const frame = document.getElementById("print-frame");
  // load PDF in hidden iframe, then trigger native print dialog
  frame.src = v.path;
  const tryPrint = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (err) {
      // Fallback: open PDF in new tab so user can print from browser viewer
      window.open(v.path, "_blank");
    }
  };
  // Some browsers need the PDF to be fully loaded before print
  frame.onload = () => setTimeout(tryPrint, 200);
  // Safari / iOS fallback: open in new tab after short delay if onload didn't fire
  setTimeout(() => {
    if (!frame.contentDocument) window.open(v.path, "_blank");
  }, 3000);
}

// ===== Lightbox =====
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");

async function openLightbox(viewerName, pageIdx) {
  const v = viewers[viewerName];
  if (!v || !v.pdf) return;
  lightboxCtx = { viewer: viewerName, pageIndex: pageIdx };
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  await renderLightboxPage();
}

async function renderLightboxPage() {
  const { viewer: viewerName, pageIndex } = lightboxCtx;
  const v = viewers[viewerName];
  const pageNum = pageIndex + 1;

  // loading state
  lightboxImg.removeAttribute("src");
  lightboxCaption.textContent = `Загружаем страницу ${pageNum} из ${v.pdf.numPages}…`;

  // render high-res to offscreen canvas
  const canvas = document.createElement("canvas");
  await renderPageOnCanvas(v.pdf, pageNum, canvas, LIGHTBOX_SCALE);
  lightboxImg.src = canvas.toDataURL("image/jpeg", 0.92);
  lightboxImg.alt = `${v.title} — страница ${pageNum}`;
  lightboxCaption.textContent = `${v.title} — страница ${pageNum} из ${v.pdf.numPages}`;

  lightboxPrev.disabled = pageIndex === 0;
  lightboxNext.disabled = pageIndex === v.pdf.numPages - 1;
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = "";
  lightboxImg.removeAttribute("src");
}

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox || e.target.id === "lightbox-stage") closeLightbox();
});
lightboxPrev.addEventListener("click", () => {
  if (lightboxCtx.pageIndex > 0) {
    lightboxCtx.pageIndex--;
    renderLightboxPage();
  }
});
lightboxNext.addEventListener("click", () => {
  const v = viewers[lightboxCtx.viewer];
  if (lightboxCtx.pageIndex < v.pdf.numPages - 1) {
    lightboxCtx.pageIndex++;
    renderLightboxPage();
  }
});

document.addEventListener("keydown", (e) => {
  if (lightbox.hidden) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") lightboxPrev.click();
  else if (e.key === "ArrowRight") lightboxNext.click();
});

// ===== Init =====
activateTab("reestr");
