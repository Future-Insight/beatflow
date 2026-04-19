/* =========================================================
   Beatflow · my-images.js
   ---------------------------------------------------------
   "我的图片" 本地图库 · IndexedDB 持久化
   不走任何后端，Blob 原样存浏览器里，跨刷新仍在。

   对外 API（挂在 window.BeatflowMyImages）：
     initDB()            → Promise<void>
     list()              → Promise<MyImage[]>    列全部并为每张 createObjectURL
     add(file: File)     → Promise<MyImage>      写入 + 返回（含 blob URL）
     remove(id: string)  → Promise<void>         从 IDB 删除
     revokeAll(items)    → void                  卸载时清 blob URL

   MyImage 对象形态与 images[] 其它元素兼容，可直接塞进 setImages：
     { id, type: "local", file: Blob, src: <blob-url>, label, name, addedAt }

   export.js 的 img.file 分支（createImageBitmap）能直接吃 Blob，导出无需改动。
   ========================================================= */

(function (global) {
  "use strict";

  const DB_NAME = "beatflow_my_images";
  const STORE  = "images";
  const VERSION = 1;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode) {
    return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "mi_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  }

  async function initDB() { await openDB(); }

  function toMyImage(entry) {
    const src = URL.createObjectURL(entry.blob);
    return {
      id: entry.id,
      type: "local",
      file: entry.blob,
      src,
      label: (entry.name || "image").toUpperCase(),
      name: entry.name,
      addedAt: entry.addedAt,
    };
  }

  async function list() {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).slice().sort((a, b) => a.addedAt - b.addedAt);
        resolve(rows.map(toMyImage));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function add(file) {
    if (!file) throw new Error("add(file) requires a File");
    const entry = {
      id: newId(),
      blob: file,
      name: file.name || "image",
      addedAt: Date.now(),
    };
    const store = await tx("readwrite");
    await new Promise((resolve, reject) => {
      const req = store.add(entry);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
    return toMyImage(entry);
  }

  async function remove(id) {
    const store = await tx("readwrite");
    await new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  function revokeAll(items) {
    (items || []).forEach((m) => {
      if (m && m.src) { try { URL.revokeObjectURL(m.src); } catch (e) {} }
    });
  }

  global.BeatflowMyImages = { initDB, list, add, remove, revokeAll };
})(window);
