(() => {
  if (globalThis.imagePreviewer) return;

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
  let img;
  let label;
  let stage;
  let entry;
  let entryBtn;
  let entryImg;
  let filmstrip;
  let filmstripTrack;
  let entryHideTimer;
  let hoverBound = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getImageSrc(el) {
    if (!el) return "";
    const explicit = el.getAttribute?.("src") || "";
    const dataset = el.dataset || {};
    const lazyCandidates = [
      dataset.original,
      dataset.originalSrc,
      dataset.full,
      dataset.fullSrc,
      dataset.src,
      dataset.lazySrc,
      dataset.realSrc,
    ];
    const current = el.currentSrc || "";

    if (current && !current.startsWith("data:")) return current;

    for (const candidate of lazyCandidates) {
      if (typeof candidate !== "string") continue;
      const value = candidate.trim();
      if (!value || value === explicit || value === current) continue;
      if (value.startsWith("data:")) continue;
      return value;
    }

    if (current && current.startsWith("data:")) return explicit || current;
    return current || explicit || "";
  }

  function collectImgElements(root) {
    return Array.from((root || document).querySelectorAll?.("img") || []);
  }

  function findImageBySrcValue(src) {
    if (!src) return null;
    for (const el of document.images) {
      if (!(el instanceof HTMLImageElement)) continue;
      if (
        getImageSrc(el) === src ||
        el.currentSrc === src ||
        el.src === src ||
        el.getAttribute("src") === src
      ) {
        return el;
      }
    }
    return null;
  }

  function collectRelatedSources(src, sourceEl) {
    const seen = new Set();
    const sources = [];
    let root = null;

    if (sourceEl) {
      let node = sourceEl.parentElement;
      let depth = 0;
      while (node && node !== document.documentElement && depth < 6) {
        const imgs = collectImgElements(node).filter((el) => {
          if (!(el instanceof HTMLImageElement)) return false;
          if (!getImageSrc(el)) return false;
          const rect = el.getBoundingClientRect();
          return !!rect.width && !!rect.height;
        });
        if (imgs.length >= 2) {
          root = node;
          break;
        }
        node = node.parentElement;
        depth += 1;
      }
    }

    const candidates = root ? collectImgElements(root) : Array.from(document.images);
    for (const el of candidates) {
      if (!(el instanceof HTMLImageElement)) continue;
      const value = getImageSrc(el);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      sources.push(value);
      if (sources.length >= 80) break;
    }

    if (src && !seen.has(src)) sources.unshift(src);
    return sources;
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

  let renderRafId = 0;
  function applyTransform() {
    if (!img) return;
    if (renderRafId) return;
    renderRafId = window.requestAnimationFrame(() => {
      renderRafId = 0;
      img.style.transform = `translate(${STATE.translateX}px, ${STATE.translateY}px) rotate(${STATE.rotate}deg) scaleX(${STATE.scale}) scaleY(${STATE.scale})`;
      updateLabel();
    });
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
    const rect = stage.getBoundingClientRect();
    const stageW = rect.width;
    const stageH = rect.height;
    
    const margin = Math.max(24, Math.min(stageW, stageH) * 0.06);
    const availableW = Math.max(1, stageW - margin * 2);
    const availableH = Math.max(1, stageH - margin * 2);

    const r = normalizeRotate(STATE.rotate);
    const baseW = r === 90 || r === 270 ? img.naturalHeight : img.naturalWidth;
    const baseH = r === 90 || r === 270 ? img.naturalWidth : img.naturalHeight;

    const scale = Math.min(availableW / baseW, availableH / baseH, 8);
    STATE.scale = clamp(scale, 0.05, 100);

    const imgW = img.offsetWidth || img.naturalWidth;
    const imgH = img.offsetHeight || img.naturalHeight;

    STATE.translateX = stageW / 2 - imgW / 2;
    STATE.translateY = stageH / 2 - imgH / 2;
    applyTransform();
  }

  function setOpen(open) {
    STATE.open = open;
    if (!overlay) return;
    overlay.dataset.open = open ? "1" : "0";
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      hideEntry(true);
      STATE.prevBodyOverflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
      overlay.focus({ preventScroll: true });
    } else {
      document.body.style.overflow = STATE.prevBodyOverflow;
      STATE.dragging = false;
      if (stage) stage.dataset.dragging = "0";
      if (img) img.removeAttribute("src");
    }
  }

  function getStageCenterClient() {
    if (!stage) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = stage.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function zoomAtStageCenter(factor) {
    const c = getStageCenterClient();
    zoomBy(factor, c.x, c.y);
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
        :host{
          all:initial;
          --ip-bg: rgba(9, 10, 12, 0.74);
          --ip-panel: rgba(22, 24, 28, 0.86);
          --ip-panel-strong: rgba(16, 18, 22, 0.92);
          --ip-border: rgba(255,255,255,0.12);
          --ip-border-strong: rgba(255,255,255,0.22);
          --ip-text: rgb(246, 247, 249);
          --ip-muted: rgba(246, 247, 249, 0.68);
          --ip-accent: rgb(99, 132, 255);
          --ip-accent-soft: rgba(99, 132, 255, 0.20);
          --ip-danger: rgb(255, 112, 112);
          --ip-radius: 8px;
          --ip-ease: cubic-bezier(0.2, 0, 0.2, 1);
        }
        .entry{
          position: fixed;
          z-index: 2147483647;
          display: none;
          pointer-events: auto;
        }
        .entry[data-show="1"]{display:block}
        .entryBtn{
          height: 34px;
          padding: 0 11px;
          border-radius: var(--ip-radius);
          border: 1px solid var(--ip-border);
          background: var(--ip-panel-strong);
          color: var(--ip-text);
          font-size: 12px;
          letter-spacing: 0;
          line-height: 34px;
          cursor: pointer;
          user-select: none;
          box-shadow: 0 10px 28px rgba(0,0,0,0.38);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          transition: transform 120ms var(--ip-ease), background 120ms var(--ip-ease), border-color 120ms var(--ip-ease);
        }
        .entryBtn:hover{background: rgba(29, 32, 38, 0.92); border-color: var(--ip-border-strong)}
        .entryBtn:focus-visible{outline: 2px solid var(--ip-accent); outline-offset: 2px}
        .entryBtn:active{transform: translateY(1px)}
        .overlay{
          position:fixed; inset:0;
          display:none;
          pointer-events:auto;
          background: var(--ip-bg);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          color: var(--ip-text);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
          outline: none;
        }
        .overlay[data-open="1"]{display:block}
        .chrome{
          position:absolute; inset: 12px;
          border-radius: var(--ip-radius);
          border: 1px solid var(--ip-border);
          background: rgba(16, 18, 22, 0.50);
          box-shadow: 0 24px 70px rgba(0,0,0,0.48);
          overflow:hidden;
        }
        .toolbar{
          min-height: 52px;
          display:flex;
          align-items:center;
          gap: 8px;
          padding: 8px 10px;
          border-bottom: 1px solid var(--ip-border);
          background: var(--ip-panel);
          box-sizing:border-box;
        }
        .title{
          min-width: 132px;
          font-size: 13px;
          letter-spacing: 0;
          color: var(--ip-muted);
          user-select:none;
          white-space:nowrap;
        }
        .spacer{flex:1}
        .group{
          display:flex;
          align-items:center;
          gap: 6px;
          padding: 3px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: var(--ip-radius);
          background: rgba(255,255,255,0.045);
        }
        .btn{
          height: 32px;
          min-width: 44px;
          padding: 0 9px;
          border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          color: inherit;
          font-size: 12px;
          line-height: 32px;
          user-select:none;
          cursor: pointer;
          transition: transform 120ms var(--ip-ease), background 120ms var(--ip-ease), border-color 120ms var(--ip-ease), color 120ms var(--ip-ease);
        }
        .btn:hover{background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.10)}
        .btn:focus-visible{outline: 2px solid var(--ip-accent); outline-offset: 2px}
        .btn:active{transform: translateY(1px)}
        .btn.primary{
          background: var(--ip-accent-soft);
          border-color: rgba(99, 132, 255, 0.42);
          color: var(--ip-text);
        }
        .btn.primary:hover{background: rgba(99, 132, 255, 0.28)}
        .stage{
          position:absolute; inset: 52px 0 0 0;
          display:block;
          overflow:hidden;
          cursor: grab;
        }
        .stage[data-dragging="1"]{cursor: grabbing}
        .stage img{
          position:absolute;
          left: 0;
          top: 0;
          display:block;
          max-width:none;
          max-height:none;
          user-select:none;
          -webkit-user-drag:none;
          border-radius: var(--ip-radius);
          background: rgba(255,255,255,0.04);
          transform-origin: center center;
          will-change: transform;
          box-shadow: 0 16px 38px rgba(0,0,0,0.42);
          transition: transform 0.12s var(--ip-ease);
        }
        .stage[data-dragging="1"] img {
          transition: none;
        }
        .overlay.has-filmstrip .stage{
          inset: 52px 0 96px 0;
        }
        .filmstrip{
          position:absolute;
          left: 10px;
          right: 10px;
          bottom: 10px;
          height: 86px;
          z-index: 2;
          box-sizing:border-box;
          display:flex;
          align-items:center;
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--ip-border);
          border-radius: var(--ip-radius);
          background: var(--ip-panel);
          box-shadow: 0 12px 34px rgba(0,0,0,0.34);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .filmstrip[data-empty="1"]{display:none}
        .filmstripLabel{
          flex: 0 0 auto;
          font-size: 12px;
          color: var(--ip-muted);
          letter-spacing: 0;
          user-select:none;
          white-space:nowrap;
        }
        .filmstripTrack{
          flex: 1;
          display:flex;
          align-items:center;
          gap: 8px;
          overflow-x:auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.22) transparent;
        }
        .filmstripTrack::-webkit-scrollbar{height: 5px}
        .filmstripTrack::-webkit-scrollbar-thumb{background: rgba(255,255,255,0.22); border-radius: 4px}
        .thumb{
          flex: 0 0 auto;
          width: 62px;
          height: 50px;
          padding: 0;
          border: 1px solid var(--ip-border);
          border-radius: 6px;
          background: rgba(255,255,255,0.06);
          overflow: hidden;
          cursor: pointer;
          transition: border-color 120ms var(--ip-ease), transform 120ms var(--ip-ease), box-shadow 120ms var(--ip-ease);
        }
        .thumb:hover{border-color: var(--ip-border-strong); transform: translateY(-1px)}
        .thumb:focus-visible{outline: 2px solid var(--ip-accent); outline-offset: 2px}
        .thumb.active{
          border-color: var(--ip-accent);
          box-shadow: inset 0 0 0 2px rgba(99,132,255,0.42);
        }
        .thumb img{
          display:block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          pointer-events:none;
        }
        .hint{
          position:absolute;
          left: 18px;
          bottom: 14px;
          padding: 8px 10px;
          border-radius: var(--ip-radius);
          border: 1px solid var(--ip-border);
          background: rgba(18, 20, 24, 0.68);
          font-size: 12px;
          color: var(--ip-muted);
          user-select:none;
          max-width: min(720px, calc(100vw - 80px));
          text-overflow: ellipsis;
          overflow:hidden;
          white-space:nowrap;
        }
        @media (max-width: 720px){
          .chrome{inset: 8px}
          .toolbar{
            overflow-x:auto;
            scrollbar-width:none;
          }
          .toolbar::-webkit-scrollbar{display:none}
          .title{min-width: max-content}
          .spacer{display:none}
          .group{flex:0 0 auto}
          .hint{
            left: 10px;
            right: 10px;
            bottom: 10px;
            max-width:none;
          }
          .filmstripLabel{display:none}
          .thumb{width: 56px; height: 48px}
        }
        @media (prefers-reduced-motion: reduce){
          .stage img{transition:none}
          .btn{transition:none}
          .entryBtn{transition:none}
          .thumb{transition:none}
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
            <div class="group" aria-label="缩放">
              <button class="btn" data-action="zoomOut" type="button" title="缩小">缩小</button>
              <button class="btn" data-action="zoomIn" type="button" title="放大">放大</button>
            </div>
            <div class="group" aria-label="旋转">
              <button class="btn" data-action="rotateLeft" type="button" title="左转">左转</button>
              <button class="btn" data-action="rotateRight" type="button" title="右转">右转</button>
            </div>
            <div class="group" aria-label="视图">
              <button class="btn" data-action="fit" type="button" title="适配窗口">适配</button>
              <button class="btn" data-action="reset" type="button" title="重置视图">重置</button>
            </div>
            <button class="btn primary" data-action="close" type="button" title="关闭预览">关闭</button>
          </div>
          <div class="stage" data-dragging="0">
            <img />
            <div class="hint" id="hint">滚轮缩放 · 拖拽移动 · Esc 关闭</div>
          </div>
          <div class="filmstrip" data-empty="1" role="region" aria-label="其他图片">
            <div class="filmstripLabel">图片列表</div>
            <div class="filmstripTrack"></div>
          </div>
        </div>
      </div>
    `;

    overlay = shadow.querySelector(".overlay");
    img = shadow.querySelector("img");
    label = shadow.getElementById("label");
    entry = shadow.querySelector(".entry");
    entryBtn = shadow.querySelector(".entryBtn");
    filmstrip = shadow.querySelector(".filmstrip");
    filmstripTrack = shadow.querySelector(".filmstripTrack");

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
      open(src, entryImg);
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
        zoomAtStageCenter(1.12);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomAtStageCenter(1 / 1.12);
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

    stage = shadow.querySelector(".stage");
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!STATE.open) return;
        e.preventDefault();
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        if (e.deltaMode === 2) delta *= window.innerHeight;
        let factor = Math.exp(-delta * 0.002);
        factor = clamp(factor, 0.2, 5);
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
    const newScale = clamp(oldScale * factor, 0.05, 100);
    if (newScale === oldScale) return;

    const stageRect = stage.getBoundingClientRect();
    const mouseX = clientX - stageRect.left;
    const mouseY = clientY - stageRect.top;

    const originX = (img.naturalWidth || 0) / 2;
    const originY = (img.naturalHeight || 0) / 2;

    const ratio = newScale / oldScale;

    STATE.translateX = mouseX - originX - (mouseX - originX - STATE.translateX) * ratio;
    STATE.translateY = mouseY - originY - (mouseY - originY - STATE.translateY) * ratio;
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
      zoomAtStageCenter(1.12);
      return;
    }
    if (action === "zoomOut") {
      zoomAtStageCenter(1 / 1.12);
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

  function renderFilmstrip(sources, activeSrc) {
    if (!filmstrip || !filmstripTrack) return;
    filmstripTrack.innerHTML = "";
    const hasMore = sources.length > 1;
    filmstrip.dataset.empty = hasMore ? "0" : "1";
    overlay.classList.toggle("has-filmstrip", hasMore);

    for (const src of sources) {
      const thumbBtn = document.createElement("button");
      thumbBtn.type = "button";
      thumbBtn.className = "thumb";
      if (src === activeSrc) thumbBtn.classList.add("active");

      const thumbImg = document.createElement("img");
      thumbImg.src = src;
      thumbImg.alt = "";
      thumbImg.loading = "lazy";
      thumbBtn.appendChild(thumbImg);

      thumbBtn.addEventListener("click", () => {
        if (src === STATE.src) return;
        open(src, findImageBySrcValue(src));
      });

      filmstripTrack.appendChild(thumbBtn);
    }
  }

  function open(src, sourceEl) {
    ensureUI();
    STATE.src = src;
    const related = collectRelatedSources(src, sourceEl || findImageBySrcValue(src));
    renderFilmstrip(related, src);
    resetTransform();
    setOpen(true);
    img.src = src;
    img.alt = "图片预览";
    applyTransform();
  }

  globalThis.imagePreviewer = {
    open,
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "IMAGE_PREVIEW_OPEN") return;
    const src = message?.payload?.src;
    if (!src) return;
    globalThis.imagePreviewer.open(src);
    sendResponse({ ok: true });
  });
})();
