// Last modified: 2026/06/09 21:52:58

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
      statusDiv._dismissTimer = setTimeout(clear, 5000);
    }
    if (type === 'warning') {
      statusDiv._dismissTimer = setTimeout(clear, 10000);
    }
    if (type === 'error') {
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

  const skip = new Set(['user', 'token', 'share', 'download', 'invite']);

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
  // Wenn die Query ein Key=Value-Paar enthält (z.B. "invite=..." oder "share=..."),
  // dann handelt es sich wahrscheinlich um einen Parameter und nicht um einen reinen
  // Listennamen wie "?meineliste". In diesem Fall nichts zurückgeben.
  if (raw.indexOf('=') !== -1) return "";
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

/**
 * Ersetzt reguläre Leerzeichen durch geschützte Leerzeichen (U+00A0),
 */
function withNbsp(text) {
  try {
    return String(text).replace(/ /g, '\u00A0');
  } catch (e) {
    return String(text);
  }
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() / 1000) - timestamp);

    // weniger als 5 Minuten
    if (seconds < 300) return withNbsp('gerade eben geändert');
    // 5 bis 15 Minuten
    if (seconds < 900) return withNbsp('vor kurzem geändert');
    // weniger als 1 Stunde
    if (seconds < 3600) return withNbsp('in der letzten Stunde geändert');

    const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

    const hours = Math.floor(seconds / 3600);
    if (hours < 24) return withNbsp(rtf.format(-hours, 'hour') + ' geändert');

    const days = Math.floor(seconds / 86400);
    return withNbsp(rtf.format(-days, 'day') + ' geändert');
}

/**
 * Zentraler POST-Helper für JSON-Requests an `bin/backend.php`.
 * Fügt standardmäßig `credentials: 'same-origin'` und das CSRF-Token
 * als Header `X-CSRF-Token` hinzu (falls `csrfToken` verfügbar ist).
 * Rückgabe: das Promise von `fetch` (Roh-Response) — Aufrufer kann `.json()` weiter nutzen.
 */
function postToBackend(payload, extraOptions) {
  const headers = Object.assign({}, (extraOptions && extraOptions.headers) || {});
  if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  try {
    if (typeof csrfToken !== 'undefined' && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  } catch (e) {}

  const opts = Object.assign({
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(payload)
  }, extraOptions || {});

  return fetch('bin/backend.php', opts);
}

// ==========================================================
//  Offline-/PWA-Unterstützung (lokaler Cache + Pending Saves)
// ==========================================================

const _pwaStoragePrefix = 'einkaufszettel:pwa:v2:';
const _pwaKeys = {
  overview: _pwaStoragePrefix + 'overview',
  pendingSaves: _pwaStoragePrefix + 'pendingSaves',
  lastNetworkState: _pwaStoragePrefix + 'lastNetworkState'
};

let _offlineInitDone = false;
let _pendingSaveFlushRunning = false;

function _lsGetJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function _lsSetJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function _isProbablyNetworkError(err) {
  try {
    if (!err) return false;
    // Fetch wirft bei Netzwerkproblemen häufig TypeError
    if (err instanceof TypeError) return true;
    const msg = String(err.message || err || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('netzwerk') || msg.includes('load failed');
  } catch (e) {
    return false;
  }
}

function _cacheListKey(filename) {
  const f = String(filename || 'liste');
  return _pwaStoragePrefix + 'list:' + encodeURIComponent(f);
}

function cacheListLocally(filename, payload, meta) {
  try {
    if (!payload || typeof payload !== 'object') return;
    const active = Array.isArray(payload.active) ? payload.active : [];
    const inactive = Array.isArray(payload.inactive) ? payload.inactive : [];
    const obj = {
      filename: String(filename || 'liste'),
      cachedAt: Date.now(),
      shared: !!payload.shared,
      active: active.map((x) => String(x ?? '')),
      inactive: inactive.map((x) => String(x ?? '')),
      meta: meta && typeof meta === 'object' ? meta : undefined
    };
    _lsSetJSON(_cacheListKey(filename), obj);
  } catch (e) {}
}

function getCachedListLocally(filename) {
  try {
    const obj = _lsGetJSON(_cacheListKey(filename), null);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function cacheOverviewLocally(listArray) {
  try {
    if (!Array.isArray(listArray)) return;
    _lsSetJSON(_pwaKeys.overview, { cachedAt: Date.now(), lists: listArray });
  } catch (e) {}
}

function getCachedOverviewLocally() {
  try {
    const obj = _lsGetJSON(_pwaKeys.overview, null);
    if (!obj || !Array.isArray(obj.lists)) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function _getPendingSaves() {
  const q = _lsGetJSON(_pwaKeys.pendingSaves, []);
  return Array.isArray(q) ? q : [];
}

function _setPendingSaves(q) {
  _lsSetJSON(_pwaKeys.pendingSaves, Array.isArray(q) ? q : []);
}

function queuePendingSave(filename, activeItems, inactiveItems) {
  try {
    const fname = String(filename || 'liste');
    const entry = {
      filename: fname,
      active: Array.isArray(activeItems) ? activeItems.map((x) => String(x ?? '')) : [],
      inactive: Array.isArray(inactiveItems) ? inactiveItems.map((x) => String(x ?? '')) : [],
      queuedAt: Date.now()
    };

    const q = _getPendingSaves();
    // Dedupe: pro Liste nur den neuesten Stand behalten
    const without = q.filter((e) => e && e.filename !== fname);
    without.push(entry);
    _setPendingSaves(without);
    return true;
  } catch (e) {
    return false;
  }
}

async function flushPendingSaves(reason) {
  if (_pendingSaveFlushRunning) return;
  if (!navigator.onLine) return;
  const q = _getPendingSaves();
  if (!q.length) return;

  _pendingSaveFlushRunning = true;
  try {
    let remaining = q.slice();
    let flushed = 0;

    for (const entry of q) {
      if (!entry || !entry.filename) {
        remaining = remaining.filter((x) => x !== entry);
        continue;
      }

      try {
        const resp = await postToBackend({
          action: 'save',
          filename: entry.filename,
          active: entry.active || [],
          inactive: entry.inactive || [],
          username: typeof username !== 'undefined' ? username : undefined,
        });
        let data = null;
        try { data = await resp.json(); } catch (e) { data = null; }

        if (!resp.ok || (data && data.success === false)) {
          // Nicht weiter flushen – kann Auth/CSRF/Serverproblem sein
          break;
        }

        remaining = remaining.filter((x) => !(x && x.filename === entry.filename && x.queuedAt === entry.queuedAt));
        flushed++;
      } catch (err) {
        // Netzwerk wieder weg -> abbrechen
        break;
      }
    }

    _setPendingSaves(remaining);
    if (flushed > 0) {
      showStatus('Lokale Änderungen synchronisiert' + (reason ? ' (' + reason + ')' : ''), 'change');
    }
  } finally {
    _pendingSaveFlushRunning = false;
  }
}

function initOfflineUiAndPwa() {
  if (_offlineInitDone) return;
  _offlineInitDone = true;

  // Initialer Status
  try {
    const last = _lsGetJSON(_pwaKeys.lastNetworkState, null);
    const now = navigator.onLine ? 'online' : 'offline';
    if (last && last.state && last.state !== now) {
      // Zustand hat sich seit letztem Besuch geändert
    }
    _lsSetJSON(_pwaKeys.lastNetworkState, { state: now, at: Date.now() });
  } catch (e) {}

  try {
    if (!navigator.onLine) {
      showStatus('Kein Netzwerk – Änderungen werden lokal zwischengespeichert.', 'warning');
      try { stopPeriodicSync(); } catch (e) {}
      try { _setSyncIndicator(false); } catch (e) {}
    } else {
      // Direkt beim Start versuchen zu flushen
      flushPendingSaves('Start');
    }
  } catch (e) {}

  // Online/Offline Events
  window.addEventListener('offline', () => {
    try { _lsSetJSON(_pwaKeys.lastNetworkState, { state: 'offline', at: Date.now() }); } catch (e) {}
    showStatus('Kein Netzwerk – Änderungen werden lokal zwischengespeichert.', 'warning');
    try { stopPeriodicSync(); } catch (e) {}
    try { _setSyncIndicator(false); } catch (e) {}
  });

  window.addEventListener('online', () => {
    try { _lsSetJSON(_pwaKeys.lastNetworkState, { state: 'online', at: Date.now() }); } catch (e) {}
    showStatus('Wieder online – synchronisiere lokale Änderungen…', 'change');
    flushPendingSaves('Online');
    // Falls eine geteilte Liste geöffnet ist: Sync wieder starten
    try {
      const current = document.getElementById('filename')?.value?.trim() || getFilenameFromUrl();
      if (current && _currentListShared) startPeriodicSync(current);
    } catch (e) {}
  });

  // Manifest: wenn die Seite bereits ein Manifest setzt (z.B. links/website.manifest.php), nicht überschreiben.
  // Nur als Fallback hinzufügen, falls keines vorhanden ist.
  try {
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'manifest');
      // Bestehende Struktur der App: Manifest liegt im Ordner links/
      link.setAttribute('href', new URL('links/website.manifest.php', window.location.href).toString());
      // Falls Server das Manifest mit Credentials erwartet, passt das zur index.php-Konfiguration
      link.setAttribute('crossorigin', 'use-credentials');
      document.head.appendChild(link);
    }
  } catch (e) {}

  try {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', '#ffffff');
  } catch (e) {}

  try {
    if ('serviceWorker' in navigator) {
      const swUrl = new URL('sw.js', window.location.href).toString();
      navigator.serviceWorker.register(swUrl).catch((e) => {
        console.warn('Service Worker Registrierung fehlgeschlagen:', e);
      });
    }
  } catch (e) {}
}

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
//  Auth (register / login)
// ==========================================================
function register() {
  const passCode = document.getElementById("passCode")?.value.trim();
  if (!passCode) {
    showStatus("Bitte Passwort eingeben.", "error");
    return;
  }
  const regUsername = document.getElementById('registerUsername')?.value?.trim() || '';
  const regEmail = document.getElementById('registerEmail')?.value?.trim() || '';

  // Username is required for registration (backend enforces this)
  if (!regUsername) {
    showStatus('Bitte gewünschten Benutzernamen angeben.', 'error');
    return;
  }

  postToBackend({
    action: "register",
    password: passCode,
    username: regUsername,
    email: regEmail || undefined,
    invite: (typeof inviteToken !== 'undefined' && inviteToken)
      ? inviteToken
      : (document.getElementById('inviteInput')?.value?.trim() || undefined),
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

  postToBackend({ action: "login", password: passCode, username: payloadUsername })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok) throw { status: response.status, message: data.error || "Unbekannter Serverfehler" };
        return data;
      })
    )
    .then((data) => {
      if (data.success) {
        showStatus("Anmeldung erfolgreich.", "change");
        setTimeout(() => { location.reload(); }, 500);
      } else {
        showStatus(data.message || "Falsches Passwort.", "error");
      }
    })
    .catch((error) => showStatus(error.message || "Fehler beim Login: " + error, "error"));
    
}
// ==========================================================
//  Element-Erzeugung (active / inactive)
// ==========================================================
function _findActiveLiByText(text) {
  try {
    const needle = String(text ?? '').trim();
    if (!needle) return null;
    const ul = document.getElementById('itemList');
    if (!ul) return null;
    const match = Array.from(ul.querySelectorAll('li .itemText')).find((el) => (el.textContent || '').trim() === needle);
    return match ? match.closest('li') : null;
  } catch (e) {
    return null;
  }
}

function createActiveItem(text) {
  // Falls der Eintrag bereits aktiv existiert, kein Duplikat erzeugen.
  // (Beim Neu-Rendern via loadList() ist die Liste zuvor geleert, daher greift das nicht.)
  const existing = _findActiveLiByText(text);
  if (existing) return existing;

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
    // Ignoriere click, wenn pointerdown gerade gespeichert hat
    if (this._justSaved) return;
    try { editItem(this); } catch (err) { console.error(err); }
  });

  li.appendChild(dragHandle);
  li.appendChild(spanText);
  // Markiere Items, die mit '!' enden, weiterhin mit einer CSS-Klasse
  let trimmed = '';
  try {
    trimmed = String(text || '').trim();
    if (trimmed.endsWith('!')) li.classList.add('has-exclamation');
    if (trimmed.endsWith('?')) li.classList.add('has-question');
    if (trimmed.startsWith('https://')) li.classList.add('has-link');
  } catch (e) { /* ignorieren */ }

  // Füge Linksymbol hinzu, falls der Text mit https:// beginnt
  if (trimmed.startsWith('https://')) {
    const linkIcon = document.createElement('a');
    linkIcon.href = trimmed;
    linkIcon.target = '_blank';
    linkIcon.className = 'linkIcon';
    linkIcon.title = 'Link öffnen';
    linkIcon.addEventListener('click', (e) => e.stopPropagation());
    li.appendChild(linkIcon);
  }
  li.appendChild(editBtn);

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

  // Speichere den moveToInactive Handler, damit er später in editItem entfernt/hinzugefügt werden kann
  li._moveHandler = function (e) {
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
    moveToInactive(li);
  };

  li.addEventListener("click", li._moveHandler);

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
            moveToActive(li, { position: 'top', reconcileWithBackend: true });
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
let draggedListLi = null;

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
    let draggedLi = null;
    let isDragging = false;

    itemList.addEventListener(
      "touchstart",
      (e) => {
        const li = e.target.closest("li");
        const handle = e.target.closest(".dragHandle");

        if (!li || !handle) return;

        draggedLi = li;
        isDragging = true;
        li.classList.add("dragging");
      },
      { passive: true }
    );

    itemList.addEventListener(
      "touchmove",
      (e) => {
        if (!draggedLi || !isDragging) return;

        e.preventDefault();

        const touchY = e.touches[0].clientY;
        const afterElement = getDragAfterElement(itemList, touchY);

        // Nur verschieben wenn nötig → verhindert Flackern & Performance-Probleme
        if (afterElement !== draggedLi.nextSibling) {
          if (afterElement == null) {
            itemList.appendChild(draggedLi);
          } else {
            itemList.insertBefore(draggedLi, afterElement);
          }
        }
      },
      { passive: false }
    );

    itemList.addEventListener("touchend", () => {
      if (draggedLi) {
        draggedLi.classList.remove("dragging");
        updateActiveOrder();
      }
      draggedLi = null;
      isDragging = false;
    });

    itemList.addEventListener("touchcancel", () => {
      if (draggedLi) {
        draggedLi.classList.remove("dragging");
      }
      draggedLi = null;
      isDragging = false;
    });
  }
}

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

// Speichert die neue Listen-Reihenfolge
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
  const stripped = String(text).replace(/([!?]+|\d+x)$/, '').trim();

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
  // Stelle sicher, dass ein bereits inaktiv vorhandener Eintrag nicht dupliziert wird.
  // Dazu normalisieren wir alle Inaktiven mit der gleichen Strip-Logik.
  const normalizedInactiveItems = inactiveItems
    .map((item) => String(item || '').replace(/([!?]+|\d+x)$/, '').trim())
    .filter(Boolean);
  const newInactiveItems = [...new Set([...normalizedInactiveItems, stripped])];

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
        // UI-seitig ebenfalls keine Duplikate erzeugen, falls das Item bereits inaktiv existiert
        const inactiveUl = document.getElementById("inactiveList");
        if (inactiveUl) {
          const alreadyInactive = Array.from(inactiveUl.querySelectorAll('li .itemText'))
            .some((el) => (el.textContent || '').trim() === stripped);
          if (!alreadyInactive) {
            const finalLi = createInactiveItem(stripped);
            inactiveUl.appendChild(finalLi);
          }
        }
        // Wenn keine aktiven Elemente mehr vorhanden sind, zeige das "Pyro"-Element
        try {
          const itemList = document.getElementById('itemList');
          const activeCount = itemList ? itemList.querySelectorAll('li').length : 0;
          if (activeCount === 0) {
            const pyro = document.getElementById('pyro');
            if (pyro) {
              pyro.classList.add('visible');
              void pyro.offsetWidth;
              setTimeout(() => { pyro.classList.remove('visible');}, 10000);
            }
          }
        } catch (e) {}

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

function moveToActive(li, options) {
  if (!li) return;
  const text = li.querySelector(".itemText").textContent.trim();
  const opts = options && typeof options === 'object' ? options : {};
  const position = opts.position === 'top' ? 'top' : 'bottom';
  // Offline macht ein reconcile (loadList) keinen Sinn und kann die UI sogar wieder überschreiben.
  const reconcileWithBackend = (opts.reconcileWithBackend !== false) && !!navigator.onLine;
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);
  const alreadyActive = activeItems.includes(text);
  const baseActive = [...new Set(activeItems.filter(Boolean))];
  // Wenn bereits aktiv: nicht duplizieren. Bei "top" ggf. nach oben ziehen.
  const newActiveItems = alreadyActive
    ? (position === 'top' ? [text, ...baseActive.filter((i) => i !== text)] : baseActive)
    : (position === 'top' ? [text, ...baseActive] : [...baseActive, text]);

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  // Optimistisches UI-Update: sofort sichtbar aktivieren (funktioniert auch offline)
  const ul = document.getElementById("itemList");
  const inactiveUl = document.getElementById("inactiveList");
  const prevNextSibling = li.nextSibling;
  const prevParent = li.parentElement;
  const activeLi = createActiveItem(text);
  let didInsertActive = false;
  try {
    if (ul && activeLi) {
      // Falls createActiveItem ein bereits existierendes Element zurückgibt, nur repositionieren
      if (position === 'top') ul.prepend(activeLi);
      else ul.appendChild(activeLi);
      didInsertActive = true;
    }
    if (li && li.parentElement) li.parentElement.removeChild(li);
    try { sortInactiveList(); } catch (e) {}
  } catch (e) {
    // Wenn UI-Optimismus schiefgeht, fahren wir trotzdem mit Save fort
  }

  saveListToServer(
    filename,
    newActiveItems,
    newInactiveItems,
    function (data) {
      // UI ist bereits optimistisch aktualisiert.
      // Optional: online Abgleich vom Backend (nur wenn wirklich online und kein Offline-Ack)
      const isOfflineAck = !!(data && data.offline);
      if (reconcileWithBackend && navigator.onLine && !isOfflineAck) {
        try { loadList(); } catch (e) {}
      }
    },
    function (error) {
      // Nicht-Netzwerkfehler: UI-Änderung revertieren
      try {
        if (didInsertActive && activeLi && activeLi.parentElement) {
          activeLi.parentElement.removeChild(activeLi);
        }
        if (prevParent && li) {
          if (prevNextSibling) prevParent.insertBefore(li, prevNextSibling);
          else prevParent.appendChild(li);
        } else if (inactiveUl && li) {
          inactiveUl.appendChild(li);
        }
        try { sortInactiveList(); } catch (e) {}
      } catch (e) {}
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

  // Wenn bereits im Editing → als Save interpretieren
  if (button.classList.contains("editing")) {
    const existingInput = li.querySelector(".editInput");
    if (existingInput) saveInput(existingInput);
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  // Mobile-Optimierungen
  input.style.fontSize = "16px"; // Verhindert iOS-Zoom
  input.setAttribute("enterkeyhint", "done");

  button.classList.add("editing");

  li.insertBefore(input, span);
  span.style.display = "none";

  // Fokus mit kurzer Verzögerung für mobile Geräte
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 50);

  // Original-Handler temporär entfernen
  const originalMoveHandler = li._moveHandler;
  if (originalMoveHandler) {
    li.removeEventListener("click", originalMoveHandler);
  }

  let isCleaningUp = false;
  let isSaving = false;

  function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;

    // Blur-Listener ZUERST entfernen, bevor DOM-Änderungen blur auslösen
    input.removeEventListener("blur", blurHandler);

    span.style.display = "";
    if (li.contains(input)) li.removeChild(input);

    button.classList.remove("editing");

    if (originalMoveHandler) {
      li.addEventListener("click", originalMoveHandler);
    }

    document.removeEventListener("pointerdown", outsideHandler, true);

    // Button-Fokus entfernen
    if (button.blur) button.blur();
  }

  function saveInput(el) {
    if (!el || isSaving || isCleaningUp) return;
    isSaving = true;

    const newText = el.value.trim();

    // UI SOFORT zurücksetzen
    cleanup();

    // Keine Änderung → kein Server-Call nötig
    if (!newText || newText === oldText) {
      isSaving = false;
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
        // Success - UI updaten
        try {
          const nt = String(newText).trim();
          span.textContent = nt;

          li.classList.toggle("has-exclamation", nt.endsWith("!"));
          li.classList.toggle("has-question", nt.endsWith("?"));
          li.classList.toggle("has-link", nt.startsWith("https://"));

          const existingIcon = li.querySelector(".linkIcon");

          if (nt.startsWith("https://")) {
            if (!existingIcon) {
              const linkIcon = document.createElement("a");
              linkIcon.href = nt;
              linkIcon.target = "_blank";
              linkIcon.rel = "noopener noreferrer";
              linkIcon.className = "linkIcon";
              linkIcon.title = "Link öffnen";
              linkIcon.addEventListener("click", (e) => e.stopPropagation());
              linkIcon.addEventListener("touchend", (e) => {
                e.stopPropagation();
                window.open(nt, "_blank");
              });

              const editBtn = li.querySelector(".editBtn");
              if (editBtn) li.insertBefore(linkIcon, editBtn);
            } else {
              existingIcon.href = nt;
            }
          } else {
            if (existingIcon) existingIcon.remove();
          }

          showStatus("Gespeichert", "success");
        } catch (e) {
          console.error("UI-Update-Fehler:", e);
          span.textContent = newText; // Fallback
        }
      },
      function (error) {
        // Error - Text zurücksetzen
        console.error("Server-Fehler:", error);
        span.textContent = oldText;
        showStatus(`Fehler: ${error}`, "error");
      }
    );

    // isSaving zurücksetzen (async)
    setTimeout(() => {
      isSaving = false;
    }, 0);
  }

  function cancelEdit() {
    if (input.value !== oldText) {
      input.value = oldText;
    }
    cleanup();
  }

  // ENTER / ESC
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveInput(input);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  });

  // Blur als benannte Funktion – damit sie in cleanup() sauber entfernt werden kann
  function blurHandler() {
    if (input.value.trim() !== oldText) {
      // Änderung vorgenommen → saveInput aufrufen
      setTimeout(() => {
        if (!isCleaningUp && !isSaving) {
          saveInput(input);
        }
      }, 150);
    } else {
      // Keine Änderung → cleanup sofort aufrufen
      cleanup();
    }
  }

  input.addEventListener("blur", blurHandler);

  // Pointer außerhalb → speichern
  function outsideHandler(e) {
    if (!li.contains(e.target) && document.body.contains(e.target)) {
      if (!isCleaningUp && !isSaving) {
        saveInput(input);
      }
    }
  }

  document.addEventListener("pointerdown", outsideHandler, true);

  // Button im Editing-Zustand → Save
  button.addEventListener("pointerdown", function onPointerDown(e) {
    if (!button.classList.contains("editing")) return;

    e.preventDefault();
    e.stopPropagation();

    // Flag setzen, um nachfolgenden click zu ignorieren
    button._justSaved = true;
    setTimeout(() => delete button._justSaved, 0);

    saveInput(input);
  }, { once: true });
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

  // Verhindere doppelte aktive Einträge
  if (activeItems.includes(text)) {
    try {
      const existing = _findActiveLiByText(text);
      if (existing) {
        existing.classList.add('flash');
        existing.addEventListener('animationend', () => existing.classList.remove('flash'), { once: true });
      }
    } catch (e) {}
    input.value = "";
    return;
  }

  saveListToServer(
    filename,
    [text, ...activeItems],
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
//  Initialisierung bei DOMContentLoaded
// ==========================================================
document.addEventListener("DOMContentLoaded", function () {
  // Offline-/PWA-Support initialisieren (Statusmeldungen, lokales Caching, SW/Manifest)
  try { initOfflineUiAndPwa(); } catch (e) {}

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
  const listSpeiseplan = document.getElementById("listSpeiseplanHistory");

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
      if (listSpeiseplan) listSpeiseplan.style.display = "none";
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
      if (listSpeiseplan) listSpeiseplan.style.display = "none";
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
    if (listSpeiseplan) listSpeiseplan.style.display = "none";
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
      await postToBackend({ action: "logout" });
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
      const resp = await postToBackend({ action: 'change_password', currentPassword: cur, newPassword: nw, username: typeof username !== 'undefined' ? username : undefined });
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
    try {
      const active = document.activeElement;
      if (active && moreMenu.contains(active)) {
        try { active.blur && active.blur(); } catch (e) {}
      }
    } catch (e) {}
    moreMenu.style.display = 'none';
    try {
      if ('inert' in HTMLElement.prototype) {
        try { moreMenu.inert = true; } catch (e) {}
        moreMenu.removeAttribute('aria-hidden');
      } else {
        moreMenu.setAttribute('aria-hidden', 'true');
      }
    } catch (e) { try { moreMenu.setAttribute('aria-hidden', 'true'); } catch (e) {} }
    try { if (moreBtn && typeof moreBtn.focus === 'function') moreBtn.focus(); } catch (e) {}
  }
  function openMoreMenu() {
    if (!moreMenu) return;
    moreMenu.style.display = 'block';
    try {
      if ('inert' in HTMLElement.prototype) {
        try { moreMenu.inert = false; } catch (e) {}
        moreMenu.removeAttribute('aria-hidden');
      } else {
        moreMenu.setAttribute('aria-hidden', 'false');
      }
    } catch (e) { try { moreMenu.setAttribute('aria-hidden', 'false'); } catch (e) {} }
    try {
      const first = moreMenu.querySelector('button, a, [tabindex]:not([tabindex="-1"])');
      if (first && typeof first.focus === 'function') first.focus();
    } catch (e) {}
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
    document.getElementById('menuShowSpeiseplan')?.addEventListener('click', (e) => {
      e.stopPropagation(); closeMoreMenu(); openSpeiseplanHistory();
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

        postToBackend({ action: 'download', username: typeof username !== 'undefined' ? username : undefined })
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
        const resp = await postToBackend({ action: 'delete_account', password: pwd, username: typeof username !== 'undefined' ? username : undefined });
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
      const resp = await postToBackend({ action: 'create_invite' });
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
      const resp = await postToBackend({ action: 'change_username', newUsername: newU, password: cur });
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
      const resp = await postToBackend({ action: 'change_displayname', newDisplayName: newDisplay });
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

    postToBackend({ action: 'change_email', newEmail: newEmail, password: password })
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

// --- Menü-Handler: Dark Mode setzen (Cookie 'mode=dark') ---
document.addEventListener('DOMContentLoaded', function () {
  const darkBtn = document.getElementById('menuDarkMode');
  if (!darkBtn) return;
  // Initial theme and button label: prefer cookie; otherwise use system preference
  try {
    const cookieMatch = (document.cookie.match(/(?:^|;\s*)mode=([^;]+)/) || []);
    const cookieMode = cookieMatch[1] || '';
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Apply theme to body
    if (cookieMode === 'dark' || cookieMode === 'light') {
      document.body.classList.remove(cookieMode === 'dark' ? 'light' : 'dark');
      document.body.classList.add(cookieMode);
    } else {
      document.body.classList.add(prefersDark ? 'dark' : 'light');
    }

    // Set button label according to effective mode
    const effective = cookieMode || (prefersDark ? 'dark' : 'light');
    if (effective === 'dark') {
      darkBtn.classList.add('dark');
    } else {
      darkBtn.classList.remove('dark');
    }
    if (cookieMode) {
      darkBtn.textContent = (cookieMode === 'dark') ? 'Light Mode' : 'Dark Mode';
    } else {
      darkBtn.textContent = 'Design: System (' + (prefersDark ? 'Dark' : 'Light') + ')';
    }
  } catch (e) {}

  darkBtn.addEventListener('click', function (e) {
    e.preventDefault();
    try { if (typeof closeMoreMenu === 'function') closeMoreMenu(); } catch (err) {}

    // read current cookie mode
    let current = '';
    try { current = (document.cookie.match(/(?:^|;\s*)mode=([^;]+)/) || [])[1] || ''; } catch (e) { current = ''; }
    // toggle between dark and light (click always sets explicit preference)
    const next = current === 'dark' ? 'light' : 'dark';

    try {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      document.cookie = 'mode=' + next + '; path=/; expires=' + d.toUTCString() + '; SameSite=Lax';
    } catch (e) {
      try { document.cookie = 'mode=' + next + '; path=/; SameSite=Lax'; } catch (e) {}
    }

    try { if (window.cookieStore && cookieStore.set) cookieStore.set({ name: 'mode', value: next, path: '/' }).catch(() => {}); } catch (e) {}

    try {
      document.body.classList.remove(next === 'dark' ? 'light' : 'dark');
      document.body.classList.add(next);
    } catch (e) {}

    try {
      darkBtn.textContent = (next === 'dark') ? 'Light Mode' : 'Dark Mode' ;
    } catch (e) {}

    setTimeout(() => { try { location.reload(); } catch (e) {} }, 150);
  });
});
