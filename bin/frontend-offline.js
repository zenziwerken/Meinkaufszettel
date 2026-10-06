// Last modified: 2026/10/05 08:38:41

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

