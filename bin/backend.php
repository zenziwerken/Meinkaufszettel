<?php
declare(strict_types=1);
session_start();
require __DIR__ . '/config.php';

header('Content-Type: application/json');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$normalizedOrigin = $origin ? rtrim($origin, '/') : '';
if ($normalizedOrigin !== '' && in_array($normalizedOrigin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $normalizedOrigin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
} else {
    // keine CORS-Header setzen wenn Origin nicht erlaubt
}

// Preflight-Anfrage kurz beantworten
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Sicherstellen, dass Basisdaten- und Invite-Verzeichnisse existieren (sichere Berechtigungen) ---
if (!is_dir($dataDirBase) && !@mkdir($dataDirBase, 0750, true)) {
    sendError('Server-Fehler: Speicher-Basisverzeichnis nicht verfügbar.', 500);
}
if (!is_writable($dataDirBase)) {
    sendError('Speicher-Basisverzeichnis ist nicht beschreibbar.', 500);
}
if (!is_dir($invitesDir) && !@mkdir($invitesDir, 0750, true)) {
    sendError('Server-Fehler: Einladungs-Verzeichnis nicht verfügbar.', 500);
}
if (!is_writable($invitesDir)) {
    sendError('Einladungs-Verzeichnis ist nicht beschreibbar.', 500);
}
if (!is_dir($usersDir) && !@mkdir($usersDir, 0750, true)) {
    sendError('Server-Fehler: User-Verzeichnis nicht verfügbar.', 500);
}
if (!is_writable($usersDir)) {
    sendError('User-Verzeichnis ist nicht beschreibbar.', 500);
}
if (!is_dir($sharesDir) && !@mkdir($sharesDir, 0750, true)) {
    sendError('Server-Fehler: Verzeichnis zum Teilen von Listen nicht verfügbar.', 500);
}
if (!is_writable($sharesDir)) {
    sendError('Verzeichnis zum Teilen von Listen nicht ist nicht beschreibbar.', 500);
}
if (!is_dir($resetsDir) && !@mkdir($resetsDir, 0750, true)) {
    sendError('Server-Fehler: Resetverzeichnis nicht verfügbar.', 500);
}
if (!is_writable($resetsDir)) {
    sendError('Resetverzeichnis ist nicht beschreibbar.', 500);
}

// Nur POST akzeptieren
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendError('Ungültige Anfrage.', 405);
}

// Content-Length frühzeitig begrenzen, falls angegeben
$maxRequestBytes = 16 * 1024; // 16 KB
$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : null;
if ($contentLength !== null && $contentLength > $maxRequestBytes) {
    sendError('Die Anfrage ist zu groß.', 413);
}

// Request-Body lesen (mit sicherem Limit)
$input = file_get_contents('php://input', false, null, 0, $maxRequestBytes);
if ($input === false) {
    sendError('Fehler beim Lesen des Request-Körpers.', 400);
}
$data = json_decode($input, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    sendError('Ungültiges JSON-Format.', 400);
}

// --- Aktionen ---
$action = $data['action'] ?? null;

// Bestimme den angefragten Benutzernamen (entweder im Payload oder über das Cookie)
$reqUsername = isset($data['username']) ? trim((string)$data['username']) : (isset($_COOKIE['username']) ? trim((string)$_COOKIE['username']) : null);
if ($reqUsername !== null && !preg_match($usernameMatch, $reqUsername)) {
    sendError('Ungültiger Benutzername.', 400);
}
if ($reqUsername !== null) {
    $userDir = $usersDir . '/' . $reqUsername;
    $userPasswordFile = $userDir . '/.password';
    $userTokenDir = $userDir . '/tokens';
} else {
    $userDir = null; $userPasswordFile = null; $userTokenDir = null;
}

if ($action === 'register') {
    // Registrierung nur mit gültigem Invite-Token
    $inviteToken = isset($data['invite']) ? trim((string)$data['invite']) : '';
    if ($inviteToken === '') sendError('Invite-Token fehlt.', 400);
    $safeInvite = preg_replace('/[^a-zA-Z0-9_-]/', '', $inviteToken);
    $inviteFile = $invitesDir . '/' . $safeInvite;
    if (!file_exists($inviteFile)) sendError('Ungültiges oder abgelaufenes Invite.', 400);

    $inviteContentRaw = @file_get_contents($inviteFile);
    if ($inviteContentRaw === false) sendError('Fehler beim Lesen des Invites.', 500);
    $inviteContent = trim($inviteContentRaw);
    $reservedUser = null;
    // Versuche JSON-Format (neuere Invites), sonst fallback auf plain text (älteres Format)
    $decodedInvite = json_decode($inviteContent, true);
    if (json_last_error() === JSON_ERROR_NONE && is_array($decodedInvite)) {
        $reservedUser = isset($decodedInvite['reservedUsername']) && $decodedInvite['reservedUsername'] !== '' ? $decodedInvite['reservedUsername'] : null;
        // optional: Prüfung auf einmalige Nutzung / Ablauf (singleUse/expiry) möglich
    } else {
        $reservedUser = $inviteContent !== '' ? $inviteContent : null;
    }

    $desiredUsername = isset($data['username']) ? trim((string)$data['username']) : null;
    if ($reservedUser !== null) {
        // Invite reserviert einen Benutzernamen -> nur dieser ist zulässig
        if (!preg_match($usernameMatch, $reservedUser)) sendError('Invite enthält ungültigen Benutzernamen.', 400);
        if ($desiredUsername !== null && $desiredUsername !== $reservedUser) sendError('Invite ist für einen anderen Benutzernamen reserviert.', 400);
        $targetUser = $reservedUser;
    } else {
        // Invite erlaubt freie Namenswahl -> Client muss gewünschten Namen angeben
        if ($desiredUsername === null || $desiredUsername === '') sendError('Bitte gewünschten Benutzernamen angeben.', 400);
        if (!preg_match($usernameMatch, $desiredUsername)) sendError('Ungültiger Benutzername.', 400);
        $targetUser = $desiredUsername;
    }

    if (!isset($data['password'])) sendError('Passwort fehlt.', 400);
    // E-Mail für Passwort-Zurücksetzen erwartet
    $email = isset($data['email']) ? trim((string)$data['email']) : null;
    if ($email === null || $email === '') sendError('E-Mail fehlt.', 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) sendError('Ungültige E-Mail-Adresse.', 400);

    $userDir = $usersDir . '/' . $targetUser;
    if (is_dir($userDir)) sendError('Benutzer existiert bereits.', 409);
    if (!@mkdir($userDir, 0750, true)) sendError('Server-Fehler: Benutzerverzeichnis konnte nicht angelegt werden.', 500);
    $userPasswordFile = $userDir . '/.password';
    $hashedPassword = password_hash($data['password'], PASSWORD_DEFAULT);
    if (file_put_contents($userPasswordFile, $hashedPassword) === false) sendError('Konnte Passwort nicht speichern.', 500);
    // Speichere die E-Mail-Adresse in .email (nur für Reset-Versand)
    $emailFile = $userDir . '/.email';
    if (file_put_contents($emailFile, $email, LOCK_EX) === false) {
        // Versuche, Passwort-Datei zu entfernen, um inkonsistente Registrierung zu vermeiden
        @unlink($userPasswordFile);
        sendError('Konnte E-Mail nicht speichern.', 500);
    }
    @chmod($emailFile, 0640);
    // Entferne Invite
    @unlink($inviteFile);

    // Weiter zur Anmeldung (login)
    $action = 'login';
    $reqUsername = $targetUser;
    $userTokenDir = $userDir . '/tokens';
}

// API: First-run status (client kann prüfen, ob noch kein Nutzer existiert)
if ($action === 'firstRun') {
    try {
        $hasAnyUser = false;
        $uEntries = @scandir($usersDir);
        if (is_array($uEntries)) {
            foreach ($uEntries as $ue) {
                if ($ue === '.' || $ue === '..') continue;
                if (is_dir($usersDir . '/' . $ue)) { $hasAnyUser = true; break; }
            }
        }

        if ($hasAnyUser) {
            echo json_encode(['success' => true, 'firstRun' => false]);
            exit;
        }

        // Suche vorhandenes First-Run-Invite
        $foundToken = null;
        $iEntries = @scandir($invitesDir);
        if (is_array($iEntries)) {
            foreach ($iEntries as $ie) {
                if ($ie === '.' || $ie === '..') continue;
                $f = $invitesDir . '/' . $ie;
                if (!is_file($f)) continue;
                $raw = @file_get_contents($f);
                if ($raw === false) continue;
                $decoded = json_decode($raw, true);
                if (json_last_error() === JSON_ERROR_NONE && is_array($decoded) && isset($decoded['note']) && $decoded['note'] === 'first-run-invite') {
                    $foundToken = $ie;
                    break;
                }
            }
        }

        // Falls nicht vorhanden, erstelle ein Invite
        if ($foundToken === null) {
            try {
                $token = bin2hex(random_bytes(16));
            } catch (Throwable $e) {
                $token = bin2hex(openssl_random_pseudo_bytes(16));
            }
            $safeToken = preg_replace('/[^a-zA-Z0-9_-]/', '', $token);
            $firstInviteFile = $invitesDir . '/' . $safeToken;
            $meta = json_encode(['created' => time(), 'note' => 'first-run-invite', 'singleUse' => true]);
            @file_put_contents($firstInviteFile, $meta, LOCK_EX);
            @chmod($firstInviteFile, 0640);
            $foundToken = $safeToken;
        }

        echo json_encode(['success' => true, 'firstRun' => true, 'invite' => $foundToken]);
        exit;
    } catch (Throwable $e) {
        echo json_encode(['success' => false, 'error' => 'Serverfehler']);
        exit;
    }
}

// Logout: entferne das aktuelle Token (wenn vorhanden), zerstöre Session und setze Cookies abgelaufen
if ($action === 'logout') {
    // Versuche Token aus Cookie zu entfernen
    $cookieUsername = isset($_COOKIE['username']) ? trim((string)$_COOKIE['username']) : null;
    $cookieToken = isset($_COOKIE['token']) ? $_COOKIE['token'] : null;
    if ($cookieUsername && $cookieToken && preg_match($usernameMatch, $cookieUsername)) {
        $tokenHash = hash('sha256', $cookieToken);
        $tokenFile = $usersDir . '/' . $cookieUsername . '/tokens/' . $tokenHash;
        if (file_exists($tokenFile)) {
            @unlink($tokenFile);
        }
    }

    // Session zurücksetzen
    if (isset($_SESSION['auth_user'])) unset($_SESSION['auth_user']);
    // Versuche Session zu zerstören
    try {
        session_unset();
        session_destroy();
    } catch (Throwable $e) {
        // ignore
    }

    // Setze Cookies abgelaufen (sicherer Fallback für Clients ohne CookieStore)
    setcookie('token', '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict'
    ]);
    setcookie('username', '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => true,
        'httponly' => false,
        'samesite' => 'Strict'
    ]);

    echo json_encode(['success' => true, 'message' => 'Logout erfolgreich']);
    exit;
}

if ($action === 'login') {
    if (!isset($data['password'])) sendError('Ungültige Anfrage: Passwort fehlt.', 400);
    if ($reqUsername === null) sendError('Kein Benutzer angegeben.', 400);
    if (!is_dir($userDir)) sendError('Benutzer nicht gefunden.', 404);
    $stored = @file_get_contents($userPasswordFile);
    if ($stored === false || $stored === '') sendError('Benutzer-Passwort nicht gesetzt.', 401);

    if (password_verify($data['password'], $stored)) {
        // Session für diesen Benutzer als authentifiziert markieren
        $_SESSION['auth_user'] = $reqUsername;
        setcookie('username', $reqUsername, [
            'expires' => time() + 15552000, // 180 Tage
            'path' => '/',
            'secure' => true,
            'httponly' => false,
            'samesite' => 'Strict'
        ]);

        if (!is_dir($userTokenDir) && !@mkdir($userTokenDir, 0750, true)) sendError('Server-Fehler: Tokenverzeichnis nicht verfügbar.', 500);

        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $tokenFile = $userTokenDir . '/' . $tokenHash;
        if (file_put_contents($tokenFile, '-') === false) sendError('Konnte Token-Datei nicht speichern.', 500);

        setcookie(
            'token', $token, [
            'expires' => time() + 15552000, // 180 Tage
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Strict'
        ]);

        echo json_encode(['success' => true, 'message' => 'Login erfolgreich']);
    } else {
        sendError('Ungültiges Passwort.', 401);
    }
    exit;
}

// Authentifizierung: entweder Session eines Benutzers oder ein Cookie-Paar (username+token)
if (!isset($_SESSION['auth_user']) || $_SESSION['auth_user'] === '') {
    if (!isset($_COOKIE['token']) || !is_string($_COOKIE['token']) || !isset($_COOKIE['username']) || !is_string($_COOKIE['username'])) {
        sendError('Nicht autorisiert. Bitte erneut anmelden.', 401);
    }
    $cookieUsername = trim((string)$_COOKIE['username']);
    if (!preg_match($usernameMatch, $cookieUsername)) sendError('Ungültiger Benutzer.', 401);
    $token = $_COOKIE['token'];
    $tokenHash = hash('sha256', $token);
    $tokenFile = $usersDir . '/' . $cookieUsername . '/tokens/' . $tokenHash;
    if (!file_exists($tokenFile)) {
        sendError('Nicht autorisiert. Bitte erneut anmelden.', 401);
    } else {
        $_SESSION['auth_user'] = $cookieUsername;
        touch($tokenFile);
    }
}
// Wenn die Anfrage keinen Benutzernamen spezifiziert hat, verwende bevorzugt den in der Session gespeicherten Benutzernamen
if ($reqUsername === null) {
    $reqUsername = $_SESSION['auth_user'];
    $userDir = $usersDir . '/' . $reqUsername;
    $userPasswordFile = $userDir . '/.password';
    $userTokenDir = $userDir . '/tokens';
}

// Passwort wechseln: nur für authentifizierte/aktuelle Benutzer
if ($action === 'change_password') {
    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    if (!isset($data['currentPassword']) || !isset($data['newPassword'])) sendError('Passwörter fehlen.', 400);

    $current = (string)$data['currentPassword'];
    $new = (string)$data['newPassword'];

    if (strlen($new) < 6) sendError('Neues Passwort ist zu kurz (mindestens 6 Zeichen).', 400);

    // lade gespeicherten Hash
    $stored = @file_get_contents($userPasswordFile);
    if ($stored === false || $stored === '') sendError('Benutzer-Passwort nicht gesetzt.', 500);

    if (!password_verify($current, $stored)) {
        sendError('Aktuelles Passwort ist falsch.', 401);
    }

    $newHash = password_hash($new, PASSWORD_DEFAULT);
    if ($newHash === false) sendError('Server-Fehler beim Hashing.', 500);

    // atomisch schreiben
    if (!atomicReplaceFile($userPasswordFile, $newHash)) sendError('Konnte Passwort nicht speichern.', 500);
    @chmod($userPasswordFile, 0640);

    // Token-Invalidierung: tokens/ Verzeichnis leeren
    $tokenDir = $userDir . '/tokens';
    if (is_dir($tokenDir)) {
        $files = glob($tokenDir . '/*');
        if ($files !== false) {
            foreach ($files as $f) {
                if (is_file($f)) @unlink($f);
            }
        }
    }

    // Session zurücksetzen (erzwungenes Re-Login)
    if (isset($_SESSION['auth_user'])) unset($_SESSION['auth_user']);
    try { session_regenerate_id(true); } catch (Throwable $e) {}
    try { session_destroy(); } catch (Throwable $e) {}

    // Setze cookie token abgelaufen (sicherer client-fallback)
    setcookie('token', '', [ 'expires' => time() - 3600, 'path' => '/', 'samesite' => 'Strict' ]);

    echo json_encode(['success' => true, 'message' => 'Passwort geändert. Bitte melde dich erneut an.']);
    exit;
}

// Benutzername ändern: Verzeichnis umbenennen (nur für aktuell angemeldeten Benutzer)
if ($action === 'change_username') {
    // Wir nutzen die session-authenticated user als Quelle der Wahrheit
    $currentUser = $_SESSION['auth_user'] ?? null;
    if ($currentUser === null) sendError('Nicht autorisiert.', 401);

    $newUsername = isset($data['newUsername']) ? trim((string)$data['newUsername']) : '';
    $password = isset($data['password']) ? (string)$data['password'] : '';
    if ($newUsername === '') sendError('Neuer Benutzername fehlt.', 400);
    if (!preg_match($usernameMatch, $newUsername)) sendError('Ungültiger neuer Benutzername.', 400);
    if ($password === '') sendError('Passwort fehlt.', 400);

    $currentUserDir = $usersDir . '/' . $currentUser;
    $currentPasswordFile = $currentUserDir . '/.password';
    if (!is_dir($currentUserDir) || !file_exists($currentPasswordFile)) sendError('Benutzer nicht gefunden.', 404);

    $stored = @file_get_contents($currentPasswordFile);
    if ($stored === false || $stored === '') sendError('Benutzer-Passwort nicht gesetzt.', 500);
    if (!password_verify($password, $stored)) sendError('Ungültiges Passwort.', 401);

    // Zielverzeichnis prüfen
    $newUserDir = $usersDir . '/' . $newUsername;
    if (is_dir($newUserDir)) sendError('Benutzername bereits vergeben.', 409);

    // Versuche Umbenennung
    if (!@rename($currentUserDir, $newUserDir)) {
        sendError('Konnte Benutzerdaten nicht umbenennen.', 500);
    }

    // Session + Cookie anpassen (neuer Username)
    try { $_SESSION['auth_user'] = $newUsername; } catch (Throwable $e) {}
    setcookie('username', $newUsername, [
        'expires' => time() + 15552000,
        'path' => '/',
        'secure' => true,
        'httponly' => false,
        'samesite' => 'Strict'
    ]);

    echo json_encode(['success' => true, 'message' => 'Benutzername geändert']);
    exit;
}

// E-Mail ändern (nur für angemeldete Benutzer, aktuelle Passwort-Bestätigung erforderlich)
if ($action === 'change_email') {
    // Nur Session-basierte Auth erlaubt (Vermeidet Namens-Mismatch beim Umbenennen)
    $currentUser = $_SESSION['auth_user'] ?? null;
    if ($currentUser === null) sendError('Nicht autorisiert.', 401);

    $newEmail = isset($data['newEmail']) ? trim((string)$data['newEmail']) : '';
    $password = isset($data['password']) ? (string)$data['password'] : '';
    if ($newEmail === '') sendError('Neue E-Mail fehlt.', 400);
    if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) sendError('Ungültige E-Mail-Adresse.', 400);
    if ($password === '') sendError('Passwort fehlt.', 400);

    $userDir = $usersDir . '/' . $currentUser;
    $userPasswordFile = $userDir . '/.password';
    if (!is_dir($userDir) || !file_exists($userPasswordFile)) sendError('Benutzer nicht gefunden.', 404);

    $stored = @file_get_contents($userPasswordFile);
    if ($stored === false || $stored === '') sendError('Benutzer-Passwort nicht gesetzt.', 500);
    if (!password_verify($password, $stored)) sendError('Ungültiges Passwort.', 401);

    $emailFile = $userDir . '/.email';
    // Atomic write bevorzugen
    if (!atomicReplaceFile($emailFile, $newEmail)) {
        if (file_put_contents($emailFile, $newEmail, LOCK_EX) === false) sendError('Konnte E-Mail nicht speichern.', 500);
    }
    @chmod($emailFile, 0640);

    echo json_encode(['success' => true, 'message' => 'E-Mail wurde aktualisiert.']);
    exit;
}

// Erzeuge Invite-Token (optional reservierter Benutzername)
if ($action === 'create_invite') {
    // nur authentifizierte Benutzer dürfen Invites erzeugen
    if (!isset($_SESSION['auth_user']) || $_SESSION['auth_user'] === '') sendError('Nicht autorisiert.', 401);

    if (!is_dir($invitesDir) && !@mkdir($invitesDir, 0750, true)) sendError('Server-Fehler: Invite-Verzeichnis nicht verfügbar.', 500);
    // Erzeuge eindeutigen Token
    $attempts = 0;
    do {
        $token = bin2hex(random_bytes(16));
        $safe = preg_replace('/[^a-zA-Z0-9_-]/', '', $token);
        $file = $invitesDir . '/' . $safe;
        $attempts++;
    } while (file_exists($file) && $attempts < 8);

    if (file_exists($file)) sendError('Konnte eindeutiges Invite-Token nicht erzeugen.', 500);

    $payload = json_encode([
        'singleUse' => true,
        'createdBy' => $_SESSION['auth_user'] ?? null,
        'createdAt' => time()
    ], JSON_UNESCAPED_UNICODE);
    if ($payload === false) sendError('Server-Fehler beim JSON-Encoding.', 500);
    if (file_put_contents($file, $payload, LOCK_EX) === false) sendError('Konnte Invite nicht speichern.', 500);
    @chmod($file, 0640);

    echo json_encode(['success' => true, 'invite' => $safe, 'message' => 'Invite erzeugt']);
    exit;
}

if ($action === 'create') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    if ($filename === '') sendError('Kein Filename angegeben.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name.', 400);
    if (strpos($filename, '..') !== false) sendError('Ungültiger Name.', 400);

    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    if (!is_dir($userDir) && !@mkdir($userDir, 0750, true)) sendError('Server-Fehler beim Erstellen des Benutzerverzeichnisses.', 500);

    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    $handle = @fopen($fullPath, 'x');
    if ($handle === false) sendError('Liste existiert bereits oder kann nicht erstellt werden.', 409);
    @chmod($fullPath, 0640);

    $emptyList = ['active' => [], 'inactive' => [], 'username' => $reqUsername];
    $jsonContent = json_encode($emptyList, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($jsonContent === false) { @fclose($handle); @unlink($fullPath); sendError('Server-Fehler beim Erstellen der Datei.', 500); }
    if (!flock($handle, LOCK_EX)) { @fclose($handle); @unlink($fullPath); sendError('Server-Fehler: Lock konnte nicht gesetzt werden.', 500); }
    $written = fwrite($handle, $jsonContent);
    fflush($handle); flock($handle, LOCK_UN); fclose($handle);
    if ($written === false) { @unlink($fullPath); sendError('Konnte Datei nicht schreiben.', 500); }
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich erstellt', 'filename' => basename($fullPath)]);
    exit;
}

if ($action === 'rename') {
    $filename = isset($data['oldFilename']) ? trim((string)$data['oldFilename']) : '';
    $newFilename = isset($data['newFilename']) ? trim((string)$data['newFilename']) : '';
    if ($filename === '' || $newFilename === '') sendError('Filename oder neuer Name fehlt.', 400);
    if (!preg_match($filenameMatch, $filename) || !preg_match($filenameMatch, $newFilename)) sendError('Ungültiger Name.', 400);

    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    $newRel = basename($newFilename) . '.json';
    if (!validatePath($userDir, $newRel)) sendError('Ungültiger Pfad.', 400);
    $newFullPath = $userDir . '/' . $newRel;
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);
    if (file_exists($newFullPath)) sendError('Eine Liste mit dem neuen Namen existiert bereits.', 409);
    if (!rename($fullPath, $newFullPath)) sendError('Konnte Liste nicht umbenennen.', 500);
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich umbenannt', 'filename' => basename($newFullPath)]);
    exit;
}

if ($action === 'delete') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    if ($filename === '') sendError('Keine Liste angegeben.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name.', 400);
    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);
    if (!unlink($fullPath)) sendError('Konnte Liste nicht löschen.', 500);
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich gelöscht', 'filename' => basename($fullPath)]);
    exit;
}

if ($action === 'share') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    if ($filename === '') sendError('Keine Liste angegeben.', 400);
    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name.', 400);

    // Vereinfachung: direkt teilen (Hardlink-Strategie wird erwartet)
    $token = shareList($reqUsername, $filename);
    echo json_encode([
        'success' => true,
        'message' => 'Share-Token erstellt',
        'share' => $token
    ]);
    exit;
}

if ($action === 'shared') {
    $shareToken = isset($data['share']) ? trim((string)$data['share']) : '';
    if ($shareToken === '') sendError('Share-Token fehlt.', 400);
    $safeShare = preg_replace('/[^a-zA-Z0-9_-]/', '', $shareToken);
    $shareFile = $sharesDir . '/' . $safeShare;
    if (!file_exists($shareFile)) sendError('Ungültige Listeneinladung', 400);
    $sharedContent = file_get_contents($shareFile);
    if ($sharedContent === false) {
        sendError('Fehler beim Lesen der Share-Datei', 500);
    }
    $sharedData = json_decode($sharedContent, true);
    $filename = isset($sharedData['sharingFilename']) ? trim((string)$sharedData['sharingFilename']) : '';
    if ($filename === '') sendError('Keine Liste angegeben.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name.', 400);
    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;

    $sharingUser = isset($sharedData['sharingUser']) ? trim((string)$sharedData['sharingUser']) : '';
    if ($sharingUser === '') sendError('Kein Sharing-Benutzer angegeben.', 400);
    if (!preg_match($usernameMatch, $sharingUser)) sendError('Ungültiger Sharing-Benutzer.', 400);
    $sharingUserDir = $usersDir . '/' . $sharingUser;
    if (!is_dir($sharingUserDir)) sendError('Sharing-Benutzer nicht gefunden.', 404);
    $sharedFullPath = $sharingUserDir . '/' . basename($filename) . '.json';    
    if (!file_exists($sharedFullPath)) sendError('Geteilte Liste nicht gefunden.', 404);
    if (file_exists($fullPath) || is_link($fullPath)) sendError('Eine Liste mit dem Namen existiert bereits in Ihrem Account.', 409);
    // Verwende Hardlink statt Symlink: Datei wird im eigenen Verzeichnis verlinkt
    if (!link($sharedFullPath, $fullPath)) sendError('Konnte geteilte Liste nicht übernehmen.', 500);
    if (!unlink($shareFile)) {
        // Warnung, aber kein Abbruch
    }
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich übernommen', 'filename' => basename($fullPath)]);
    exit;
}

if ($action === 'list') {
    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    if (!is_dir($userDir)) {
        echo json_encode([]);
        exit;
    }
    $files = glob($userDir . '/*.json');
    $list = [];
    natcasesort($files);
    foreach ($files as $file) {
        $filename = basename($file, '.json');
        $jsonContent = @file_get_contents($file);
        if ($jsonContent === false) continue;
        $jsonData = json_decode($jsonContent, true);
        $itemCount = 0;
        if (isset($jsonData['active']) && is_array($jsonData['active'])) $itemCount += count($jsonData['active']);
        $list[] = [
            'filename' => $filename,
            'itemCount' => $itemCount,
            'lastModified' => verstaendlicheZeitangabe(filemtime($file)),
        ];
        
    }

    echo json_encode($list);
    exit;
}

if ($action === 'load') {
    $id = isset($data['id']) ? trim((string)$data['id']) : '';
    if (!preg_match($filenameMatch, $id)) sendError('Ungültige Liste.', 400);
    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    $rel = basename($id) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);
    $jsonContent = @file_get_contents($fullPath);
    if ($jsonContent === false) sendError('Fehler beim Lesen der Liste.', 500);
    echo $jsonContent;
    exit;
}

if ($action === 'save') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    $active = $data['active'] ?? null;
    $inactive = $data['inactive'] ?? null;

    if (!is_array($active) || !is_array($inactive)) sendError('Active und Inactive müssen Arrays sein.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name. Nur Buchstaben, Zahlen, "/" und Leerzeichen erlaubt.', 400);
    if (count($active) > $maxItemsPerList || count($inactive) > $maxItemsPerList) sendError("Zu viele Einträge in der Liste. Nur $maxItemsPerList Einträge pro Liste erlaubt", 400);

    // Validate items: type and length
    foreach (['active' => $active, 'inactive' => $inactive] as $k => $arr) {
        foreach ($arr as $i => $item) {
            if (!is_string($item) && !is_numeric($item)) {
                sendError("Ungültiger Eintrag in $k[$i].", 400);
            }
            $s = (string)$item;
            if (mb_strlen($s) > $maxItemLength) {
                sendError("Ein Eintrag in $k ist zu lang. Nur $maxItemLength Zeichen erlaubt.", 400);
            }
        }
    }

    $items = ['active' => array_values($active), 'inactive' => array_values($inactive), 'username' => $reqUsername];
    $jsonContent = json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($jsonContent === false) sendError('Server-Fehler beim JSON-Encoding.', 500);

    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    if (!is_dir($userDir) && !@mkdir($userDir, 0750, true)) sendError('Server-Fehler beim Erstellen des Benutzerverzeichnisses.', 500);
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    if (!atomicReplaceFile($fullPath, $jsonContent)) sendError('Konnte Liste nicht speichern.', 500);

    $totalItems = count($items['active']) + count($items['inactive']);
    echo json_encode([
        'success' => true,
        'filename' => basename($fullPath),
        'message' => 'Liste erfolgreich als JSON gespeichert',
        'itemCount' => $totalItems
    ]);
    exit;
}

if ($action === 'sync') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    $active = $data['active'] ?? null;
    $inactive = $data['inactive'] ?? null;

    if (!is_array($active) || !is_array($inactive)) sendError('Active und Inactive müssen Arrays sein.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name. Nur Buchstaben, Zahlen, "/" und Leerzeichen erlaubt.', 400);
    if (count($active) > $maxItemsPerList || count($inactive) > $maxItemsPerList) sendError("Zu viele Einträge in der Liste. Nur $maxItemsPerList Einträge pro Liste erlaubt", 400);

    // Validate items: type and length
    foreach (['active' => $active, 'inactive' => $inactive] as $k => $arr) {
        foreach ($arr as $i => $item) {
            if (!is_string($item) && !is_numeric($item)) {
                sendError("Ungültiger Eintrag in $k[$i].", 400);
            }
            $s = (string)$item;
            if (mb_strlen($s) > $maxItemLength) {
                sendError("Ein Eintrag in $k ist zu lang. Nur $maxItemLength Zeichen erlaubt.", 400);
            }
        }
    }

    if ($userDir === null) sendError('Kein Benutzer angegeben.', 400);
    if (!is_dir($userDir) && !@mkdir($userDir, 0750, true)) sendError('Server-Fehler beim Erstellen des Benutzerverzeichnisses.', 500);
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;

    // Load existing data if possible
    $existing = ['active' => [], 'inactive' => []];
    $existingUsername = $reqUsername;
    if (file_exists($fullPath)) {
        $jsonContent = @file_get_contents($fullPath);
        if ($jsonContent !== false) {
            $decoded = json_decode($jsonContent, true);
            if (is_array($decoded)) {
                if (isset($decoded['active']) && is_array($decoded['active'])) $existing['active'] = $decoded['active'];
                if (isset($decoded['inactive']) && is_array($decoded['inactive'])) $existing['inactive'] = $decoded['inactive'];
                if (isset($decoded['username']) && is_string($decoded['username']) && $decoded['username'] !== '') {
                    $existingUsername = $decoded['username'];
                }
            }
        }
    }

    // Normalisiere Eingaben
    $frontendActive = array_values(array_map('strval', $active));
    $frontendInactive = array_values(array_map('strval', $inactive));

    // Start mit existierenden Sets (erhält Reihenfolge soweit möglich)
    $resultActive = array_values($existing['active']);
    $resultInactive = array_values($existing['inactive']);

    // Ergebnis-Arrays zusammensetzen
    $items = ['active' => $resultActive, 'inactive' => $resultInactive, 'username' => $existingUsername];

    // Frühzeitige Prüfung: Wenn keine Änderungen gegenüber der vorhandenen Datei vorliegen,
    // sofort an das Frontend zurückmelden und den Schreibvorgang überspringen.
    if ($frontendActive === $resultActive && $frontendInactive === $resultInactive) {
        echo json_encode([
            'success' => true,
            'message' => 'keine Änderungen',
        ]);
        exit;
    }

    // 1) Items, die das Frontend als inaktiv meldet, müssen inaktiv werden
    foreach ($frontendInactive as $item) {
        if (!in_array($item, $resultInactive, true)) $resultInactive[] = $item;
        // Falls noch aktiv vorhanden: entfernen
        $idx = array_search($item, $resultActive, true);
        if ($idx !== false) unset($resultActive[$idx]);
    }

    // 2) Frontend-active: nur synchronisieren, wenn sie nicht (bereits) in der inaktiven Liste sind
    foreach ($frontendActive as $item) {
        if (in_array($item, $resultInactive, true)) {
            // Item ist inaktuell auf dem Server, respektiere passive Status
            continue;
        }
        if (!in_array($item, $resultActive, true)) $resultActive[] = $item;
    }

    // 3) Entferne Duplikate und sorge dafür, dass active & inactive disjunkt sind
    $resultInactive = array_values(array_unique($resultInactive));
    $resultActive = array_values(array_unique($resultActive));
    // Entferne Überschneidungen: passive gewinnt
    $resultActive = array_values(array_filter($resultActive, function($it) use ($resultInactive) {
        return !in_array($it, $resultInactive, true);
    }));

    if (count($resultActive) > $maxItemsPerList || 
        count($resultInactive) > $maxItemsPerList) {
            sendError("Zu viele Einträge nach Synchronisation. Max $maxItemsPerList erlaubt.", 400);
    }

    $jsonContent = json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($jsonContent === false) sendError('Server-Fehler beim JSON-Encoding.', 500);

    if (!atomicReplaceFile($fullPath, $jsonContent)) {
        sendError('Konnte Liste nicht speichern.', 500);
    }


    echo json_encode([
        'success' => true,
        'filename' => basename($fullPath),
        'message' => 'Änderungen durch ' . $existingUsername,
        'changedBy' => $existingUsername,
        'active' => $items['active'],
        'inactive' => $items['inactive']
    ]);
    exit;
}

sendError('Ungültige Daten empfangen', 400);

// ----------------- Hilfsfunktionen -----------------
function sendError(string $message, int $httpCode = 400): void {
    http_response_code($httpCode);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

/**
 * Überprüft, dass ein vom Nutzer angegebener relativer Pfad innerhalb des Basisverzeichnisses bleibt.
 * Diese Funktion ist tolerant gegenüber Dateien, die noch nicht existieren: Sie ermittelt den realpath
 * des Basisverzeichnisses und des Verzeichnisses des Kandidaten und stellt sicher, dass der Kandidat
 * innerhalb der Basis liegt.
 */
function validatePath(string $base, string $userPath): bool {
    $realBase = realpath($base);
    if ($realBase === false) return false;

    // Normalisiere den vom Nutzer gelieferten Pfad (vermeide Directory-Traversal durch Verwendung von basename)
    $candidate = $base . '/' . $userPath;

    // Falls der Kandidat existiert: realpath ermitteln und vergleichen
    $realCandidate = realpath($candidate);
    if ($realCandidate !== false) {
        return strpos($realCandidate, $realBase) === 0;
    }

    // Falls der Kandidat noch nicht existiert (z. B. beim Anlegen einer neuen Datei),
    // stelle sicher, dass sein übergeordnetes Verzeichnis innerhalb des Basisverzeichnisses liegt.
    $candidateDir = dirname($candidate);
    $realCandidateDir = realpath($candidateDir);
    if ($realCandidateDir === false) return false;
    return strpos($realCandidateDir, $realBase) === 0;
}

function verstaendlicheZeitangabe($timestamp) {
    $jetzt = time();
    $diff = $jetzt - $timestamp;
    
    // In Minuten umrechnen
    $minuten = floor($diff / 60);
    $stunden = floor($diff / 3600);
    $tage = floor($diff / 86400);
    
    if ($minuten < 5) {
        return "gerade&nbsp;eben&nbsp;geändert";
    } elseif ($minuten < 15) {
        return "vor&nbsp;kurzem&nbsp;geändert";
    } elseif ($minuten < 60) {
        return "in&nbsp;der letzten Stunde geändert";
    } elseif ($stunden < 24) {
        return "vor&nbsp;" . $stunden . "&nbsp;Stunde" . ($stunden != 1 ? "n" : "") . "&nbsp;geändert";
    } elseif ($stunden < 48)  {
        return "gestern&nbsp;geändert";
    } else {
        return "vor&nbsp;" . $tage . "&nbsp;Tag" . ($tage != 1 ? "en" : "") . "&nbsp;geändert";
    }
}

/**
 * Atomisch eine Datei ersetzen (tmp -> rename).
 * Vereinfachte Variante ohne spezielle Symlink-Behandlung (Hardlinks erwartet).
 */
function atomicReplaceFile(string $path, string $content): bool {
    // Wenn $path ein Symlink ist, arbeite auf dem Ziel der Symlink
    $target = $path;
    if (is_link($path)) {
        $linkTarget = readlink($path);
        if ($linkTarget === false) return false;
        if ($linkTarget[0] !== '/') {
            $target = dirname($path) . '/' . $linkTarget;
        } else {
            $target = $linkTarget;
        }
    }

    $targetDir = dirname($target);
    if (!is_dir($targetDir) && !@mkdir($targetDir, 0750, true)) return false;

    // Wenn die Datei bereits existiert und mehrere Hardlinks hat, schreibe IN-PLACE
    // damit andere Hardlinks den neuen Inhalt sehen.
    if (file_exists($target)) {
        $st = @stat($target);
        $nlink = 1;
        if ($st !== false) {
            $nlink = isset($st['nlink']) ? (int)$st['nlink'] : (isset($st[3]) ? (int)$st[3] : 1);
        }
        if ($nlink > 1) {
            $fp = @fopen($target, 'c+');
            if ($fp === false) return false;
            if (!flock($fp, LOCK_EX)) { fclose($fp); return false; }
            if (!ftruncate($fp, 0)) { flock($fp, LOCK_UN); fclose($fp); return false; }
            rewind($fp);
            $written = fwrite($fp, $content);
            fflush($fp);
            flock($fp, LOCK_UN);
            fclose($fp);
            @chmod($target, 0640);
            return $written !== false;
        }
    }

    // Standard: atomischer Austausch via tmp -> rename
    $tmp = $targetDir . '/.' . basename($target) . '.tmp-' . bin2hex(random_bytes(6));
    $written = @file_put_contents($tmp, $content, LOCK_EX);
    if ($written === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0640);

    if (!@rename($tmp, $target)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/**
 * Erzeugt ein Share-Token und legt eine Tokendatei im $sharesDir an.
 * Rückgabe: der Token-String (Dateiname).
 */
function shareList(string $username, string $filename): string {
    global $usersDir, $sharesDir, $filenameMatch, $usernameMatch;

    if (!preg_match($usernameMatch, $username)) sendError('Ungültiger Benutzer.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Listename.', 400);

    $userDir = $usersDir . '/' . $username;
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);

    if (!is_dir($sharesDir) && !@mkdir($sharesDir, 0750, true)) {
        sendError('Server-Fehler: Shares-Verzeichnis nicht verfügbar.', 500);
    }

    // Erzeuge einen einzigartigen Token (hex)
    $attempts = 0;
    do {
        $token = bin2hex(random_bytes(16));
        $safe = preg_replace('/[^a-zA-Z0-9_-]/', '', $token);
        $shareFile = $sharesDir . '/' . $safe;
        $attempts++;
    } while (file_exists($shareFile) && $attempts < 8);

    if (file_exists($shareFile)) sendError('Konnte eindeutiges Share-Token nicht erzeugen.', 500);

    $payload = json_encode([
        'sharingUser' => $username,
        'sharingFilename' => basename($filename)
    ], JSON_UNESCAPED_UNICODE);
    if ($payload === false) sendError('Server-Fehler beim JSON-Encoding.', 500);

    if (file_put_contents($shareFile, $payload, LOCK_EX) === false) {
        sendError('Konnte Share-Token nicht speichern.', 500);
    }
    @chmod($shareFile, 0640);

    return $safe;
}
