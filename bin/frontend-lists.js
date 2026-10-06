// Last modified: 2026/10/05 08:41:46

// ==========================================================
//  Server-Interaktionen (save/load/list)
// ==========================================================

function saveListToServer(filename, activeItems, inactiveItems, onSuccess, onError) {
  // Immer lokal cachen, damit bei Offline/Fehlern ein Fallback existiert
  try { cacheListLocally(filename, { active: activeItems, inactive: inactiveItems, shared: _currentListShared }, { source: 'save-call' }); } catch (e) {}

  // Offline: lokal queue'n und als "Erfolg" behandeln (UI bleibt konsistent)
  if (!navigator.onLine) {
    queuePendingSave(filename, activeItems, inactiveItems);
    showStatus('Kein Netzwerk – Änderungen lokal gespeichert.', 'warning');
    onSuccess?.({ success: true, offline: true });
    return;
  }

  postToBackend({
    action: "save",
    filename,
    active: activeItems,
    inactive: inactiveItems,
    username: typeof username !== 'undefined' ? username : undefined,
  })
    .then(async (response) => {
      let data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      if (!response.ok) {
        // Manche Umgebungen liefern bei Offline/Netzproblemen eine nicht-OK Response (z.B. 503/504)
        // statt eines Fetch-Fehlers. Diese Fälle wie Offline behandeln (lokal queue'n).
        const st = typeof response.status === 'number' ? response.status : 0;
        const isTransient = (st === 0 || st === 408 || st === 502 || st === 503 || st === 504);
        if (isTransient) {
          queuePendingSave(filename, activeItems, inactiveItems);
          showStatus('Kein Netzwerk – Änderungen lokal gespeichert.', 'warning');
          return { success: true, offline: true, queued: true, status: st };
        }
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Serverfehler: ' + response.status);
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      if (data && data.success) {
        // Erfolgreich: ggf. Pending-Queue flushen
        if (!data.offline) {
          try { flushPendingSaves('Save'); } catch (e) {}
        }
        onSuccess?.(data);
      } else {
        onError?.((data && data.error) || "Unbekannter Fehler");
      }
    })
    .catch((error) => {
      if (_isProbablyNetworkError(error) || !navigator.onLine) {
        queuePendingSave(filename, activeItems, inactiveItems);
        showStatus('Kein Netzwerk – Änderungen lokal gespeichert.', 'warning');
        onSuccess?.({ success: true, offline: true });
        return;
      }
      onError?.(error && error.message ? error.message : error);
    });
}

function fetchAllLists(onSuccess, onError) {
  postToBackend({ action: "list", username: typeof username !== 'undefined' ? username : undefined })
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error("Serverfehler: " + response.status);
        throw new Error("Ungültige Serverantwort beim Laden der Listen.");
      }
      if (!response.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ("Serverfehler: " + response.status);
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      if (Array.isArray(data)) {
        try { cacheOverviewLocally(data); } catch (e) {}
        onSuccess?.(data);
      }
      else onError?.(data && (data.error || data.message) ? (data.error || data.message) : "Antwortformat ungültig");
    })
    .catch((error) => {
      if (_isProbablyNetworkError(error)) {
        const cached = getCachedOverviewLocally();
        if (cached && Array.isArray(cached.lists)) {
          showStatus('Kein Netzwerk – zeige lokal gespeicherte Listenübersicht.', 'warning');
          onSuccess?.(cached.lists);
          return;
        }
        showStatus('Kein Netzwerk – keine lokal gespeicherte Listenübersicht vorhanden.', 'warning');
      }
      onError?.(error.message || error);
    });
}

function _renderListPayloadToUi(filename, payload, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const ulActive = document.getElementById("itemList");
  const ulInactive = document.getElementById("inactiveList");
  if (!ulActive || !ulInactive) return;

  ulActive.innerHTML = "";
  ulInactive.innerHTML = "";

  _currentListShared = !!(payload && payload.shared);

  if (Array.isArray(payload.active)) {
    payload.active.forEach((item) => ulActive.appendChild(createActiveItem(item)));
  }
  if (Array.isArray(payload.inactive)) {
    payload.inactive.forEach((item) => ulInactive.appendChild(createInactiveItem(item)));
    sortInactiveList();
  }

  // Periodische Synchronisation: nur für geteilte Listen und nur wenn online
  try {
    if (_currentListShared && navigator.onLine && !opts.forceDisableSync) {
      startPeriodicSync(filename);
    } else {
      stopPeriodicSync();
      _setSyncIndicator(false);
    }
  } catch (e) {
    console.warn('Konnte Periodic Sync nicht starten/stoppen:', e);
  }
}

function loadList() {
  let filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";

  const skip = new Set(['user', 'token', 'share', 'download','invite']);

  // Verhindere das Laden von speziellen Query-/Parameternamen
  if (skip.has(filename)) {
    showStatus("Das Laden dieser Liste ist nicht möglich.", "error");
    return;
  }

  postToBackend({ action: "load", id: filename, username: typeof username !== 'undefined' ? username : undefined })
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error(`Serverfehler (${response.status}) beim Laden der Liste.`);
        throw new Error("Ungültige Serverantwort – kein gültiges JSON erhalten.");
      }
      if (!response.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Serverfehler: ' + response.status);
        throw new Error(msg);
      }
      if (data && data.success === false) {
        throw new Error(data.error || "Unbekannter Backend-Fehler.");
      }

      const ulActive = document.getElementById("itemList");
      const ulInactive = document.getElementById("inactiveList");
      if (!ulActive || !ulInactive) return;

      ulActive.innerHTML = "";
      ulInactive.innerHTML = "";

      // Normalisiere mögliche Backend-Formate:
      // - bevorzugt: direktes Objekt mit `active`/`inactive` und optional `shared`
      // - fallback: Backend liefert { content: "<raw json>", shared: true }
      let payload = data;
      if (payload && typeof payload.content === 'string' && !Array.isArray(payload.active) && !Array.isArray(payload.inactive)) {
        try {
          const parsed = JSON.parse(payload.content);
          if (parsed && typeof parsed === 'object') {
            payload = Object.assign({}, parsed, { shared: !!payload.shared });
          }
        } catch (e) {
          // leave payload as-is; it will be handled as invalid below
        }
      }

      // Setze globalen Shared-Status (wird von startPeriodicSync genutzt)
      try { cacheListLocally(filename, payload, { source: 'load-ok' }); } catch (e) {}
      _renderListPayloadToUi(filename, payload);
    })
    .catch((error) => {
      if (_isProbablyNetworkError(error) || !navigator.onLine) {
        const cached = getCachedListLocally(filename);
        if (cached && (Array.isArray(cached.active) || Array.isArray(cached.inactive))) {
          const payload = { active: cached.active || [], inactive: cached.inactive || [], shared: !!cached.shared };
          _renderListPayloadToUi(filename, payload, { forceDisableSync: true });
          showStatus('Kein Netzwerk – zeige zuletzt lokal gespeicherte Version.', 'warning');
          return;
        }
        showStatus('Kein Netzwerk – keine lokale Version dieser Liste vorhanden.', 'warning');
        return;
      }

      showStatus("Fehler: " + (error && error.message ? error.message : error), "error");
      console.error("Fehler beim Laden der Liste:", error);
    });
}

/**
 * Erzeugt ein Share-Token via Backend und zeigt das Ergebnis an.
 * Kopiert, falls möglich, den Share-Link in die Zwischenablage.
 */
function shareListRequest(filename, listMeta) {
  const payload = {
    action: "share",
    filename,
    username: typeof username !== "undefined" ? username : undefined,
  };
  postToBackend(payload)
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error("Ungültige Serverantwort beim Erstellen des Share-Tokens.");
      }
      if (!response.ok) {
        throw new Error(data && (data.error || data.message) ? (data.error || data.message) : ("Serverfehler: " + response.status));
      }
      return data;
    })
    .then((data) => {
      if (!data || data.success === false) {
        showStatus("Fehler beim Erstellen des Share-Tokens: " + (data && (data.error || data.message) ? (data.error || data.message) : "Unbekannter Fehler"), "error");
        return;
      }
      const token = data.share;
      if (!token) {
        showStatus("Share-Token wurde nicht zurückgegeben.", "error");
        return;
      }

      // Erzeuge eine nutzerfreundliche Share-URL (Empfänger kann Token an Backend senden)
      const shareUrl = window.location.origin + window.location.pathname + "?share=" + encodeURIComponent(token);

      // Versuche, die URL in die Zwischenablage zu kopieren
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          showStatus("Share-Link kopiert: " + shareUrl, "change");
        }).catch(() => {
          // Fallback: nur anzeigen
          showStatus("Share-Link: " + shareUrl, "change");
        });
      } else {
        // Kein Clipboard-Support -> anzeigen
        showStatus("Share-Link: " + shareUrl, "change");
      }

      // Optional: Eingabeaufforderung anbieten (ältere Browser)
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          // eslint-disable-next-line no-alert
          alert("Share-Link:\n" + shareUrl + "\n\nBitte kopieren Sie diesen Link manuell.");
        }
      } catch (e) {}
    })
    .catch((err) => {
      console.error("Fehler beim Erzeugen des Share-Tokens:", err);
      showStatus("Fehler beim Erstellen des Share-Tokens", "error");
    });
}

// Liest einen Query-Parameter aus der URL
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.has(name) ? params.get(name) : null;
}

// Nimmt ein Share-Token entgegen, ruft das Backend auf und behandelt die Antwort.
function acceptSharedToken(token) {
  if (!token) return;

  showStatus('Versuche, geteilte Liste zu übernehmen...', 'change');

  postToBackend({ action: 'shared', share: token, username: typeof username !== 'undefined' ? username : undefined })
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('Ungültige Serverantwort beim Übernehmen der Liste.');
      }
      if (!response.ok) {
        // Backend verwendet sendError mit success=false, aber setzt oft 202; beide Fälle behandeln
        const msg = (data && (data.error || data.message)) ? (data.error || data.message) : ('Serverfehler: ' + response.status);
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      if (!data || data.success === false) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : 'Unbekannter Fehler';
        showStatus('Fehler beim Übernehmen der Liste: ' + msg, 'error');
        return;
      }

      const importedFilename = data.filename ? data.filename.replace(/\.json$/, '') : null;
      showStatus('Liste übernommen' + (importedFilename ? ': ' + importedFilename : ''), 'change');

      // Entferne 'share' aus der URL, damit ein erneutes Laden nicht nochmals importiert
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        window.history.replaceState({}, document.title, url.toString());
      } catch (e) {}

      // UI: Wechsel in die Listen-Ansicht und lade die importierte Liste sofort
      try {
        const filenameEl = document.getElementById('filename');
        if (filenameEl && importedFilename) filenameEl.value = importedFilename;

        // Aktualisiere das sichtbare Listennamen-Element (falls serverseitig zunächst 'share' angezeigt wurde)
        try {
          const listNameEl = document.getElementById('listName');
          if (listNameEl && importedFilename) {
            listNameEl.textContent = replaceUnderscoresWithSpaces(importedFilename);
          }
        } catch (e) {}

        const listElements = document.getElementById('listElements');
        const listOverview = document.getElementById('listOverview');
        if (listElements) listElements.style.display = '';
        if (listOverview) listOverview.style.display = 'none';

        // Starte Inaktivitäts-Timer für die geöffnete Liste
        try { startInactivityTimer(); } catch (e) {}

        // Lade die neue Liste
        if (importedFilename) loadList();

        // Aktualisiere die Listenübersicht im Hintergrund
        try { fetchAllLists(showServerLists, () => {}); } catch (e) {}
      } catch (e) {
        // Ignoriere UI-Fehler
      }
    })
    .catch((err) => {
      console.error('Fehler beim Übernehmen des Shares:', err);
      showStatus(err.message || 'Fehler beim Übernehmen der Liste', 'error');
    });
}


// --- Periodische Synchronisation ---
let _syncIntervalId = null;
// Aktueller Zustand der geladenen Liste: true wenn die Liste geteilt ist (Backend-Flag `shared`)
let _currentListShared = false;
// Zeitpunkt, wann der aktive Sync gestartet wurde (ms seit Epoch)
let _syncingStartedAt = 0;
function stopPeriodicSync() {
  if (_syncIntervalId) {
    clearInterval(_syncIntervalId);
    _syncIntervalId = null;
  }
}

// Visuelles Sync-Indikator setzen
function _setSyncIndicator(on) {
  try {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    if (on) {
      el.classList.add('active');
      el.setAttribute('aria-hidden', 'false');
      el.setAttribute('title', 'Automatischer Sync aktiv');
    } else {
      el.classList.remove('active');
      el.setAttribute('aria-hidden', 'true');
    }
  } catch (e) {}
}

function _showActiveSync(on) {
  try {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    const MIN_VISIBLE_MS = 1000; // minimale Sichtbarkeitsdauer, damit Animation sichtbar wird
    if (on) {
      // Startzeit merken
      _syncingStartedAt = Date.now();
      // Klasse setzen und einen Reflow erzwingen, damit die CSS-Animation wirklich startet
      el.classList.add('syncing');
      // force reflow
      void el.offsetWidth;
    } else {
      // Wenn noch nicht lange genug sichtbar, verzögere das Entfernen
      const started = _syncingStartedAt || 0;
      const elapsed = Date.now() - started;
      if (started === 0 || elapsed >= MIN_VISIBLE_MS) {
        el.classList.remove('syncing');
        _syncingStartedAt = 0;
      } else {
        setTimeout(() => {
          try { el.classList.remove('syncing'); } catch (e) {}
          _syncingStartedAt = 0;
        }, MIN_VISIBLE_MS - elapsed);
      }
    }
  } catch (e) {}
}

function startPeriodicSync(filename) {
  stopPeriodicSync();
  if (!filename) return;
  // Starte periodischen Sync nur, wenn die aktuell geladene Liste als geteilt markiert ist
  if (!_currentListShared) {
    console.debug('Periodischer Sync deaktiviert: Liste ist nicht geteilt');
    _setSyncIndicator(false);
    return;
  }
  // Initiale Verzögerung bis zum ersten Sync: 60s
  _syncIntervalId = setInterval(() => syncNow(filename), syncInterval);
  _setSyncIndicator(true);
}

function syncNow(filename) {
  if (!filename) filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";
  if (!filename) return;
  _showActiveSync(true);
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((li) =>
    li.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((li) =>
    li.querySelector(".itemText").textContent.trim()
  );

  postToBackend({ action: "sync", filename, active: activeItems, inactive: inactiveItems, username: typeof username !== 'undefined' ? username : undefined })
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error(`Server antwortet nicht (${response.status})`);
        throw new Error('Ungültige Serverantwort beim Sync.');
      }
      if (!response.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Server antwortet nicht (' + response.status + ')');
        throw new Error(msg);
      }
      if (!data || data.success === false) {
        const msg = data && data.error ? data.error : 'Unbekannter Backend-Fehler beim Sync.';
        showStatus(`Fehler bei Sync: ${msg}`, "error");
        return;
      }
      // Wenn aktive/inaktive Arrays zurückgegeben werden und sie sich vom Client unterscheiden, UI aktualisieren
      if (data.message !== 'keine Änderungen') {
        if (
          Array.isArray(data.active) &&
          Array.isArray(data.inactive) &&
          (
            JSON.stringify(activeItems) !== JSON.stringify(data.active) ||
            JSON.stringify(inactiveItems) !== JSON.stringify(data.inactive)
          )
        ) {
          const ulActive = document.getElementById("itemList");
          const ulInactive = document.getElementById("inactiveList");
          if (!ulActive || !ulInactive) return;

          // Entferne bestehende LIs (inkl. möglicher observer) und erstelle neue
          ulActive.innerHTML = "";
          ulInactive.innerHTML = "";

          data.active.forEach((item) => ulActive.appendChild(createActiveItem(item)));
          data.inactive.forEach((item) => ulInactive.appendChild(createInactiveItem(item)));
          sortInactiveList();
          // Bevorzuge serverseitige Nachricht (kann Benutzernamen enthalten), ansonsten auf
          // `changedBy` oder eine generische Meldung zurückgreifen
          try {
            const listNameReadable = typeof filename === 'string' ? replaceUnderscoresWithSpaces(filename) : filename;
            let statusMsg = "Änderung durch anderen Benutzer";
            let shouldShow = true;
            if (data && data.changedBy) {
              // Keine Nachricht anzeigen, wenn die Änderung vom aktuellen Benutzer stammt
              if (typeof username !== 'undefined' && data.changedBy === username) {
                shouldShow = false;
              } else {
                statusMsg = `${data.changedBy} hat die Liste '${listNameReadable}' geändert.`;
              }
            } else if (data && data.message) {
              statusMsg = String(data.message);
            }
            if (shouldShow) showStatus(statusMsg, "change");
          } catch (e) {
            showStatus("Änderung durch anderen Benutzer", "change");
          }
        }
      } 
    })
    .catch((err) => {
      if (_isProbablyNetworkError(err) || !navigator.onLine) {
        showStatus('Kein Netzwerk – Sync pausiert.', 'warning');
        try { stopPeriodicSync(); } catch (e) {}
        try { _setSyncIndicator(false); } catch (e) {}
        return;
      }
      showStatus(`Server nicht erreichbar`, "error");
    })
    .finally(() => {
      _showActiveSync(false);
    });
}

// --- Inaktivitäts-Timer: nach x Minuten ohne Aktion zurück zur Übersichtsseite ---
let _inactivityTimerId = null;
let _inactivityListenersAdded = false;
const _activityEvents = ["click", "keydown", "mousemove", "touchstart", "scroll", "input"];

function _activityHandler() {
  resetInactivityTimer();
}

function startInactivityTimer() {
  stopInactivityTimer();
  const filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl();
  if (!filename) return; // nur starten, wenn eine Liste geöffnet ist

  _inactivityTimerId = setTimeout(() => {
    stopPeriodicSync();
    stopInactivityTimer();
    try {
      showStatus("Wegen Inaktivität: Zurück zur Listenübersicht", "change");
    } catch (e) {}
    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname;
    }, 2000);
  }, inactivityTimeoutMs);

  if (!_inactivityListenersAdded) {
    _activityEvents.forEach((ev) => document.addEventListener(ev, _activityHandler, { passive: true }));
    _inactivityListenersAdded = true;
  }
}

function resetInactivityTimer() {
  if (_inactivityTimerId) {
    clearTimeout(_inactivityTimerId);
    _inactivityTimerId = null;
  }
  // falls die Liste nicht offen ist, nichts tun
  const filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl();
  if (!filename) return;

  _inactivityTimerId = setTimeout(() => {
    stopPeriodicSync();
    stopInactivityTimer();
    try {
      showStatus("Wegen Inaktivität: Zurück zur Listenübersicht", "change");
    } catch (e) {}
    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname;
    }, 1200);
  }, inactivityTimeoutMs);
}

function stopInactivityTimer() {
  if (_inactivityTimerId) {
    clearTimeout(_inactivityTimerId);
    _inactivityTimerId = null;
  }
  if (_inactivityListenersAdded) {
    _activityEvents.forEach((ev) => document.removeEventListener(ev, _activityHandler, { passive: true }));
    _inactivityListenersAdded = false;
  }
}


// ==========================================================
function setupListDragAndDrop() {
  const listContainer = document.getElementById("serverLists");
  if (!listContainer) return;
  if (!touchscreen) {
    
    // Mausbedienung
    listContainer.addEventListener("dragstart", (e) => {
      const li = e.target.closest("li");
      if (li && li.draggable) {
        draggedListLi = li;
        draggedListLi.classList.add("dragging");
        try {
          e.dataTransfer.setDragImage(li, li.offsetWidth / 2, li.offsetHeight / 2);
        } catch (err) {
          // einige Browser schränken setDragImage ein
        }
        setTimeout(() => (draggedListLi.style.display = "none"), 0);
      } else {
        e.preventDefault();
      }
    });

    listContainer.addEventListener("dragend", () => {
      if (draggedListLi) {
        setTimeout(() => {
          draggedListLi.style.display = "";
          draggedListLi.classList.remove("dragging");
          draggedListLi = null;
        }, 0);
        updateListOrder();
      }
    });

    listContainer.addEventListener("dragover", (e) => {
      if (!draggedListLi) return;
      e.preventDefault();
      Array.from(listContainer.children).forEach((el) => el.classList.remove("drop-target"));
      const afterElement = getDragAfterElement(listContainer, e.clientY);
      if (afterElement) afterElement.classList.add("drop-target");
    });

    listContainer.addEventListener("drop", (e) => {
      if (!draggedListLi) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(listContainer, e.clientY);
      Array.from(listContainer.children).forEach((el) => el.classList.remove("drop-target"));
      if (afterElement == null) listContainer.appendChild(draggedListLi);
      else listContainer.insertBefore(draggedListLi, afterElement);
      setTimeout(() => {
        draggedListLi.style.display = "";
        draggedListLi.classList.remove("dragging");
        draggedListLi = null;
      }, 0);
      updateListOrder();
    });
  } else {
      // Touch-Bedienung
    let draggedListLi = null;
    let isTouchDragging = false;

    listContainer.addEventListener("touchstart", (e) => {
      const li = e.target.closest("li");
      if (!li || !li.draggable) return;

      draggedListLi = li;
      isTouchDragging = true;
      li.classList.add("dragging");
    }, { passive: true });

    listContainer.addEventListener("touchmove", (e) => {
      if (!draggedListLi || !isTouchDragging) return;

      e.preventDefault();

      const touchY = e.touches[0].clientY;
      const afterElement = getDragAfterElement(listContainer, touchY);

      if (afterElement !== draggedListLi.nextSibling) {
        if (afterElement == null) {
          listContainer.appendChild(draggedListLi);
        } else {
          listContainer.insertBefore(draggedListLi, afterElement);
        }
      }
    }, { passive: false });

    listContainer.addEventListener("touchend", () => {
      if (draggedListLi) {
        draggedListLi.classList.remove("dragging");
        updateListOrder();
      }
      draggedListLi = null;
      isTouchDragging = false;
    });
  }
}

// Speichert die neue Reihenfolge auf dem Server
function updateListOrder() {
  const serverLists = document.getElementById("serverLists");
  if (!serverLists) return;
  const newOrder = Array.from(serverLists.children).map((li) => {
    const filename = li.dataset.filename;
    return filename ? String(filename) : null;
  }).filter(Boolean);
  changeListOrder(newOrder);
}

// Speichert die neue Listen-Reihenfolge im Backend
function changeListOrder(newOrder) {
  postToBackend({
    action: "change_list_order",
    listOrder: newOrder,
    username: typeof username !== 'undefined' ? username : undefined,
  })
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
      if (!response.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      if (data && data.error) {
        showStatus("Fehler beim Speichern der Listen-Reihenfolge: " + data.error, "error");
      } else {
        showStatus("Listen-Reihenfolge gespeichert", "success");
      }
    })
    .catch((error) => {
      showStatus("Fehler beim Speichern der Listen-Reihenfolge: " + (error && error.message ? error.message : error), "error");
    });
}

// Toggle Reorder-Modus für Listen
let isReorderMode = false;

function toggleReorderMode() {
  isReorderMode = !isReorderMode;
  const serverLists = document.getElementById("serverLists");
  if (!serverLists) return;

  serverLists.querySelectorAll('li').forEach(li => {
    li.draggable = isReorderMode;
    if (isReorderMode) {
      li.classList.add('reorder-mode');
    } else {
      li.classList.remove('reorder-mode');
    }
  });

  // Aktualisiere alle reorderBtn Texte
  document.querySelectorAll('.reorderBtn').forEach(btn => {
    if(isReorderMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (isReorderMode) {
    showStatus('Ziehen Sie die Listen, um die Reihenfolge zu ändern.', 'change');
  } else {
    showStatus('Neu anordnen beendet.', 'change');
  }
}

// ==========================================================
//  List-Übersicht bearbeiten (rename/delete) - showServerLists & editListItem
// ==========================================================
function showServerLists(lists) {
  const ul = document.getElementById("serverLists");
  if (!ul) return;
  ul.innerHTML = "";
  if (!lists.length) {
    // Freundliche Anzeige für Erstbenutzer: Hervorgehobener Eintrag mit Handlungsaufforderung
    ul.innerHTML = `
      <li class="empty-list">
        <div class="empty-list-inner">
          <strong>Noch keine Liste angelegt</strong>
          <div class="empty-list-hint">Erstelle deine erste Liste indem du 'Ich gehe zu ...' ausfüllst und 'Hinzufügen' klickst.</div>
        </div>
      </li>
    `;
    return;
  }

  lists.forEach((list) => {
    const li = document.createElement("li");
    let entryText = "";
    if (list.itemCount === 1) entryText = "1\u00A0Eintrag";
    else if (list.itemCount > 1) entryText = list.itemCount + "\u00A0Einträge";

    if (list.itemCount === 0) li.classList.add("empty");

    const entryFilename = replaceUnderscoresWithSpaces(list.filename.replace('.json', ''));

    // Original-Dateiname als Datenattribut speichern, damit die Reihenfolge später unverändert an den Server geht.
    li.dataset.filename = list.filename;

    // Erzeuge sicheren DOM-Baum statt innerHTML (vermeidet XSS)
    li.innerHTML = ''; // leeren

    const spanItemText = document.createElement('span');
    spanItemText.className = 'itemText';

    const strongName = document.createElement('strong');
    strongName.className = 'listFileName';
    strongName.textContent = entryFilename;
    spanItemText.appendChild(strongName);

    const spanModified = document.createElement('span');
    spanModified.className = 'modified';
  
    //const lastModified = String(list.lastModified || '');
    const lastModified = String(formatTimeAgo(list.lastModified )|| '');
    
    const modText = ' (' + (entryText ? (entryText + ', ' + lastModified) : lastModified) + ')';
    spanModified.textContent = modText;
    spanItemText.appendChild(spanModified);

    const toolsPanelId = 'listToolsPanel-' + replaceSpacesWithUnderscores(String(list.filename || '').replace('.json', ''));

    const toolsPanel = document.createElement('div');
    toolsPanel.className = 'listToolsPanel';
    toolsPanel.id = toolsPanelId;
    toolsPanel.setAttribute('aria-hidden', 'true');

    const toolsToggle = document.createElement('button');
    toolsToggle.className = 'listToolsToggle';
    toolsToggle.type = 'button';
    toolsToggle.title = 'Werkzeuge anzeigen';
    toolsToggle.setAttribute('aria-label', 'Werkzeugpanel öffnen');
    toolsToggle.setAttribute('aria-expanded', 'false');
    toolsToggle.setAttribute('aria-controls', toolsPanelId);

    const shareBtn = document.createElement('button');
    shareBtn.className = 'shareBtn';
    shareBtn.type = 'button';
    if (list.shared) {
      shareBtn.classList.add('shared');
    }

    shareBtn.title = 'Teilen';

    const editBtn = document.createElement('button');
    editBtn.className = 'editBtn';
    editBtn.type = 'button';
    editBtn.title = 'Umbenennen';
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { editListItem(this); } catch (err) { console.error(err); }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'deleteBtn';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Liste löschen';

    const reorderBtn = document.createElement('button');
    reorderBtn.className = 'reorderBtn';
    reorderBtn.type = 'button';
    reorderBtn.title = 'Listen sortieren';

    li.appendChild(spanItemText);
    toolsPanel.appendChild(shareBtn);
    toolsPanel.appendChild(editBtn);
    toolsPanel.appendChild(deleteBtn);
    toolsPanel.appendChild(reorderBtn);
    li.appendChild(toolsPanel);
    li.appendChild(toolsToggle);

    // Teilen-Schaltfläche: Eventlistener ergänzen (verwende Closure für `list`)
    const shareBtnEl = li.querySelector(".shareBtn");
    if (shareBtnEl) {
      shareBtnEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const filenameNoExt = list.filename.replace(".json", "");
        shareListRequest(filenameNoExt, list);
      });
    }
    
    // Klick auf Listennamen: Liste laden / wechseln
    li.querySelector(".itemText").addEventListener("click", function (e) {
      // Navigation nur über Listennamen; Session hält den angemeldeten Benutzer serverseitig.
      window.location.href = "?" + encodeURIComponent(list.filename.replace(".json", ""));
      e.stopPropagation();
    });

    // Schaltfläche zum Löschen
    li.querySelector(".deleteBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      // Öffne das Bestätigungs-Modal (die eigentliche Löschung wird dort ausgeführt)
      openDeleteListModal(list.filename);
    });

    // Schaltfläche zum Neu anordnen
    li.querySelector(".reorderBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleReorderMode();
    });

    toolsToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleListToolsPanel(li);
    });

    li.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && li.classList.contains('tools-open')) {
        closeListToolsPanel(li);
        toolsToggle.focus();
      }
    });

    // Aktiviere Drag & Drop, wenn mehr als eine Liste vorhanden
    if (lists.length > 1) {
      li.draggable = false; // Standardmäßig nicht draggable, wird per Button aktiviert
    }

    if (typeof speiseplanName !== "undefined" && entryFilename == speiseplanName) {
      li.classList.add("speiseplan");
    }

    ul.appendChild(li);
  });


  // Setup Drag & Drop für Listen, wenn mehr als eine Liste
  if (lists.length > 1) {
    setupListDragAndDrop();
  }
}

function closeAllListToolsPanels(exceptLi) {
  document.querySelectorAll('#serverLists li.tools-open').forEach((li) => {
    if (exceptLi && li === exceptLi) return;
    closeListToolsPanel(li);
  });
}

function closeListToolsPanel(li) {
  if (!li) return;
  li.classList.remove('tools-open');
  const toggle = li.querySelector('.listToolsToggle');
  const panel = li.querySelector('.listToolsPanel');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = 'Werkzeuge anzeigen';
    toggle.setAttribute('aria-label', 'Werkzeugpanel öffnen');
  }
  if (panel) panel.setAttribute('aria-hidden', 'true');
}

function openListToolsPanel(li) {
  if (!li) return;
  closeAllListToolsPanels(li);
  li.classList.add('tools-open');
  const toggle = li.querySelector('.listToolsToggle');
  const panel = li.querySelector('.listToolsPanel');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
    toggle.title = 'Werkzeuge ausblenden';
    toggle.setAttribute('aria-label', 'Werkzeugpanel schließen');
  }
  if (panel) panel.setAttribute('aria-hidden', 'false');
}

function toggleListToolsPanel(li) {
  if (!li) return;
  if (li.classList.contains('tools-open')) {
    closeListToolsPanel(li);
    return;
  }
  openListToolsPanel(li);
}

document.addEventListener('click', function (e) {
  const insideOpenList = e.target && e.target.closest ? e.target.closest('#serverLists li.tools-open') : null;
  if (insideOpenList) return;
  closeAllListToolsPanels();
});

  // Öffnet das Bestätigungs-Modal zum Löschen einer Liste
  function openDeleteListModal(filename) {
    const modal = document.getElementById("deleteListModal");
    const filenameNoExt = String(filename || '').replace(/\.json$/i, '');
    if (!modal) {
      // Fallback: falls Modal nicht vorhanden, zuerst mit confirm bestätigen
      const displayNameFallback = replaceUnderscoresWithSpaces(filenameNoExt);
      if (!confirm('Möchten Sie die Liste "' + displayNameFallback + '" wirklich löschen?')) return;
      postToBackend({ action: "delete", filename: filenameNoExt, username: typeof username !== 'undefined' ? username : undefined })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            fetchAllLists(showServerLists, function (error) {
              if (error) showStatus("Fehler beim Laden der Listen: " + (error || data.error), "error");
            });
          } else {
            showStatus("Fehler beim Löschen: " + (data.error || "Unbekannter Fehler"), "error");
          }
        })
        .catch((error) => showStatus("Fehler: " + error, "error"));
      return;
    }

    const displayName = replaceUnderscoresWithSpaces(filenameNoExt);
    const nameEl = document.getElementById("deleteListModalName");
    if (nameEl) nameEl.textContent = displayName;
    modal.dataset.filename = filenameNoExt;

    // Öffne Modal (verwende vorhandene Hilfsfunktion für Fokus)
    try { 
      if (typeof _openModal === 'function') {
        _openModal("deleteListModal", "#confirmDeleteListBtn");
      } else {
        throw new Error('no _openModal');
      }
    } catch (e) { 
      // Falls _openModal nicht verfügbar, zeige das Modal per Inline-Style
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      const confirm = document.getElementById('confirmDeleteListBtn');
      if (confirm) try { confirm.focus(); } catch (e) {}
    }
  }

  // Modal-Buttons: Abbrechen und Bestätigen
  (function () {
    const modalId = 'deleteListModal';
    const cancelBtn = document.getElementById("cancelDeleteListBtn");
    const closeBtn = document.getElementById("closeDeleteList");

    function closeDeleteModalFallback() {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      modal.setAttribute('aria-modal', 'false');
      try { delete modal.dataset.filename; } catch (e) {}
      try {
        if (modal._keydownHandler) {
          document.removeEventListener('keydown', modal._keydownHandler);
          delete modal._keydownHandler;
        }
      } catch (e) {}
      try { modal._previousActive && modal._previousActive.focus && modal._previousActive.focus(); } catch (e) {}
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        if (typeof _closeModal === 'function') _closeModal(modalId);
        else if (closeBtn) closeBtn.click();
        else closeDeleteModalFallback();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (typeof _closeModal === 'function') _closeModal(modalId);
        else closeDeleteModalFallback();
      });
    }

    const confirmBtn = document.getElementById("confirmDeleteListBtn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        const fname = modal.dataset.filename;
        if (!fname) return;
        const btn = this;
        btn.disabled = true;
        postToBackend({ action: "delete", filename: fname, username: typeof username !== 'undefined' ? username : undefined })
          .then((response) => response.json())
          .then((data) => {
            if (data.success) {
              if (typeof _closeModal === 'function') _closeModal(modalId);
              else closeDeleteModalFallback();
              fetchAllLists(showServerLists, function (error) {
                if (error) showStatus("Fehler beim Laden der Listen: " + (error || data.error), "error");
              });
            } else {
              showStatus("Fehler beim Löschen: " + (data.error || "Unbekannter Fehler"), "error");
            }
          })
          .catch((error) => showStatus("Fehler: " + error, "error"))
          .finally(() => { btn.disabled = false; });
      });
    }
  })();

// --- Speiseplan-Verlauf: öffnen, schließen und laden ---
function fetchSpeiseplanHistory() {
  const container = document.getElementById('itemListSpeiseplan');
  if (!container) {
    showStatus('Speiseplan-Container nicht gefunden.', 'error');
    return;
  }
  postToBackend({ action: 'speiseplan_history' })
    .then(r => r.json ? r.json() : r)
    .then((res) => {
      if (!res || !res.success) {
        showStatus('Fehler beim Laden des Speiseplanverlaufs.', 'error');
        return;
      }
      const items = res.history || [];
      if (items.length === 0) {
        showStatus('Keine Einträge im Speiseplanverlaufs gefunden.', 'change');
        return;
      }
      const itemListSpeiseplan = document.getElementById("itemListSpeiseplan");

      // Leere vorhandene Inhalte und füge für jeden Eintrag ein <li> hinzu
      try { itemListSpeiseplan.innerHTML = ''; } catch (e) {}
      for (const it of items) {
        const w = it.weekday || '';
        const d = it.date || '';
        const t = it.text || '';
        const li = document.createElement('li');
        const span = document.createElement('span');
        const strong = document.createElement('strong');
        span.textContent = d;
        strong.textContent = w;
        if (w === 'Sa.' || w === 'So.') {
          li.classList.add('weekend');
        }
        // Speise-Text als Dataset speichern für einfachen Vergleich
        li.dataset.speiseText = String(t || '').trim();

        li.appendChild(strong);
        li.appendChild(span);
        li.appendChild(document.createTextNode(t));

        // Klick auf einen Eintrag: gleiche Texte markieren / entmarkieren
        li.addEventListener('click', function (e) {
          try {
            const containerEl = document.getElementById('itemListSpeiseplan');
            if (!containerEl) return;

            const isCurrentlyMarked = this.classList.contains('speiseplan-marked');

            // Entferne Markierungen und Inline-Styles von allen Einträgen
            Array.from(containerEl.querySelectorAll('li')).forEach((el) => {
              el.classList.remove('speiseplan-marked');
              try { el.style.backgroundColor = ''; } catch (e) {}
            });

            // Falls der angeklickte Eintrag vorher nicht markiert war, markiere alle mit gleichem Text
            if (!isCurrentlyMarked) {
              const text = (this.dataset.speiseText || '').trim();
              Array.from(containerEl.querySelectorAll('li')).forEach((el) => {
                if ((el.dataset.speiseText || '').trim() === text) {
                  el.classList.add('speiseplan-marked');
                }
              });
            }
          } catch (err) {
            console.error('Fehler beim Markieren gleicher Speiseplan-Einträge:', err);
          }
        });
        itemListSpeiseplan.appendChild(li);
      }

      // Benutze vorhandenen Zurück-Button aus index.php
      const backBtn = document.getElementById('speiseplanbackBtn');
      if (backBtn && !backBtn._speiseplanBound) {
        backBtn.addEventListener('click', () => closeSpeiseplanHistory());
        backBtn._speiseplanBound = true;
      }

    })
    .catch((err) => { showStatus('Fehler beim Laden des Speiseplanverlaufs.', 'error'); console.error(err); });
}

function openSpeiseplanHistory() {
  const container = document.getElementById('listSpeiseplanHistory');
  if (!container) return;
  try { if (typeof closeMoreMenu === 'function') closeMoreMenu(); } catch (e) {}
  try {
    const lo = document.getElementById('listOverview');
    if (lo && lo.style && lo.style.setProperty) lo.style.setProperty('display', 'none', 'important');
  } catch (e) {}
  try { const le = document.getElementById('listElements'); if (le && le.style) le.style.display = 'none'; } catch (e) {}
  try { const lg = document.getElementById('login'); if (lg && lg.style) lg.style.display = 'none'; } catch (e) {}

  try { container.style.display = ''; } catch (e) {}
  fetchSpeiseplanHistory();
}

function closeSpeiseplanHistory() {
  const container = document.getElementById('listSpeiseplanHistory');
  if (!container) return;
  container.style.display = 'none';
  try { const lo = document.getElementById('listOverview'); if (lo && lo.style && lo.style.removeProperty) lo.style.removeProperty('display'); } catch (e) {}
}

function editListItem(button) {
  const li = button.closest("li");
  const span = li.querySelector(".listFileName");
  const spanitemText = li.querySelector(".itemText");
  const oldText = span.textContent;

  if (button.classList.contains('editing')) {
    const existingInput = li.querySelector('.editInput');
    if (existingInput) {
      finishEdit();
    }
    return;
  }

  li.dataset.editing = "true";

  // Clone the button to remove old click handlers
  const newBtn = button.cloneNode(true);
  button.parentElement.replaceChild(newBtn, button);
  button = newBtn; // update reference

  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  // Set editing state and allow the button to act as a "save/check" while editing
  button.classList.add('editing');
  button.disabled = false;
  li.insertBefore(input, spanitemText);
  spanitemText.style.display = "none";
  input.focus();

  // Während der Bearbeitung: Klick auf die gleiche Schaltfläche speichert (wie bei editItem)
  function _buttonSaveHandler(e) {
    e.stopPropagation();
    if (!li.dataset.editing) return;
    li._buttonClicked = true;
    try { finishEdit(); } catch (err) { console.error(err); }
  }
  button._saveHandler = _buttonSaveHandler;
  button.addEventListener('click', button._saveHandler);

  const tempHandler = function (e) {
    if (!li.dataset.editing) return;
    if (input.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
  };

  li.addEventListener("click", tempHandler, { capture: true });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") finishEdit();
    if (e.key === "Escape") cancelEdit();
  });

  input.addEventListener("blur", function () {
    setTimeout(() => {
      if (li._buttonClicked) {
        delete li._buttonClicked;
        return;
      }
      if (
        li.dataset.editing &&
        (!li.contains(document.activeElement) || document.activeElement.tagName === "BUTTON")
      ) {
        finishEdit();
      }
    }, 10);
  });

  function finishEdit() {
    if (!li.dataset.editing || li._finishing) return;
    li._finishing = true;
    const newText = input.value.trim();
    if (newText && newText !== oldText) {
      const newFilename = replaceSpacesWithUnderscores(newText);
      postToBackend({
        action: "rename",
        oldFilename: replaceSpacesWithUnderscores(oldText),
        newFilename: newFilename,
        username: typeof username !== 'undefined' ? username : undefined,
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            span.textContent = newText;
          } else {
            showStatus(`Fehler: ${data.error || "Unbekannter Fehler"}`, "error");
          }
          cleanup();
          fetchAllLists(showServerLists, function (error) {
            showStatus("Fehler beim Laden der Listen: " + error, "error");
          });
        })
        .catch((error) => {
          showStatus(`Fehler: ${error}`, "error");
          cleanup();
        });
    } else {
      cleanup();
    }
  }

  function cancelEdit() {
    if (!li.dataset.editing) return;
    cleanup();
  }

  function cleanup() {
    delete li.dataset.editing;
    delete li._finishing;
    delete li._buttonClicked;
    li.removeEventListener("click", tempHandler, { capture: true });
    if (input.parentElement === li) li.removeChild(input);
    spanitemText.style.display = "";

    // Entferne den temporären Save-Handler
    try {
      if (button && button._saveHandler) {
        button.removeEventListener('click', button._saveHandler);
        delete button._saveHandler;
      }
    } catch (e) { console.error(e); }

    try {
      if (touchscreen && button && button.parentElement) {
        const newBtn = button.cloneNode(true);
        newBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          try { editListItem(this); } catch (err) { console.error(err); }
        });
        button.parentElement.replaceChild(newBtn, button);
        newBtn.classList.remove('editing');
        newBtn.disabled = false;
        newBtn.blur && newBtn.blur();
        setTimeout(() => newBtn.blur && newBtn.blur(), 10);
      } else {
        button.classList.remove('editing');
        button.disabled = false;
        button.blur && button.blur();
      }
    } catch (e) {
      try { button.classList.remove('editing'); } catch (e) {}
      try { button.disabled = false; } catch (e) {}
      try { button.blur && button.blur(); } catch (e) {}
    }
  }
}

// ==========================================================
function addListItem() {
  const input = document.getElementById("newListItem");
  const text = replaceSpacesWithUnderscores(input?.value.trim() || "");
  if (!text) return;

  postToBackend({ action: "create", filename: text, username: typeof username !== 'undefined' ? username : undefined })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        if (input) input.value = "";
        fetchAllLists(showServerLists, function (error) {
          showStatus("Fehler beim Laden der Listen: " + error, "error");
        });
      } else {
        showStatus("Fehler: " + (data.error || "Unbekannter Fehler"), "error");
      }
    })
    .catch((error) => {
      showStatus("Fehler beim Hinzufügen: " + error, "error");
    });
}

// ==========================================================
