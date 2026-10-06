// Last modified: 2026/10/05 08:41:43

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
