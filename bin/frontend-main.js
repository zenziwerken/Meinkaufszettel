// Last modified: 2026/10/05 08:41:47

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
