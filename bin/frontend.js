// ==========================================================
//  Hilfsfunktionen & Konstanten
// ==========================================================
const touchscreen = window.matchMedia("(pointer: coarse)").matches;

function showStatus(message, type) {
  const statusDiv = document.getElementById("status");
  if (!statusDiv) return;
  statusDiv.textContent = message;
  statusDiv.className = "status " + (type || "");
  try {
    statusDiv.setAttribute('role', 'status');
    statusDiv.tabIndex = 0;

    // Falls bereits ein Timer vorhanden ist (ältere Meldung), räume auf
    try {
      if (statusDiv._dismissTimer) {
        clearTimeout(statusDiv._dismissTimer);
        delete statusDiv._dismissTimer;
      }
    } catch (e) {
      // ignorieren
    }

    const clear = () => {
      // Timer entfernen falls gesetzt
      try {
        if (statusDiv._dismissTimer) {
          clearTimeout(statusDiv._dismissTimer);
          delete statusDiv._dismissTimer;
        }
      } catch (e) {}
      statusDiv.textContent = "";
      statusDiv.className = "status";
      statusDiv.removeAttribute('role');
      statusDiv.removeAttribute('tabindex');
      statusDiv.onclick = null;
      statusDiv.onkeydown = null;
    };

    statusDiv.onclick = clear;
    statusDiv.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') clear();
    };

    // Verhalten: Fehler (`error`) bleiben stehen; Änderungen (`change`) verschwinden nach 10s
    if (type === 'change') {
      statusDiv._dismissTimer = setTimeout(clear, 10000);
    }
  } catch (e) {
    // Falls der Browser gewisse Eigenschaften nicht unterstützt, stillschweigend ignorieren
  }
}

function replaceSpacesWithUnderscores(text) {
  return text.replace(/\s+/g, "_").replaceAll("/", "~");
}
function replaceUnderscoresWithSpaces(text) {
  return text.replace(/_/g, " ").replaceAll("~", "/");
}

function getFilenameFromUrl() {
  const search = window.location.search;
  if (!search || search === "?") return "";

  const skip = new Set(['user', 'token', 'share', 'download','invite']);

  try {
    const params = new URLSearchParams(search);
    for (const [key] of params.entries()) {
      const decodedKey = decodeURIComponent(key || '');
      if (!decodedKey) continue;
      if (skip.has(decodedKey)) continue;
      return decodedKey;
    }
  } catch (e) {
    // Falls URLSearchParams aus irgendeinem Grund fehlschlägt, versuchen wir Fallback-Parsing
  }

  // Fallback: gesamte rohe Query zurückgeben (ohne führendes '?'), damit alte URLs
  // wie "?liste" oder spezielle Fälle weiterhin funktionieren.
  const raw = search.substring(1);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

function setupEnterKeyListener(elementId, callback) {
  const element = document.getElementById(elementId);
  if (element) {
    element.addEventListener("keypress", function (e) {
      if (e.key === "Enter") callback();
    });
  } else {
    console.warn(`Element mit der ID "${elementId}" nicht gefunden.`);
  }
}

// ==========================================================
//  Server-Interaktionen (save/load/list)
 // ==========================================================
function saveListToServer(filename, activeItems, inactiveItems, onSuccess, onError) {
  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save",
      filename,
      active: activeItems,
      inactive: inactiveItems,
        username: typeof username !== 'undefined' ? username : undefined,
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) onSuccess?.(data);
      else onError?.(data.error || "Unbekannter Fehler");
    })
    .catch((error) => onError?.(error));
}

function fetchAllLists(onSuccess, onError) {
  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list", username: typeof username !== 'undefined' ? username : undefined }),
  })
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
      if (Array.isArray(data)) onSuccess?.(data);
      else onError?.(data && (data.error || data.message) ? (data.error || data.message) : "Antwortformat ungültig");
    })
    .catch((error) => onError?.(error.message || error));
}

function loadList() {
  let filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load", id: filename, username: typeof username !== 'undefined' ? username : undefined }),
  })
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
      _currentListShared = !!(payload && payload.shared);

      if (Array.isArray(payload.active)) {
        payload.active.forEach((item) => ulActive.appendChild(createActiveItem(item)));
      }
      if (Array.isArray(payload.inactive)) {
        payload.inactive.forEach((item) => ulInactive.appendChild(createInactiveItem(item)));
        sortInactiveList();
      }

      // Periodische Synchronisation: nur für geteilte Listen starten
      try {
        if (_currentListShared) {
          startPeriodicSync(filename);
        } else {
          // Sicherstellen, dass kein Sync läuft für lokale/privat Listen
          stopPeriodicSync();
        }
      } catch (e) {
        console.warn("Konnte Periodic Sync nicht starten/stoppen:", e);
      }
    })
    .catch((error) => {
      showStatus("Fehler: " + error.message, "error");
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

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
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

  fetch('bin/backend.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'shared', share: token, username: typeof username !== 'undefined' ? username : undefined }),
  })
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

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync", filename, active: activeItems, inactive: inactiveItems, username: typeof username !== 'undefined' ? username : undefined }),
  })
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
//  Auth (register / login)
// ==========================================================
function register() {
  const passCode = document.getElementById("passCode")?.value.trim();
  if (!passCode) {
    showStatus("Bitte Passwort eingeben.", "error");
    return;
  }

  const regUsername = document.getElementById('registerUsername')?.value?.trim();
  const regEmail = document.getElementById('registerEmail')?.value?.trim();
  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "register",
      password: passCode,
      username: regUsername || undefined,
      email: regEmail || undefined,
      invite: (typeof inviteToken !== 'undefined' && inviteToken)
        ? inviteToken
        : (document.getElementById('inviteInput')?.value?.trim() || undefined),
    }),
  })
    .then(async (response) => {
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        console.error('Ungültige JSON-Antwort vom Server beim Register:', e, response);
        throw { status: response.status, message: 'Ungültige Serverantwort' };
      }
      if (!response.ok) {
        console.error('Register fehlgeschlagen, Server-Response:', response.status, data);
        throw { status: response.status, message: data.error || data.message || JSON.stringify(data) };
      }
      return data;
    })
    .then((data) => {
      if (data.success) {
        //alert('Registrierung erfolgreich! Du wirst nun eingeloggt.');
        window.location.href = window.location.pathname;
      } else {
        console.error('Register returned success=false:', data);
        showStatus(data.error || data.message || JSON.stringify(data) || 'Falsches Passwort.', 'error');
      }
    })
    .catch((error) => {
      console.error('Fehler bei Register:', error);
      showStatus(error.message || error || 'Fehler beim Registrieren', 'error');
    });
}

function login() {
  const passCode = document.getElementById("passCode")?.value.trim();
  if (!passCode) {
    showStatus("Bitte Passwort eingeben.", "error");
    return;
  }

  const inputUsername = document.getElementById('loginUsername')?.value?.trim();
  const payloadUsername = inputUsername && inputUsername.length ? inputUsername : (typeof username !== 'undefined' ? username : undefined);

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", password: passCode, username: payloadUsername }),
  })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok) throw { status: response.status, message: data.error || "Unbekannter Serverfehler" };
        return data;
      })
    )
    .then((data) => {
      if (data.success) {
        document.getElementById("login").style.display = "none";
        document.getElementById("listElements").style.display = "none";
        document.getElementById("listOverview").style.display = "";
        
        // Benutzerüberschrift wird serverseitig gesetzt; kein JS nötig.

        setTimeout(() => {
          fetchAllLists(showServerLists, (error) => showStatus("Fehler beim Laden der Listen: " + error, "error"));
        }, 100);
      } else {
        showStatus(data.message || "Falsches Passwort.", "error");
      }
    })
    .catch((error) => showStatus(error.message || "Fehler beim Login: " + error, "error"));
}

// ==========================================================
//  Element-Erzeugung (active / inactive)
// ==========================================================
function createActiveItem(text) {
  const li = document.createElement("li");
  // Erzeuge Elemente sicher (vermeide innerHTML mit nicht vertrauenswürdigen Inhalten)
  const dragHandle = document.createElement('span');
  dragHandle.className = 'dragHandle';
  dragHandle.title = 'Verschieben';
  dragHandle.setAttribute('draggable', 'true');

  const spanText = document.createElement('span');
  spanText.className = 'itemText';
  spanText.textContent = String(text ?? '');

  const editBtn = document.createElement('button');
  editBtn.className = 'editBtn';
  editBtn.title = 'Umbenennen';
  editBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    try { editItem(this); } catch (err) { console.error(err); }
  });

  li.appendChild(dragHandle);
  li.appendChild(spanText);
  li.appendChild(editBtn);
  // Markiere Items, die mit '!' enden, weiterhin mit einer CSS-Klasse
  try {
    const trimmed = String(text || '').trim();
    if (trimmed.endsWith('!')) li.classList.add('has-exclamation');
    if (trimmed.endsWith('?')) li.classList.add('has-question');
  } catch (e) { /* ignorieren */ }

  function updateDraggableState() {
    const itemList = document.getElementById("itemList");
    const itemCount = itemList ? itemList.children.length : 0;
    const handle = li.querySelector(".dragHandle");
    if (itemCount > 1 && !touchscreen) {
      li.draggable = true;
      if (handle) handle.style.cursor = "grab";
    } else {
      li.draggable = false;
      if (handle) handle.style.cursor = "default";
    }
  }

  setTimeout(updateDraggableState, 0);

  const observerTarget = document.getElementById("itemList");
  if (observerTarget) {
    const observer = new MutationObserver(updateDraggableState);
    observer.observe(observerTarget, { childList: true });
    li._observer = observer;
  }

  li.addEventListener("click", function (e) {
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
    moveToInactive(li);
  });

  // optional: markiere speiseplan
  if (typeof speiseplanName !== "undefined" && getFilenameFromUrl() === speiseplanName) {
    li.classList.add("speiseplan");
  }

  return li;
}

function createInactiveItem(text) {
  const li = document.createElement('li');

  const spanText = document.createElement('span');
  spanText.className = 'itemText';
  spanText.textContent = String(text ?? '');

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'deleteBtn';
  deleteBtn.title = 'Löschen';
  deleteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    try { deleteInactiveItem(this); } catch (err) { console.error(err); }
  });

  li.appendChild(spanText);
  li.appendChild(deleteBtn);

  li.addEventListener('click', function (e) {
    if (e.target.classList.contains('deleteBtn') || e.target.closest('button')) return;
    moveToActive(li);
  });

  return li;
}

// ==========================================================
//  Suche / Dropdown für neues Item (setupItemSearch)
// ==========================================================
function setupItemSearch() {
  const input = document.getElementById("newItem");
  if (!input) return;

  let dropdown = document.getElementById("itemSearchDropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.id = "itemSearchDropdown";
    dropdown.className = "search-dropdown";
    input.parentElement.appendChild(dropdown);
  }

  function positionDropdown() {
    dropdown.style.left = input.offsetLeft + "px";
    dropdown.style.top = input.offsetTop + input.offsetHeight + "px";
    dropdown.style.width = input.offsetWidth + "px";
  }

  input.addEventListener("input", function () {
    const searchText = input.value.trim().toLowerCase();
    positionDropdown();
    dropdown.innerHTML = "";

    if (searchText.length < 2) {
      dropdown.style.display = "none";
      return;
    }

    const activeLis = Array.from(document.querySelectorAll("#itemList li"));
    const inactiveLis = Array.from(document.querySelectorAll("#inactiveList li"));

    const activeItems = activeLis.map((li) => li.querySelector(".itemText").textContent.trim());
    const inactiveItems = inactiveLis.map((li) => li.querySelector(".itemText").textContent.trim());

    const allItems = [...new Set([...activeItems, ...inactiveItems])];
    const foundItems = allItems.filter((item) => item.toLowerCase().includes(searchText));

    if (foundItems.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    // ✨ Aufleuchten für aktive Treffer
    activeLis.forEach((li) => {
      const text = li.querySelector(".itemText").textContent.trim().toLowerCase();
      if (foundItems.some((item) => item.toLowerCase() === text)) {
        li.classList.add("flash");
        li.addEventListener("animationend", () => li.classList.remove("flash"), { once: true });
      }
    });

    foundItems.forEach((item) => {
      const option = document.createElement("div");
      option.textContent = item;
      option.className = "dropdown-option";

      option.addEventListener("mousedown", function (e) {
        e.preventDefault();
        input.value = item;
        dropdown.style.display = "none";

        // Wenn inaktiv vorhanden → aktivieren
        if (inactiveItems.includes(item)) {
          const li = inactiveLis.find((li) => li.querySelector(".itemText").textContent.trim() === item);
          if (li) {
            moveToActive(li);
            input.value = "";
          }
        }
      });

      dropdown.appendChild(option);
    });

    dropdown.style.display = "block";
  });

  // optional: bei Resize/Scroll die Position anpassen
  window.addEventListener("resize", positionDropdown);
  window.addEventListener("scroll", positionDropdown);
}

// ==========================================================
//  Drag & Drop (Maus & Touch) + Hilfsfunktion getDragAfterElement
// ==========================================================
let draggedLi = null;

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll("li:not(.dragging)")];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

function setupDragAndDrop() {
  const itemList = document.getElementById("itemList");
  if (!itemList) return;

  if (!touchscreen) {
    // Mausbedienung
    itemList.addEventListener("dragstart", (e) => {
      const handle = e.target.closest(".dragHandle");
      const li = e.target.closest("li");
      if (handle && li && e.target.classList.contains("dragHandle")) {
        draggedLi = li;
        draggedLi.classList.add("dragging");
        // Drag-Vorschau
        try {
          e.dataTransfer.setDragImage(li, li.offsetWidth / 2, li.offsetHeight / 2);
        } catch (err) {
          // einige Browser schränken setDragImage ein
        }
        setTimeout(() => (draggedLi.style.display = "none"), 0);
      } else {
        e.preventDefault();
      }
    });

    itemList.addEventListener("dragend", () => {
      if (draggedLi) {
        setTimeout(() => {
          draggedLi.style.display = "";
          draggedLi.classList.remove("dragging");
          draggedLi = null;
        }, 0);
        updateActiveOrder();
      }
    });

    itemList.addEventListener("dragover", (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      Array.from(itemList.children).forEach((el) => el.classList.remove("drop-target"));
      const afterElement = getDragAfterElement(itemList, e.clientY);
      if (afterElement) afterElement.classList.add("drop-target");
    });

    itemList.addEventListener("drop", (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(itemList, e.clientY);
      Array.from(itemList.children).forEach((el) => el.classList.remove("drop-target"));
      if (afterElement == null) itemList.appendChild(draggedLi);
      else itemList.insertBefore(draggedLi, afterElement);
      setTimeout(() => {
        draggedLi.style.display = "";
        draggedLi.classList.remove("dragging");
        draggedLi = null;
      }, 0);
      updateActiveOrder();
    });
  } else {
    // Touch-Bedienung
    let touchStartY = 0;
    let isDragging = false;
    let dragStartTimeout = null;

    itemList.addEventListener(
      "touchstart",
      (e) => {
        const handle = e.target.closest(".dragHandle");
        const li = e.target.closest("li");
        if (li && handle) {
          e.preventDefault();
          draggedLi = li;
          touchStartY = e.touches[0].clientY;
          dragStartTimeout = setTimeout(() => {
            isDragging = true;
            if (draggedLi) draggedLi.classList.add("dragging");
          }, 100);
        }
      },
      { passive: false }
    );

    itemList.addEventListener(
      "touchmove",
      (e) => {
        if (!isDragging || !draggedLi) return;
        e.preventDefault();
        const touchY = e.touches[0].clientY;
        if (Math.abs(touchY - touchStartY) < 10) return;
        if (dragStartTimeout) {
          clearTimeout(dragStartTimeout);
          dragStartTimeout = null;
        }
        const afterElement = getDragAfterElement(itemList, touchY);
        if (afterElement == null) itemList.appendChild(draggedLi);
        else itemList.insertBefore(draggedLi, afterElement);
      },
      { passive: false }
    );

    itemList.addEventListener("touchend", (e) => {
      if (dragStartTimeout) {
        clearTimeout(dragStartTimeout);
        dragStartTimeout = null;
      }
      if (draggedLi && isDragging) {
        draggedLi.classList.remove("dragging");
        updateActiveOrder();
      }
      isDragging = false;
      draggedLi = null;
    });

    itemList.addEventListener("touchcancel", (e) => {
      if (dragStartTimeout) {
        clearTimeout(dragStartTimeout);
        dragStartTimeout = null;
      }
      if (draggedLi) draggedLi.classList.remove("dragging");
      isDragging = false;
      draggedLi = null;
    });
  }
}

// Speichert die neue Reihenfolge auf dem Server
function updateActiveOrder() {
  const filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((li) =>
    li.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((li) =>
    li.querySelector(".itemText").textContent.trim()
  );

  saveListToServer(
    filename,
    activeItems,
    inactiveItems,
    function () {
      // keine Aktion bei Erfolg
    },
    function (error) {
      showStatus("Fehler beim Speichern der Reihenfolge: " + error, "error");
    }
  );
}

// ==========================================================
//  Verschieben, löschen, sortieren (moveToInactive/Active, deleteInactiveItem, sortInactiveList)
// ==========================================================
function sortInactiveList() {
  const ul = document.getElementById("inactiveList");
  if (!ul) return;
  const items = Array.from(ul.children);
  items.sort((a, b) => {
    const ta = a.querySelector(".itemText").textContent.trim().toLowerCase();
    const tb = b.querySelector(".itemText").textContent.trim().toLowerCase();
    return ta.localeCompare(tb, "de");
  });
  items.forEach((li) => ul.appendChild(li));
}

function moveToInactive(li) {
  if (!li) return;
  // Verhindere Doppelaufrufe, wenn bereits ein Pending-Timer existiert
  if (li._undoTimer) return;

  const text = li.querySelector(".itemText").textContent.trim();
  // Entferne abschließendes '!' oder '?' wenn das Item inaktiv wird
  const stripped = String(text).replace(/[!?]+$/, '').trim();

  // UI: Zeige Rückgängig-Schaltfläche am aktiven Element und markiere als "pending"
  const undoBtn = document.createElement("button");
  undoBtn.className = "undoBtn";
  undoBtn.title = "Rückgängig";
  undoBtn.textContent = "Rückgängig";
  // Stoppe weitere Click-Propagation (verhindert erneutes Auslösen)
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  li.appendChild(undoBtn);
  li.classList.add("pending-active");

  // Bereite die neuen Arrays für die spätere Speicherung vor (Item gilt als entfernt)
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );

  const newActiveItems = activeItems.filter((item) => item !== text);
  const newInactiveItems = [...new Set([...inactiveItems, stripped])];

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  // Timer: nach 5 Sekunden tatsächlich auf dem Server speichern und Element verschieben
  li._undoTimer = setTimeout(() => {
    // Entferne visuelle Pending-Markierung bevor Save (UI-Feedback)
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);

    saveListToServer(
      filename,
      newActiveItems,
      newInactiveItems,
      function () {
        // Beim Erfolg: aktives li entfernen (falls noch vorhanden) und inaktives Element anfügen
        if (li.parentElement) li.parentElement.removeChild(li);
        const finalLi = createInactiveItem(stripped);
        document.getElementById("inactiveList")?.appendChild(finalLi);
        sortInactiveList();
        updateActiveOrder();
      },
      function (error) {
        // Bei Fehler: Benutzer informieren und aktives Element wiederherstellen / belassen
        showStatus(`Fehler: ${error}`, "error");
        // Falls Element bereits entfernt wurde, füge ein neues Active-Element hinzu
        if (!document.querySelector(`#itemList li .itemText`) || !Array.from(document.querySelectorAll("#itemList li")).some(l => l.querySelector(".itemText").textContent.trim() === text)) {
          const restoredLi = createActiveItem(text);
          document.getElementById("itemList")?.prepend(restoredLi);
        } else {
          // Falls das ursprüngliche Element noch vorhanden ist: entferne pending-Markierung und die Schaltfläche
          if (li) {
            li.classList.remove("pending-active");
            if (undoBtn.parentElement === li) li.removeChild(undoBtn);
          }
        }
        sortInactiveList();
        updateActiveOrder();
      }
    );

    delete li._undoTimer;
  }, 5000);

  // Rückgängig-Handler: innerhalb der 5s Rückgängig machen (kein Server-Call)
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (li._undoTimer) {
      clearTimeout(li._undoTimer);
      delete li._undoTimer;
    }
    // Entferne UI-Pending-Markierung und die Rückgängig-Schaltfläche
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);
    // Keine Server-Änderung nötig — Reihenfolge ggf. neu speichern
    updateActiveOrder();
  });
}

function moveToActive(li) {
  if (!li) return;
  const text = li.querySelector(".itemText").textContent.trim();
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);
  const newActiveItems = [...activeItems, text];

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  saveListToServer(
    filename,
    newActiveItems,
    newInactiveItems,
    function () {
      const activeLi = createActiveItem(text);
      document.getElementById("itemList")?.prepend(activeLi);
      if (li.parentElement) li.parentElement.removeChild(li);
      sortInactiveList();
    },
    function (error) {
      showStatus(`Fehler: ${error}`, "error");
    }
  );
}


function deleteInactiveItem(button) {
  const li = button?.parentElement;
  if (!li) return;
  // Verhindere Doppelaufrufe, wenn bereits ein Pending-Timer existiert
  if (li._undoTimer) return;

  const text = li.querySelector(".itemText").textContent.trim();

  // UI: Zeige Rückgängig-Schaltfläche am inaktiven Element und markiere als "pending"
  const undoBtn = document.createElement("button");
  undoBtn.className = "undoBtn";
  undoBtn.title = "Rückgängig";
  undoBtn.textContent = "Rückgängig";
  // Stoppe weitere Click-Propagation
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  li.appendChild(undoBtn);
  li.classList.add("pending-active");

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);

  // Timer: nach 5 Sekunden tatsächlich auf dem Server löschen
  li._undoTimer = setTimeout(() => {
    // Entferne visuelle Pending-Markierung bevor Save
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);

    saveListToServer(
      filename,
      activeItems,
      newInactiveItems,
      function () {
        // Erfolg: inaktives li entfernen
        if (li.parentElement) li.parentElement.removeChild(li);
        sortInactiveList();
        updateActiveOrder();
      },
      function (error) {
        // Fehler: Benutzer informieren und inaktives Element wiederherstellen / belassen
        showStatus(`Fehler: ${error}`, "error");
        // Falls Element nicht mehr vorhanden ist, füge ein neues hinzu
        if (
          !document.querySelector(`#inactiveList li .itemText`) ||
          !Array.from(document.querySelectorAll("#inactiveList li")).some(
            (l) => l.querySelector(".itemText").textContent.trim() === text
          )
        ) {
          const restoredLi = createInactiveItem(text);
          document.getElementById("inactiveList")?.appendChild(restoredLi);
        } else {
          if (li) {
            li.classList.remove("pending-active");
            if (undoBtn.parentElement === li) li.removeChild(undoBtn);
          }
        }
        sortInactiveList();
        updateActiveOrder();
      }
    );

    delete li._undoTimer;
  }, 5000);

  // Rückgängig-Handler: innerhalb der 5s Rückgängig machen (kein Server-Call)
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (li._undoTimer) {
      clearTimeout(li._undoTimer);
      delete li._undoTimer;
    }
    // Entferne UI-Pending-Markierung und die Rückgängig-Schaltfläche
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);
    // Keine Server-Änderung nötig
    sortInactiveList();
    updateActiveOrder();
  });
}

// ==========================================================
//  Item-Bearbeitung (editItem) für aktive Items
// ==========================================================
function editItem(button) {
  const li = button.parentElement;
  const span = li.querySelector(".itemText");
  const oldText = span.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  button.classList.add("editing");
  button.disabled = true;
  li.insertBefore(input, span);
  span.style.display = "none";
  input.focus();

  // Originaler Move-Handler (falls vorhanden) temporär entfernen
  const originalMoveHandler = li._moveHandler;
  if (originalMoveHandler) li.removeEventListener("click", originalMoveHandler);

  const tempHandler = function (e) {
    if (input.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
  };
  li.addEventListener("click", tempHandler, { capture: true });

  let blurTimer = null;

  function cleanup() {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    span.style.display = "";
    if (li.contains(input)) li.removeChild(input);
    li.removeEventListener("click", tempHandler, { capture: true });
    if (originalMoveHandler) li.addEventListener("click", originalMoveHandler);
    // Auf Touch-Geräten kann die Schaltfläche nach Tap einen visuellen Hover-/Active-Zustand behalten.
    // Ersetze die Schaltfläche durch einen geklonten Knoten, um diesen Zustand zuverlässig zu entfernen.
    try {
      if (touchscreen && button && button.parentElement) {
        const newBtn = button.cloneNode(true);
        // Stelle sicher, dass der Klick-Handler wieder angebracht wird (cloneNode kopiert keine Listener)
        newBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          try { editItem(this); } catch (err) { console.error(err); }
        });
        button.parentElement.replaceChild(newBtn, button);
        // Entferne mögliche Klassennamen / Fokus von der neuen Schaltfläche
        newBtn.classList.remove("editing");
        newBtn.disabled = false;
        newBtn.blur && newBtn.blur();
        // kleiner Delay, damit mobile Browser den Active/Hover-Render aktualisieren
        setTimeout(() => newBtn.blur && newBtn.blur(), 10);
      } else {
        button.disabled = false;
        button.classList.remove("editing");
        button.blur && button.blur();
      }
    } catch (e) {
      // Falls etwas schiefgeht, wenigstens die ursprünglichen Einstellungen zurücksetzen
      try { button.disabled = false; } catch (e) {}
      try { button.classList.remove("editing"); } catch (e) {}
      try { button.blur && button.blur(); } catch (e) {}
    }
  }

  function saveInput(el) {
    if (!el || el._saving) return;
    el._saving = true;

    const newText = el.value.trim();
    if (!newText || newText === oldText) {
      delete el._saving;
      cleanup();
      return;
    }

    const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((itemLi) =>
      itemLi === li ? newText : itemLi.querySelector(".itemText").textContent.trim()
    );
    const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
      l.querySelector(".itemText").textContent.trim()
    );

    let filename = document.getElementById("filename")?.value.trim();
    if (!filename) filename = getFilenameFromUrl() || "liste";

    saveListToServer(
      filename,
      activeItems,
      inactiveItems,
      function () {
          try {
            const nt = String(newText || '').trim();
            span.textContent = nt;
            try {
              if (nt.endsWith('!')) li.classList.add('has-exclamation');
              else li.classList.remove('has-exclamation');
              if (nt.endsWith('?')) li.classList.add('has-question');
              else li.classList.remove('has-question');
            } catch (e) { /* ignorieren */ }
          } catch (e) {
            span.textContent = newText;
          }
      },
      function (error) {
        showStatus(`Fehler: ${error}`, "error");
      }
    );

    setTimeout(() => {
      delete el._saving;
      cleanup();
    }, 0);
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveInput(input);
    }
    if (e.key === "Escape") {
      cleanup();
    }
  });

  input.addEventListener("blur", function () {
    blurTimer = setTimeout(function () {
      saveInput(input);
    }, 150);
  });
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
    // Sicherstellen, dass vom Server HTML-kodierte geschützte Leerzeichen
    // in echte NBSP-Zeichen konvertiert werden, damit die Anzeige korrekt ist
    const lastModifiedRaw = String(list.lastModified || '');
    const lastModified = lastModifiedRaw.replace(/&nbsp;/g, '\u00A0');
    const modText = ' (' + (entryText ? (entryText + ', ' + lastModified) : lastModified) + ')';
    spanModified.textContent = modText;
    spanItemText.appendChild(spanModified);

    const shareBtn = document.createElement('button');
    shareBtn.className = 'shareBtn';
    if (list.shared) {
      shareBtn.classList.add('shared');
    }

    shareBtn.title = 'Teilen';

    const editBtn = document.createElement('button');
    editBtn.className = 'editBtn';
    editBtn.title = 'Umbenennen';
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { editListItem(this); } catch (err) { console.error(err); }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'deleteBtn';
    deleteBtn.title = 'Liste löschen';

    li.appendChild(spanItemText);
    li.appendChild(shareBtn);
    li.appendChild(editBtn);
    li.appendChild(deleteBtn);

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
      if (!confirm("Möchten Sie die Liste wirklich löschen?")) return;
      fetch("bin/backend.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", filename: list.filename.replace(".json", ""), username: typeof username !== 'undefined' ? username : undefined }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            li.parentElement?.removeChild(li);
            fetchAllLists(showServerLists, function (error) {
              showStatus("Fehler beim Laden der Listen: " + (error || data.error), "error");
            });
          } else {
            showStatus("Fehler beim Löschen: " + (data.error || "Unbekannter Fehler"), "error");
          }
        })
        .catch((error) => showStatus("Fehler: " + error, "error"));
    });

    if (typeof speiseplanName !== "undefined" && entryFilename == speiseplanName) {
      li.classList.add("speiseplan");
    }

    ul.appendChild(li);
  });
}

function editListItem(button) {
  const li = button.parentElement;
  const span = li.querySelector(".listFileName");
  const spanitemText = li.querySelector(".itemText");
  const oldText = span.textContent;

  li.dataset.editing = "true";

  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  button.disabled = true;
  li.insertBefore(input, spanitemText);
  spanitemText.style.display = "none";
  input.focus();

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
      if (
        li.dataset.editing &&
        (!li.contains(document.activeElement) || document.activeElement.tagName === "BUTTON")
      ) {
        finishEdit();
      }
    }, 10);
  });

  function finishEdit() {
    if (!li.dataset.editing) return;
    const newText = input.value.trim();
    if (newText && newText !== oldText) {
      const newFilename = replaceSpacesWithUnderscores(newText);
      fetch("bin/backend.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          oldFilename: replaceSpacesWithUnderscores(oldText),
          newFilename: newFilename,
          username: typeof username !== 'undefined' ? username : undefined,
        }),
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
    li.removeEventListener("click", tempHandler, { capture: true });

    if (input.parentElement === li) li.removeChild(input);
    spanitemText.style.display = "";
    button.disabled = false;
  }
}

// ==========================================================
//  UI: Add Item / Add List Item
// ==========================================================
function addItem() {
  const input = document.getElementById("newItem");
  const text = input.value.trim();
  if (!text) return;
  const addBtn = document.getElementById("addItemBtn");
  
  const dropdown = document.getElementById("itemSearchDropdown");
  if (dropdown) dropdown.style.display = "none";

  let filename =
    document.getElementById("filename").value.trim() ||
    getFilenameFromUrl() ||
    "liste";

  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map(
    (li) => li.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(
    document.querySelectorAll("#inactiveList li")
  ).map((li) => li.querySelector(".itemText").textContent.trim());

  saveListToServer(
    filename,
    [...activeItems, text],
    inactiveItems,
    () => {
      input.value = "";
      loadList();

      // Auf Touch-Geräten: Entferne möglichen Active/Hover-Zustand des Buttons.
      // Clone-Replace stellt sicher, dass mobile Browser keine aktive Darstellung behalten.
      try {
        if (touchscreen && addBtn && addBtn.parentElement) {
          const newBtn = addBtn.cloneNode(true);
          addBtn.parentElement.replaceChild(newBtn, addBtn);
          newBtn.addEventListener("click", addItem);
          newBtn.classList.remove("editing");
          newBtn.disabled = false;
          newBtn.blur && newBtn.blur();
          setTimeout(() => newBtn.blur && newBtn.blur(), 10);
        } else {
          addBtn && addBtn.blur && addBtn.blur();
        }
      } catch (e) {
        try { addBtn && addBtn.blur && addBtn.blur(); } catch (e) {}
      }
    },
    (error) => showStatus(`Fehler: ${error}`, "error")
  );
}



function addListItem() {
  const input = document.getElementById("newListItem");
  const text = replaceSpacesWithUnderscores(input?.value.trim() || "");
  if (!text) return;

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", filename: text, username: typeof username !== 'undefined' ? username : undefined }),
  })
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
//  Initialisierung bei DOMContentLoaded
// ==========================================================
document.addEventListener("DOMContentLoaded", function () {
  let urlFilename = getFilenameFromUrl();
  // Wenn die URL ein Share-Token enthält, darf die Key-Parsing-Funktion
  // nicht fälschlich 'share' als Listennamen zurückgeben. Unterdrücke
  // daher das automatische Laden einer Liste, falls ?share=... gesetzt ist.
  try {
    const _shareToken = getQueryParam('share');
    if (_shareToken) urlFilename = '';
  } catch (e) {}
  const listElements = document.getElementById("listElements");
  const listOverview = document.getElementById("listOverview");
  const loginDiv = document.getElementById("login");

  function isAuthenticated() {
    // Der Server setzt ein nicht-HTTP-only `username`-Cookie zusammen mit einem HTTP-only `token`.
    // Da `token` HTTP-only ist und clientseitig nicht lesbar, prüfen wir auf `username=`.
    return document.cookie.split(";").some((c) => c.trim().startsWith("username="));
  }

  if (isAuthenticated()) {
    if (loginDiv) loginDiv.style.display = "none";



    if (urlFilename) {
      if (listElements) listElements.style.display = "";
      if (listOverview) listOverview.style.display = "none";
      loadList();
        // Inaktivitäts-Timer für geöffnete Liste starten
        try { startInactivityTimer(); } catch (e) {}
      if (urlFilename === (typeof speiseplanName !== "undefined" ? speiseplanName : undefined)) {
        const newItem = document.getElementById("newItem");
        if (newItem) newItem.placeholder = "Es gibt ...";
      }
    } else {
      if (listElements) listElements.style.display = "none";
      if (listOverview) listOverview.style.display = "";
        // Falls wir in der Übersicht sind: Inaktivitäts-Timer stoppen
        try { stopInactivityTimer(); } catch (e) {}
        fetchAllLists(showServerLists, function (error) {
        showStatus("Fehler beim Laden der Listen: " + error, "error");
      });
    }
  } else {
    if (loginDiv) loginDiv.style.display = "";
    if (listElements) listElements.style.display = "none";
    if (listOverview) listOverview.style.display = "none";
  }

  // Buttons
  document.getElementById("registerBtn")?.addEventListener("click", register);
  document.getElementById("loginBtn")?.addEventListener("click", login);
  document.getElementById("addListItemBtn")?.addEventListener("click", addListItem);
  document.getElementById("addItemBtn")?.addEventListener("click", addItem);

  // Logout-Funktion (wird vom Menü aufgerufen)
  async function doLogout() {
    try { stopInactivityTimer(); } catch (e) {}
    try {
      await fetch("bin/backend.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
        credentials: "same-origin",
      });
    } catch (e) {
      console.warn("Logout-Request fehlgeschlagen:", e);
    }
    try {
      if (window.cookieStore && cookieStore.delete) {
        await cookieStore.delete("username");
        await cookieStore.delete("token");
      }
    } catch (e) {
      console.warn("CookieStore.delete fehlgeschlagen:", e);
    }
    try {
      document.cookie = "username=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    } catch (e) {
      console.warn("Clientseitiges Löschen der Cookies fehlgeschlagen:", e);
    }
    location.reload();
  }

  document.getElementById("backBtn")?.addEventListener("click", () => {
    try { stopInactivityTimer(); } catch (e) {}
    window.location.href = window.location.origin + window.location.pathname;
  });

  // Enter-Tasten
  [
    { id: "newListItem", handler: addListItem },
    { id: "newItem", handler: addItem },
    { id: "passCode", handler: login },
  ].forEach(({ id, handler }) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); // verhindert doppelten Login
        handler();
      }
    });
  });
  // Setup Extras
  setupItemSearch();
  setupDragAndDrop();

  // Wenn ein Share-Token in der URL ist, übernehmen
  try {
    const shareToken = getQueryParam('share');
    if (shareToken) {
      // Kleiner Delay, damit UI-Elemente initialisiert sind
      setTimeout(() => acceptSharedToken(shareToken), 200);
    }
  } catch (e) {}

  // Zusätzliche Enter-Listener (falls Funktion separat aufgerufen wird)
  setupEnterKeyListener("newItem", addItem);
  setupEnterKeyListener("newListItem", addListItem);
  setupEnterKeyListener("passCode", login);

  // --- Modal-Fokus & Barrierefreiheits-Hilfen ---
  function _getFocusable(modal) {
    return Array.from(modal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null);
  }

  function _openModal(modalId, firstSelector) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    // Speichere zuvor fokussiertes Element
    modal._previousActive = document.activeElement;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('aria-modal', 'true');

    // Fokus auf erstes Feld setzen (oder erstes fokussierbares Element)
    let target = null;
    try { target = firstSelector ? modal.querySelector(firstSelector) : null; } catch (e) { target = null; }
    if (!target) {
      const list = _getFocusable(modal);
      target = list.length ? list[0] : null;
    }
    try { target && target.focus(); } catch (e) {}

    // Keydown-Handler: Esc zum Schließen, Tab-Fokus innerhalb des Modals einkapseln
    modal._keydownHandler = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        _closeModal(modalId);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = _getFocusable(modal);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', modal._keydownHandler);
  }

  function _closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-modal', 'false');

    // Eingabefelder innerhalb des Modals leeren
    try {
      const inputs = modal.querySelectorAll('input');
      inputs.forEach(i => { if (i.type === 'password' || i.type === 'text') i.value = ''; });
    } catch (e) {}

    // Key-Handler entfernen und Fokus wiederherstellen
    try {
      if (modal._keydownHandler) document.removeEventListener('keydown', modal._keydownHandler);
      if (modal._previousActive && typeof modal._previousActive.focus === 'function') modal._previousActive.focus();
    } catch (e) {}
  }

  // --- Modal 'Passwort ändern': öffnen / schließen / senden ---
  function openChangePasswordModal() { _openModal('changePasswordModal', '#currentPassword'); }
  function closeChangePasswordModal() { _closeModal('changePasswordModal'); }

  async function changePassword() {
    const cur = document.getElementById('currentPassword')?.value || '';
    const nw = document.getElementById('newPassword')?.value || '';
    const conf = document.getElementById('newPasswordConfirm')?.value || '';

    if (!cur || !nw || !conf) return showStatus('Bitte alle Felder ausfüllen.', 'error');
    if (nw.length < 6) return showStatus('Neues Passwort zu kurz (mind. 6 Zeichen).', 'error');
    if (nw !== conf) return showStatus('Neues Passwort und Bestätigung stimmen nicht überein.', 'error');

    try {
      const resp = await fetch('bin/backend.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_password', currentPassword: cur, newPassword: nw, username: typeof username !== 'undefined' ? username : undefined }),
      });
      let data = null;
      try { data = await resp.json(); } catch (e) { /* ignorieren */ }
      if (!resp.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Serverfehler: ' + resp.status);
        throw new Error(msg);
      }
      if (!data || data.success === false) {
        throw new Error(data && (data.error || data.message) ? (data.error || data.message) : 'Fehler beim Ändern des Passworts.');
      }

      showStatus('Passwort geändert. Bitte melde dich neu an.', 'change');
      closeChangePasswordModal();
      setTimeout(() => { location.reload(); }, 1400);
    } catch (err) {
      console.error('Fehler beim Passwortwechsel:', err);
      showStatus(err.message || 'Fehler beim Passwortwechsel', 'error');
    }
  }

  // Drei-Punkte-Schaltfläche: schaltet das Dropdown-Menü um
  const moreBtn = document.getElementById('moreBtn');
  const moreMenu = document.getElementById('moreMenu');
  function closeMoreMenu() {
    if (!moreMenu) return;
    moreMenu.style.display = 'none';
    moreMenu.setAttribute('aria-hidden', 'true');
  }
  function openMoreMenu() {
    if (!moreMenu) return;
    moreMenu.style.display = 'block';
    moreMenu.setAttribute('aria-hidden', 'false');
  }
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (moreMenu.style.display === 'block') closeMoreMenu(); else openMoreMenu();
    });
    // Klick außerhalb schließt das Menü
    document.addEventListener('click', (e) => {
      if (!moreMenu) return;
      const target = e.target;
      if (target === moreBtn || moreBtn.contains(target) || moreMenu.contains(target)) return;
      closeMoreMenu();
    });

      // Menüeinträge binden
    document.getElementById('menuChangePassword')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); openChangePasswordModal();
    });
    document.getElementById('menuChangeUsername')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); openChangeUsernameModal();
    });
    document.getElementById('menuCreateInvite')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); createInvite();
    });
    document.getElementById('menuShowHelp')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); openHelp();
    });
    document.getElementById('menuDataProtection')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); _openModal('dataProtectionModal', '#downloadUserDataBtn');
    });
    document.getElementById('menuChangeEMail')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); openChangeEmailModal();
    });
    // Datenschutz-Modal: Schließen-Handler (Button + Klick auf Hintergrund)
    const _dataProtectionModal = document.getElementById('dataProtectionModal');
    const _closeDataProtectionBtn = document.getElementById('closeDataProtection');
    function closeDataProtection() { try { _closeModal('dataProtectionModal'); } catch (e) {} }
    if (_closeDataProtectionBtn) _closeDataProtectionBtn.addEventListener('click', (e) => { e.preventDefault(); closeDataProtection(); });
    if (_dataProtectionModal) _dataProtectionModal.addEventListener('click', (e) => { if (e.target === _dataProtectionModal) closeDataProtection(); });
    // Daten-Download & Account-Löschen Buttons
    const _downloadUserDataBtn = document.getElementById('downloadUserDataBtn');
    if (_downloadUserDataBtn) {
      _downloadUserDataBtn.addEventListener('click', function (e) {
        e.preventDefault();
        const btn = _downloadUserDataBtn;
        try { btn.disabled = true; } catch (e) {}
        showStatus('Erzeuge Archiv, bitte warten...', 'change');

        fetch('bin/backend.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'download', username: typeof username !== 'undefined' ? username : undefined })
        })
          .then((res) => res.json())
          .then((data) => {
            if (data && data.success && data.token) {
              const url = 'bin/backend.php?download=' + encodeURIComponent(data.token);
              setTimeout(() => { window.location.href = url; try { btn.disabled = false; } catch (e) {} }, 150);
              showStatus('Download wird gestartet...', 'change');
            } else {
              try { btn.disabled = false; } catch (e) {}
              showStatus((data && (data.error || data.message)) ? (data.error || data.message) : 'Fehler beim Erstellen des Archivs.', 'error');
            }
          })
          .catch((err) => {
            try { btn.disabled = false; } catch (e) {}
            showStatus('Fehler beim Anfordern des Archivs: ' + (err && err.message ? err.message : err), 'error');
          });
      });
    }

    const _quitAccountBtn = document.getElementById('quitAccountBtn');
    if (_quitAccountBtn) _quitAccountBtn.addEventListener('click', function (e) {
      e.preventDefault();
      try { closeMoreMenu(); } catch (e) {}
      try { _openModal('confirmDeleteModal', '#confirmDeletePassword'); } catch (e) {}
    });

    // Confirm-Delete Modal Buttons
    const _confirmDeleteModal = document.getElementById('confirmDeleteModal');
    const _confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const _cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const _closeConfirmDelete = document.getElementById('closeConfirmDelete');
    function _closeConfirmDeleteModal() { try { _closeModal('confirmDeleteModal'); } catch (e) {} }
    if (_cancelDeleteBtn) _cancelDeleteBtn.addEventListener('click', (e) => { e.preventDefault(); _closeConfirmDeleteModal(); });
    if (_closeConfirmDelete) _closeConfirmDelete.addEventListener('click', (e) => { e.preventDefault(); _closeConfirmDeleteModal(); });
    if (_confirmDeleteBtn) _confirmDeleteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try { _confirmDeleteBtn.disabled = true; } catch (e) {}
      const pwd = document.getElementById('confirmDeletePassword')?.value || '';
      if (!pwd) { showStatus('Bitte das aktuelle Passwort eingeben.', 'error'); try { _confirmDeleteBtn.disabled = false; } catch (e) {} return; }
      try {
        showStatus('Lösche Konto...', 'change');
        const resp = await fetch('bin/backend.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete_account', password: pwd, username: typeof username !== 'undefined' ? username : undefined }),
        });
        let data = null; try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) {
          const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Server antwortet mit ' + resp.status);
          showStatus('Fehler beim Löschen des Kontos: ' + msg, 'error');
        } else if (!data) {
          showStatus('Ungültige Serverantwort beim Löschen des Kontos.', 'error');
        } else if (data.success === false) {
          showStatus(data.error || data.message || 'Fehler beim Löschen des Kontos.', 'error');
        } else {
          // Erfolg: Session beendet, weiterleiten zur Startseite
          _closeConfirmDeleteModal();
          showStatus('Konto gelöscht. Weiterleitung...', 'change');
          setTimeout(() => { window.location.href = window.location.origin + window.location.pathname; }, 900);
        }
      } catch (err) {
        console.error('Fehler beim Löschen des Kontos:', err);
        showStatus('Serverfehler beim Löschen des Kontos.', 'error');
      } finally {
        try { _confirmDeleteBtn.disabled = false; } catch (e) {}
      }
    });
    document.getElementById('menuLogout')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); doLogout();
    });
  }

  // Modal-Buttons
  document.getElementById('closeChangePwd')?.addEventListener('click', () => closeChangePasswordModal());
  document.getElementById('cancelChangePasswordBtn')?.addEventListener('click', () => closeChangePasswordModal());
  document.getElementById('changePasswordBtn')?.addEventListener('click', () => changePassword());

  // --- Modal 'Benutzername ändern': öffnen / schließen / senden ---
  function openChangeUsernameModal() { _openModal('changeUsernameModal', '#newUsername'); }
  function closeChangeUsernameModal() { _closeModal('changeUsernameModal'); }

  // --- Modal 'E-Mail ändern': öffnen / schließen ---
  function openChangeEmailModal() { _openModal('changeEmailModal', '#newEmail'); }
  function closeChangeEmailModal() { _closeModal('changeEmailModal'); }

  // --- Hilfe-Overlay: öffnen / schließen ---
  function openHelp() {
    const help = document.getElementById('helpTexts');
    const closeBtn = document.getElementById('helpCloseBtn');
    if (!help) return;
    try { help.setAttribute('aria-hidden', 'false'); } catch (e) {}
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    try { if (closeBtn) closeBtn.focus(); } catch (e) {}
    document.addEventListener('keydown', _helpKeyHandler);
  }

  function closeHelp() {
    const help = document.getElementById('helpTexts');
    if (!help) return;
    try { help.setAttribute('aria-hidden', 'true'); } catch (e) {}
    try { document.body.style.overflow = ''; } catch (e) {}
    document.removeEventListener('keydown', _helpKeyHandler);
  }

  function _helpKeyHandler(e) {
    if (e.key === 'Escape') {
      try { closeHelp(); } catch (err) {}
    }
  }

  // Klick auf Hintergrund des Overlays schließt die Hilfe
  try {
    const helpRoot = document.getElementById('helpTexts');
    if (helpRoot) helpRoot.addEventListener('click', function (e) {
      if (e.target === helpRoot) closeHelp();
    });
    const helpClose = document.getElementById('helpCloseBtn');
    if (helpClose) helpClose.addEventListener('click', function (e) { e.stopPropagation(); closeHelp(); });
  } catch (e) {}

  // Einladung erstellen: kein Modal — Invite erzeugen und Link in die Zwischenablage kopieren
  async function createInvite() {
    try {
      const resp = await fetch('bin/backend.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_invite' }),
      });
      let data = null; try { data = await resp.json(); } catch (e) { data = null; }
      if (!resp.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Serverfehler: ' + resp.status);
        throw new Error(msg);
      }
      if (!data || data.success === false) throw new Error(data && (data.error || data.message) ? (data.error || data.message) : 'Fehler beim Erzeugen des Invites.');

      const token = data.invite;
      const shareUrl = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(token);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          showStatus('Einladung erstellt und Link in Zwischenablage kopiert.', 'change');
        } else {
          showStatus('Einladung erstellt: ' + shareUrl, 'change');
        }
      } catch (e) {
        showStatus('Einladung erstellt: ' + shareUrl, 'change');
      }

    } catch (err) {
      console.error('Fehler beim Erzeugen der Einladung:', err);
      showStatus(err.message || 'Fehler beim Erzeugen der Einladung', 'error');
    }
  }

  async function changeUsername() {
    const newU = document.getElementById('newUsername')?.value?.trim() || '';
    const cur = document.getElementById('currentPasswordForUsername')?.value || '';
    if (!newU) return showStatus('Bitte neuen Benutzernamen angeben.', 'error');
    if (!/^[a-zA-Z0-9_-]+$/.test(newU)) return showStatus('Ungültiger Benutzername.', 'error');
    if (!cur) return showStatus('Bitte aktuelles Passwort eingeben.', 'error');

    try {
      const resp = await fetch('bin/backend.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_username', newUsername: newU, password: cur }),
      });
      let data = null;
      try { data = await resp.json(); } catch (e) { /* ignorieren */ }
      if (!resp.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Serverfehler: ' + resp.status);
        throw new Error(msg);
      }
      if (!data || data.success === false) {
        throw new Error(data && (data.error || data.message) ? (data.error || data.message) : 'Fehler beim Ändern des Benutzernamens.');
      }

      showStatus('Benutzername geändert. Seite wird neu geladen.', 'change');
      closeChangeUsernameModal();
      setTimeout(() => { location.reload(); }, 900);
    } catch (err) {
      console.error('Fehler beim Benutzernamenwechsel:', err);
      showStatus(err.message || 'Fehler beim Benutzernamenwechsel', 'error');
    }
  }

  // Modal-Buttons (Benutzername)
  document.getElementById('closeChangeUser')?.addEventListener('click', () => closeChangeUsernameModal());
  document.getElementById('cancelChangeUsernameBtn')?.addEventListener('click', () => closeChangeUsernameModal());
  document.getElementById('changeUsernameBtn')?.addEventListener('click', () => changeUsername());

  // Enter-Taste im Benutzernamen-Modal löst Änderung aus
  ['newUsername','currentPasswordForUsername'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); changeUsername(); } });
  });

  // --- Modal 'Anzeigename ändern' (freie Darstellung, keine Passwort-Abfrage) ---
  async function changeDisplayName() {
    const newDisplay = document.getElementById('newDisplayName')?.value?.trim() || '';
    if (!newDisplay) return showStatus('Bitte einen Anzeigenamen angeben.', 'error');
    if (newDisplay.length > 512) return showStatus('Anzeigename zu lang.', 'error');

    try {
      const resp = await fetch('bin/backend.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_displayname', newDisplayName: newDisplay })
      });
      let data = null; try { data = await resp.json(); } catch (e) { data = null; }
      if (!resp.ok) {
        const msg = data && (data.error || data.message) ? (data.error || data.message) : ('Server antwortet mit ' + resp.status);
        throw new Error(msg);
      }
      if (!data || data.success === false) {
        throw new Error(data && (data.error || data.message) ? (data.error || data.message) : 'Fehler beim Speichern des Anzeigenamens.');
      }

      // Erfolg: aktualisiere UI ohne Neuladen
      try {
        const h = document.getElementById('userNamesZettel');
        if (newDisplay.endsWith('s') || newDisplay.endsWith('x') || newDisplay.endsWith('z')) {
            if (h) h.textContent = newDisplay + "’ Zettel";
          } else {
            if (h) h.textContent = newDisplay + 's Zettel';
          }
      } catch (e) {}
      showStatus('Anzeigename gespeichert.', 'change');
      closeChangeUsernameModal();
    } catch (err) {
      console.error('Fehler beim Speichern des Anzeigenamens:', err);
      showStatus(err.message || 'Fehler beim Speichern des Anzeigenamens.', 'error');
    }
  }

  // Modal-Buttons (Anzeigename)
  document.getElementById('changeDisplayNameBtn')?.addEventListener('click', () => changeDisplayName());
  document.getElementById('cancelChangeDisplayNameBtn')?.addEventListener('click', () => closeChangeUsernameModal());

  // Enter-Taste im Anzeigename-Feld löst Änderung aus
  (function(){ const el = document.getElementById('newDisplayName'); if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); changeDisplayName(); } }); })();

  // Enter-Taste im Modal löst Passwortänderung aus
  ['currentPassword','newPassword','newPasswordConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); changePassword(); } });
  });
});

// --- Handler für 'E-Mail ändern'-Modal ---
document.addEventListener('DOMContentLoaded', function () {
  const openBtn = document.getElementById('menuChangeEMail');
  const modal = document.getElementById('changeEmailModal');
  const closeBtn = document.getElementById('closeChangeEmail');
  const cancelBtn = document.getElementById('cancelChangeEmailBtn');
  const changeBtn = document.getElementById('changeEmailBtn');

  function showModal() {
    if (!modal) return;
    // Schließe das Overflow-Menü, falls es geöffnet ist
    try { if (typeof closeMoreMenu === 'function') closeMoreMenu(); } catch (e) {}
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    const input = document.getElementById('newEmail');
    if (input) input.focus();
  }
  function hideModal() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
  }

  if (openBtn) openBtn.addEventListener('click', function (e) { e.preventDefault(); showModal(); });
  if (closeBtn) closeBtn.addEventListener('click', function (e) { e.preventDefault(); hideModal(); });
  if (cancelBtn) cancelBtn.addEventListener('click', function (e) { e.preventDefault(); hideModal(); });

  if (changeBtn) changeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    const newEmail = document.getElementById('newEmail')?.value?.trim() || '';
    const password = document.getElementById('currentPasswordForEmail')?.value || '';
    if (!newEmail) { showStatus('Bitte eine neue E-Mail-Adresse eingeben.', 'error'); return; }
    if (!password) { showStatus('Bitte dein aktuelles Passwort eingeben.', 'error'); return; }

    fetch('bin/backend.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change_email', newEmail: newEmail, password: password })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.success) {
          showStatus(data.message || 'E-Mail wurde aktualisiert.', 'change');
          hideModal();
        } else {
          showStatus((data && data.message) || 'Fehler beim Aktualisieren der E-Mail.', 'error');
        }
      })
      .catch((err) => {
        showStatus('Serverfehler beim Aktualisieren der E-Mail.', 'error');
      });
  });

  // Modal beim Klicken auf den Hintergrund schließen
  if (modal) modal.addEventListener('click', function (e) {
    if (e.target === modal) hideModal();
  });
});
