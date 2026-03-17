const imagePreviewer = (() => {
  const STATE = {
    open: false,
    src: "",
    scale: 1,
    rotate: 0,
    translateX: 0,
    translateY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartTranslateX: 0,
    dragStartTranslateY: 0,
    prevBodyOverflow: "",
  };

  let host;
  let shadow;
  let overlay;
  let canvas;
  let img;
  let label;
  let entry;
  let entryBtn;
  let entryImg;
  let entryHideTimer;
  let hoverBound = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getImageSrc(el) {
    if (!el) return "";
    if (el.currentSrc) return el.currentSrc;
    if (el.src) return el.src;
    const raw = el.getAttribute?.("src");
    return raw || "";
  }

  function clearEntryHideTimer() {
    if (!entryHideTimer) return;
    window.clearTimeout(entryHideTimer);
    entryHideTimer = undefined;
  }

  function hideEntry(immediate = false) {
    if (!entry) return;
    clearEntryHideTimer();
    if (!immediate) {
      entryHideTimer = window.setTimeout(() => {
        entry.dataset.show = "0";
        entryImg = undefined;
      }, 80);
      return;
    }
    entry.dataset.show = "0";
    entryImg = undefined;
  }

  function positionEntryByRect(rect) {
    if (!entry) return;
    const btnW = 64;
    const btnH = 34;
    const padding = 10;
    const left = clamp(rect.right - btnW - 10, padding, window.innerWidth - btnW - padding);
    const top = clamp(rect.top + 10, padding, window.innerHeight - btnH - padding);
    entry.style.left = `${left}px`;
    entry.style.top = `${top}px`;
  }

  function showEntryForImage(el) {
    if (!el) return;
    if (STATE.open) return;
    const src = getImageSrc(el);
    if (!src) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (rect.width < 28 || rect.height < 28) return;
    if (rect.bottom < 0 || rect.right < 0) return;
    if (rect.top > window.innerHeight || rect.left > window.innerWidth) return;

    ensureUI();
    if (!entry) return;
    clearEntryHideTimer();
    entryImg = el;
    positionEntryByRect(rect);
    entry.dataset.show = "1";
  }

  function findImageAtPoint(clientX, clientY, fallbackTarget) {
    const el = document.elementFromPoint(clientX, clientY);
    const candidates = [];

    if (el instanceof Element) candidates.push(el);
    if (fallbackTarget instanceof Element && fallbackTarget !== el) candidates.push(fallbackTarget);

    for (const node of candidates) {
      if (host && host.contains(node)) continue;
      if (node instanceof HTMLImageElement) return node;

      const imgs = node.querySelectorAll?.("img");
      if (!imgs?.length) continue;

      let best = null;
      let bestArea = Infinity;
      for (const imgEl of imgs) {
        if (!(imgEl instanceof HTMLImageElement)) continue;
        const rect = imgEl.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (clientX < rect.left || clientX > rect.right) continue;
        if (clientY < rect.top || clientY > rect.bottom) continue;
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          best = imgEl;
        }
      }
      if (best) return best;
    }

    return null;
  }

  function bindHoverEntry() {
    if (hoverBound) return;
    hoverBound = true;

    let rafId = 0;
    let lastX = 0;
    let lastY = 0;
    let lastTarget = null;

    const tick = () => {
      rafId = 0;
      if (STATE.open) return;
      const imgEl = findImageAtPoint(lastX, lastY, lastTarget);
      if (imgEl) {
        showEntryForImage(imgEl);
        return;
      }
      hideEntry(false);
    };

    document.addEventListener(
      "pointermove",
      (e) => {
        if (STATE.open) return;
        lastX = e.clientX;
        lastY = e.clientY;
        lastTarget = e.target;
        if (rafId) return;
        rafId = window.requestAnimationFrame(tick);
      },
      true,
    );

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!entry || entry.dataset.show !== "1") return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (entry.contains(target)) return;
        hideEntry(false);
      },
      true,
    );

    window.addEventListener(
      "scroll",
      () => {
        if (STATE.open) return;
        if (!entry || entry.dataset.show !== "1") return;
        if (!entryImg) return;
        positionEntryByRect(entryImg.getBoundingClientRect());
      },
      true,
    );
  }

  function normalizeRotate(deg) {
    let r = deg % 360;
    if (r < 0) r += 360;
    return r;
  }

  function updateLabel() {
    if (!label) return;
    const percent = Math.round(STATE.scale * 100);
    label.textContent = `缩放 ${percent}% · 旋转 ${normalizeRotate(STATE.rotate)}°`;
  }

  function applyTransform() {
    if (!canvas) return;
    canvas.style.setProperty("--s", `${STATE.scale}`);
    canvas.style.setProperty("--r", `${STATE.rotate}deg`);
    canvas.style.setProperty("--x", `${STATE.translateX}px`);
    canvas.style.setProperty("--y", `${STATE.translateY}px`);
    updateLabel();
  }

  function resetTransform() {
    STATE.scale = 1;
    STATE.rotate = 0;
    STATE.translateX = 0;
    STATE.translateY = 0;
    applyTransform();
  }

  function fitToViewport() {
    if (!img?.naturalWidth || !img?.naturalHeight) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = Math.max(24, Math.min(vw, vh) * 0.06);
    const availableW = Math.max(1, vw - margin * 2);
    const availableH = Math.max(1, vh - margin * 2 - 56);

    const r = normalizeRotate(STATE.rotate);
    const baseW = r === 90 || r === 270 ? img.naturalHeight : img.naturalWidth;
    const baseH = r === 90 || r === 270 ? img.naturalWidth : img.naturalHeight;

    const scale = Math.min(availableW / baseW, availableH / baseH, 8);
    STATE.scale = clamp(scale, 0.05, 10);
    STATE.translateX = 0;
    STATE.translateY = 0;
    applyTransform();
  }

  function setOpen(open) {
    STATE.open = open;
    if (!overlay) return;
    overlay.dataset.open = open ? "1" : "0";
    if (open) {
      hideEntry(true);
      STATE.prevBodyOverflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
      overlay.focus({ preventScroll: true });
    } else {
      document.body.style.overflow = STATE.prevBodyOverflow;
    }
  }

  function ensureUI() {
    if (host) return;

    host = document.createElement("div");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.setAttribute("data-image-previewer-host", "1");

    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host{all:initial}
        .entry{
          position: fixed;
          z-index: 2147483647;
          display: none;
          pointer-events: auto;
        }
        .entry[data-show="1"]{display:block}
        .entryBtn{
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(18, 20, 24, 0.70);
          color: rgb(245, 246, 248);
          font-size: 12px;
          letter-spacing: 0.2px;
          line-height: 34px;
          cursor: pointer;
          user-select: none;
          box-shadow: 0 10px 24px rgba(0,0,0,0.45);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }
        .entryBtn:hover{background: rgba(18, 20, 24, 0.82); border-color: rgba(255,255,255,0.22)}
        .entryBtn:active{transform: translateY(1px)}
        .overlay{
          position:fixed; inset:0;
          display:none;
          pointer-events:auto;
          background: rgba(15, 16, 18, 0.72);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          color: rgb(245, 246, 248);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
          outline: none;
        }
        .overlay[data-open="1"]{display:block}
        .chrome{
          position:absolute; inset: 16px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(20, 22, 26, 0.58);
          box-shadow: 0 22px 80px rgba(0,0,0,0.55);
          overflow:hidden;
        }
        .toolbar{
          height: 52px;
          display:flex;
          align-items:center;
          gap: 10px;
          padding: 0 12px;
          border-bottom: 1px solid rgba(255,255,255,0.10);
          background: rgba(18, 20, 24, 0.72);
        }
        .title{
          font-size: 13px;
          letter-spacing: 0.2px;
          opacity: 0.9;
          user-select:none;
          white-space:nowrap;
        }
        .spacer{flex:1}
        .btn{
          height: 32px;
          padding: 0 10px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: inherit;
          font-size: 12px;
          line-height: 32px;
          user-select:none;
          cursor: pointer;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }
        .btn:hover{background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.22)}
        .btn:active{transform: translateY(1px)}
        .btn.primary{
          background: rgba(67, 116, 255, 0.18);
          border-color: rgba(115, 147, 255, 0.48);
        }
        .btn.primary:hover{background: rgba(67, 116, 255, 0.24)}
        .stage{
          position:absolute; inset: 52px 0 0 0;
          display:block;
          overflow:hidden;
          cursor: grab;
        }
        .stage[data-dragging="1"]{cursor: grabbing}
        .canvas{
          position:absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) translate(var(--x, 0px), var(--y, 0px)) rotate(var(--r, 0deg)) scale(var(--s, 1));
          transform-origin: center center;
          will-change: transform;
          filter: drop-shadow(0 16px 38px rgba(0,0,0,0.45));
        }
        img{
          display:block;
          max-width:none;
          max-height:none;
          user-select:none;
          -webkit-user-drag:none;
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
        }
        .hint{
          position:absolute;
          left: 18px;
          bottom: 14px;
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(18, 20, 24, 0.62);
          font-size: 12px;
          opacity: 0.92;
          user-select:none;
          max-width: min(720px, calc(100vw - 80px));
          text-overflow: ellipsis;
          overflow:hidden;
          white-space:nowrap;
        }
        @media (prefers-reduced-motion: reduce){
          .btn{transition:none}
          .entryBtn{transition:none}
        }
      </style>
      <div class="entry" data-show="0">
        <button class="entryBtn" type="button">预览</button>
      </div>
      <div class="overlay" tabindex="0" data-open="0" aria-hidden="true">
        <div class="chrome" role="dialog" aria-modal="true" aria-label="图片预览">
          <div class="toolbar">
            <div class="title" id="label">缩放 100% · 旋转 0°</div>
            <div class="spacer"></div>
            <button class="btn" data-action="zoomOut" type="button">缩小</button>
            <button class="btn" data-action="zoomIn" type="button">放大</button>
            <button class="btn" data-action="rotateLeft" type="button">左转</button>
            <button class="btn" data-action="rotateRight" type="button">右转</button>
            <button class="btn" data-action="fit" type="button">适配</button>
            <button class="btn" data-action="reset" type="button">重置</button>
            <button class="btn primary" data-action="close" type="button">关闭</button>
          </div>
          <div class="stage" data-dragging="0">
            <div class="canvas" style="--s:1;--r:0deg;--x:0px;--y:0px">
              <img />
            </div>
            <div class="hint" id="hint">滚轮缩放 · 拖拽移动 · Esc 关闭</div>
          </div>
        </div>
      </div>
    `;

    overlay = shadow.querySelector(".overlay");
    canvas = shadow.querySelector(".canvas");
    img = shadow.querySelector("img");
    label = shadow.getElementById("label");
    entry = shadow.querySelector(".entry");
    entryBtn = shadow.querySelector(".entryBtn");

    entry.addEventListener("pointerenter", () => {
      clearEntryHideTimer();
    });
    entry.addEventListener("pointerleave", () => {
      hideEntry(false);
    });
    entryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!entryImg) return;
      const src = getImageSrc(entryImg);
      if (!src) return;
      open(src);
    });

    overlay.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const actionEl = target.closest("[data-action]");
      if (actionEl) {
        const action = actionEl.getAttribute("data-action");
        handleAction(action);
        return;
      }
      if (target.classList.contains("overlay")) {
        setOpen(false);
      }
    });

    overlay.addEventListener("keydown", (e) => {
      if (!STATE.open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1.12, window.innerWidth / 2, window.innerHeight / 2);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / 1.12, window.innerWidth / 2, window.innerHeight / 2);
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        resetTransform();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fitToViewport();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotateBy(90);
        return;
      }
    });

    const stage = shadow.querySelector(".stage");
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!STATE.open) return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
        zoomBy(factor, e.clientX, e.clientY);
      },
      { passive: false },
    );

    stage.addEventListener("pointerdown", (e) => {
      if (!STATE.open) return;
      const target = e.target;
      if (target instanceof Element && target.closest(".toolbar")) return;
      if (e.button !== 0) return;
      stage.setPointerCapture(e.pointerId);
      STATE.dragging = true;
      stage.dataset.dragging = "1";
      STATE.dragStartX = e.clientX;
      STATE.dragStartY = e.clientY;
      STATE.dragStartTranslateX = STATE.translateX;
      STATE.dragStartTranslateY = STATE.translateY;
    });

    stage.addEventListener("pointermove", (e) => {
      if (!STATE.open) return;
      if (!STATE.dragging) return;
      const dx = e.clientX - STATE.dragStartX;
      const dy = e.clientY - STATE.dragStartY;
      STATE.translateX = STATE.dragStartTranslateX + dx;
      STATE.translateY = STATE.dragStartTranslateY + dy;
      applyTransform();
    });

    stage.addEventListener("pointerup", () => {
      if (!STATE.dragging) return;
      STATE.dragging = false;
      stage.dataset.dragging = "0";
    });
    stage.addEventListener("pointercancel", () => {
      if (!STATE.dragging) return;
      STATE.dragging = false;
      stage.dataset.dragging = "0";
    });

    img.addEventListener("load", () => {
      if (!STATE.open) return;
      fitToViewport();
    });

    window.addEventListener("resize", () => {
      if (!STATE.open) return;
      fitToViewport();
    });

    document.documentElement.appendChild(host);
    bindHoverEntry();
  }

  function zoomBy(factor, clientX, clientY) {
    const oldScale = STATE.scale;
    const newScale = clamp(oldScale * factor, 0.05, 10);
    if (newScale === oldScale) return;

    const cx = clientX - window.innerWidth / 2;
    const cy = clientY - window.innerHeight / 2;
    const ratio = newScale / oldScale;
    STATE.translateX = cx - ratio * (cx - STATE.translateX);
    STATE.translateY = cy - ratio * (cy - STATE.translateY);
    STATE.scale = newScale;
    applyTransform();
  }

  function rotateBy(delta) {
    STATE.rotate = normalizeRotate(STATE.rotate + delta);
    applyTransform();
  }

  function handleAction(action) {
    if (!action) return;
    if (action === "close") {
      setOpen(false);
      return;
    }
    if (action === "zoomIn") {
      zoomBy(1.12, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    if (action === "zoomOut") {
      zoomBy(1 / 1.12, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    if (action === "rotateLeft") {
      rotateBy(-90);
      fitToViewport();
      return;
    }
    if (action === "rotateRight") {
      rotateBy(90);
      fitToViewport();
      return;
    }
    if (action === "fit") {
      fitToViewport();
      return;
    }
    if (action === "reset") {
      resetTransform();
      fitToViewport();
      return;
    }
  }

  function open(src) {
    ensureUI();
    STATE.src = src;
    resetTransform();
    setOpen(true);
    img.src = src;
    img.alt = "图片预览";
    applyTransform();
  }

  return {
    open,
  };
})();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "IMAGE_PREVIEW_OPEN") return;
  const src = message?.payload?.src;
  if (!src) return;
  imagePreviewer.open(src);
  sendResponse({ ok: true });
});
