const MENU_ID = "imagePreviewer.open";

function sendOpenMessage(tabId, src) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: "IMAGE_PREVIEW_OPEN",
        payload: {
          src,
        },
      },
      (response) => {
        const err = chrome.runtime.lastError;
        if (!err && response?.ok) {
          resolve({ ok: true, error: "" });
          return;
        }
        resolve({ ok: !err, error: err?.message || "" });
      },
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "查看图片",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;

  const src = info.srcUrl;
  if (!src) return;

  (async () => {
    const firstTry = await sendOpenMessage(tab.id, src);
    if (firstTry.ok) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["contentScript.js"],
      });
      const secondTry = await sendOpenMessage(tab.id, src);
      if (secondTry.ok) return;
    } catch (e) {
      void e;
    }

    chrome.tabs.create({ url: src });
  })();
});
