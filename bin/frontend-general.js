// Last modified: 2026/10/05 08:41:54

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

