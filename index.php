<?php
// index.php
require __DIR__ . '/bin/config.php';
// Session prüfen, um zu erkennen ob der Besucher bereits angemeldet ist
if (session_status() === PHP_SESSION_NONE) session_start();
// CSRF-Token für synchronizer-token pattern erzeugen (falls noch nicht vorhanden)
if (empty($_SESSION['csrf_token'])) {
    try {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    } catch (Throwable $e) {
        // Fallback, falls random_bytes nicht verfügbar
        $_SESSION['csrf_token'] = bin2hex(openssl_random_pseudo_bytes(32));
    }
}
$isAuthenticated = isset($_SESSION['auth_user']) && $_SESSION['auth_user'];

// Wenn der Besucher angemeldet ist, nutze den Benutzernamen aus der Session.
if ($isAuthenticated && isset($_SESSION['auth_user']) && preg_match($usernameMatch, $_SESSION['auth_user'])) {
    $username = $_SESSION['auth_user'];
}

if ((empty($username) || !isset($username)) && isset($_COOKIE['username'])) {
    // Nur erlaubte Zeichen akzeptieren
    $cookieUser = preg_replace('/[^a-zA-Z0-9_-]/', '', $_COOKIE['username']);
    if ($cookieUser !== '' && preg_match($usernameMatch, $cookieUser)) {
        $username = $cookieUser;
    }
}

$userDir = $usersDir . '/' . $username;
$userPasswordFile = $userDir . '/.password';

// Versuche optionalen Anzeigenamen aus .settings zu laden (falls vorhanden)
$displayName = null;
$settingsFile = $userDir . '/.settings';
if (isset($username) && $username && is_dir($userDir) && file_exists($settingsFile)) {
    $raw = @file_get_contents($settingsFile);
    if ($raw !== false) {
        $decoded = json_decode($raw, true);

        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded) && isset($decoded['displayName']) && $decoded['displayName'] !== '') {
            $displayName = (string)$decoded['displayName'];
        }
    }
}

$isAdmin = isset($username) && in_array($username, $adminUsers);

// Invite-Token aus URL (evtl. vorhanden) – prüfe, ob ein Invite-File existiert
$inviteParam = $_GET['invite'] ?? '';
$safeInvite = preg_replace('/[^a-zA-Z0-9_-]/', '', $inviteParam);
$hasInvite = $safeInvite !== '' && file_exists($invitesDir . '/' . $safeInvite);

$listName = null;
foreach (array_keys($_GET) as $k) {
    if ($k !== 'user') {
        $listName = $k;
        break;
    }
}
if ($listName && !preg_match($filenameMatch, $listName)) {
    $listName = null; // Ungültige Namen ablehnen
}

$isSpeiseplan   = ($listName === $speiseplanName);
$cssSpeiseplan  = ($isSpeiseplan) ? 'class="speiseplan"' : '';
$listNameOutput = htmlspecialchars(
    str_replace(['_', '~'], [' ', '/'], $listName),
    ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5,
    'UTF-8'
);

// --- Stylesheet-Versionierung ---
$styleVersion  = file_exists(__DIR__ . '/links/style.css') ? date("Y-m-d_H-i-s", filemtime(__DIR__ . '/links/style.css')) : time();
$scriptVersion = file_exists(__DIR__ . '/bin/frontend.js') ? date("Y-m-d_H-i-s", filemtime(__DIR__ . '/bin/frontend.js')) : time();

// --- Dynamisches CSS für Speiseplan ---
$speiseplanCss = '';
if ($isSpeiseplan) {
    $currentHour = date('H');
    $startIndex = date('N') - 1; // Montag=0, Sonntag=6
    if ($currentHour >= 20) {
        $startIndex = ($startIndex + 1) % 7;
    }

    ob_start();
    echo "<style>\n";
    for ($i = 0; $i < 7; $i++) {
        $dayIndex = ($startIndex + $i) % 7;
        $dayAbbr = $dayNames[$dayIndex];
        $cssIndex = $i + 1;
        echo "        #itemList li.speiseplan:nth-of-type(7n+{$cssIndex}):before { content: '{$dayAbbr}';}\n";
        echo "        #itemList li.speiseplan:nth-of-type(7n+{$cssIndex}) { background: {$colors[$dayIndex]}; border-color: {$colorBorder[$dayIndex]}}\n";
    }
    echo "    </style>\n";
    $speiseplanCss = ob_get_clean();
}

$userHeadingText = 'Meine Zettel';
if (!empty($displayName)) {
    $safeDisplay = htmlspecialchars($displayName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    if (preg_match('/[sxzß]$/i', $displayName)) {
        $userHeadingText = $safeDisplay . "’ Zettel";
    } else {
        $userHeadingText = $safeDisplay . 's Zettel';
    }
} elseif (isset($username) && $username) {
    $safeUser = htmlspecialchars($username, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    if (preg_match('/[sxzß]$/i', $username)) {
        $userHeadingText = $safeUser . "’ Zettel";
    } else {
        $userHeadingText = $safeUser . 's Zettel';
    }
}

$specialMenuItems = '';
if ($isAdmin) {
    $specialMenuItems = '<hr><button id="menuCreateInvite" class="menu-item invite">Einladungslink erstellen</button>';
}
if (file_exists($userDir . '/history.txt')) {
    $specialMenuItems .= ($specialMenuItems === '') ? '<hr>' : '';
    $specialMenuItems .= '<button id="menuShowSpeiseplan" class="menu-item speiseplan">Speiseplanverlauf</button>';
}
// CSP-Nonce für erlaubte inline-Scripts erzeugen
try {
    $cspNonce = base64_encode(random_bytes(16));
} catch (Throwable $e) {
    $cspNonce = base64_encode(openssl_random_pseudo_bytes(16));
}

header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{$cspNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
?>
<!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="links/website.manifest.php" crossorigin="use-credentials">
    <link rel="stylesheet" href="links/style.css?<?= $styleVersion ?>">
    <link rel="icon" type="image/svg+xml" href="links/icon.svg" />
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="apple-touch-icon" href="links/apple-touch-icon.png">
    <title>Meinkaufszettel</title>
    <?= $speiseplanCss ?>
    <style>
        .help,
        .modal,
        #firstRunBanner {
            display: none;
        }
    </style>
</head>

<body class="<?= isset($_COOKIE['mode']) ? (($_COOKIE['mode'] === 'dark') ? 'dark' : 'light') : '' ?>">
    <div class="container">

        <div id="firstRunBanner"></div>

        <?php if ($hasInvite && !file_exists($userPasswordFile)): ?>
            <!-- Registrierung -->
            <div id="register">
                <span class="icon"></span>
                <h1>Erster Start</h1>
                <p class="hint">Willkommen beim <strong>Meinaufszettel</strong>. Wähle einen <strong>Benutzernamen</strong> und ein <strong>Passwort</strong> um das Benutzerkonto zu aktivieren. Die <strong>E-Mail</strong> wird ausschließlich verwendet, wenn du dein Passwort vergessen hast.</p>
                <div>
                    <form name="registerForm">
                        <input type="text" id="inviteInput" placeholder="Invite-Token (falls nicht per Link)" value="<?= htmlspecialchars($inviteParam) ?>">
                        <input type="text" id="registerUsername" placeholder="Benutzername (a-zA-Z0-9_-)">
                        <input type="password" id="passCode" placeholder="Passwort">
                        <input type="email" id="registerEmail" placeholder="E-Mail für Passwort-Zurücksetzen">
                        <button id="registerBtn" class="btn" type="button">Festlegen</button>
                    </form>
                </div>
            </div>
            <div id="login"></div>
            <div id="listOverview"></div>
            <div id="listElements"></div>
            <div id="listSpeiseplanHistory" class="speiseplan-history"></div>
            <div id="status"></div>
        <?php else: ?>

            <!-- Login -->
            <div id="login">
                <span class="icon"></span>
                <h1>Meinkaufszettel</h1>
                <div>
                    <form name="loginForm">
                        <input type="text" id="loginUsername" placeholder="Benutzername" autocomplete="username">
                        <input type="password" id="passCode" placeholder="Passwort" autocomplete="current-password">
                        <button id="loginBtn" class="btn" type="button">Anmelden</button>
                    </form>
                    <div class="forgot-pwd"><a href="reset_request.php" id="forgotPasswordLink">Passwort vergessen?</a></div>
                </div>
            </div>

            <!-- Übersicht -->
            <div id="listOverview">
                <span class="more" id="moreBtn" title="Mehr">⋯</span>
                <div id="moreMenu" class="more-menu" aria-hidden="true" role="navigation">
                    <button id="menuShowHelp" class="menu-item help">Kurzanleitung</button>
                    <hr>
                    <button id="menuChangeUsername" class="menu-item username">Benutzername ändern</button>
                    <button id="menuChangePassword" class="menu-item password">Passwort ändern</button>
                    <button id="menuChangeEMail" class="menu-item email">E-Mail ändern</button>
                    <button id="menuDarkMode" class="menu-item darkmode" aria-pressed="false">Design</button>
                    <?= $specialMenuItems ?>
                    <hr>
                    <button id="menuDataProtection" class="menu-item dataprodtection">Datenschutz</button>
                    <hr>
                    <button id="menuLogout" class="menu-item logout">Abmelden</button>
                </div>
                <span class="icon"></span>
                <h1 id="userNamesZettel"><?= $userHeadingText ?></h1>
                <div class="input-row">
                    <input type="text" id="newListItem" placeholder="Ich gehe zu ...">
                    <button id="addListItemBtn" class="btn">Hinzufügen</button>
                </div>
                <ul id="serverLists"></ul>
            </div>

            <!-- Einzelne Liste -->
            <div id="listElements">
                <span class="close" id="backBtn" title="zurück zur Übersicht"></span>
                <span id="syncIndicator" class="syncIndicator" title="Automatischer Sync" aria-hidden="true"></span>
                <span class="icon"></span>
                <h1 id="listName"><?= $listNameOutput ?></h1>
                <div class="input-row">
                    <input type="text" id="newItem" placeholder="Ich brauche ...">
                    <button id="addItemBtn" class="btn">Hinzufügen</button>
                </div>

                <ul id="itemList"></ul>
                <ul id="inactiveList" <?= $cssSpeiseplan ?>></ul>
                <div id="pyro" class="pyro">
                    <div class="before"></div>
                    <div class="after"></div>
                </div>
            </div>

            <!-- Verlauf Speiseplan -->
            <div id="listSpeiseplanHistory" class="speiseplan-history"  aria-hidden="true">
                <span class="close" id="speiseplanbackBtn" title="zurück zur Übersicht"></span>
                <span class="icon"></span>
                <h1>Speiseplanverlauf</h1>
                <ul id="itemListSpeiseplan"></ul>
            </div>

            <!-- Hilfetexte (Overlay/Modal) -->
            <div id="helpTexts" class="help" aria-hidden="true">
                <div class="help-inner" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
                    <button id="helpCloseBtn" class="modal-close" aria-label="Hilfe schließen">×</button>
                    <h2 id="helpTitle" class="modal-title">Kurzanleitung</h2>
                    <ul>
                        <li><strong>Neuen Zettel</strong> erstellen: Gib einen Namen im Feld „Ich gehe zu ...“ ein und klicke auf „Hinzufügen“.</li>
                        <li>Zettel <strong>teilen</strong>: Klick auf das Teilen-Symbol <span class="shareBtn btn"></span> und ein Link wird in die Zwischenablage gelegt. Sende ihn an einen anderen Benutzer um den Zettel gemeinsam zu benutzen. Mehrere Personen können die Liste gleichzeitig bearbeiten. Änderungen werden live synchronisiert. <span class="syncIndicator active btn"></span></li>
                        <li>Zettel/Eintrag <strong>umbenennen</strong>: Klicke auf das Stift-Symbol <span class="editBtn btn"></span>.</li>
                        <li>Zettel/Eintrag <strong>löschen</strong>: Klicke auf das Papierkorb-Symbol <span class="deleteBtn btn"></span> neben dem Namen.</li>
                        <li>Neuen <strong>Eintrag hinzufügen</strong>: Wähle einen Zettel aus der Übersicht, gib einen Eintrag im Feld „Ich brauche ...“ ein und klicke auf „Hinzufügen“.</li>
                        <li>Einträge <strong>sortieren</strong>: halte und ziehe die Einträge auf dem Symbol <span class="dragHandle btn"></span> ganz vorne noch oben oder unten. Listen werden immer nach dem Alphabet sortiert.</li>
                        <li>Eintrag <strong>abhaken</strong>: Klicke auf den Namen des Eintrags, um ihn als erledigt zu markieren.</li>
                        <li>Abgehakten Eintrag <strong>wieder aktivieren</strong>: Klicke auf den Eintrag, um ihn wieder zu aktivieren.</li>
                        <li><strong>Speiseplan</strong>: Ein Zettel mit den Namen 'Speiseplan' hat eine Sonderrolle. Einträge werden farblich und mit Wochentag markiert und der aktive Eintrag wird immer um 8 Uhr deaktiviert.</li>
                        <li><strong>Wichtige / Unwichtige Einträge</strong> kann man mit einem '!' oder einem '?' am Ende versehen.</li>
                        <p>Weitere Information und die aktuelle Version bei <a href="https://zenziwerken.github.io/Meinkaufszettel/">GitHub<span class="gitHubIcon"></span></a></p>
                    </ul>
                </div>
            </div>
            <!-- Statusanzeige -->
            <div id="status"></div>
            <input type="text" id="filename">

            <!-- Modal 'Passwort ändern' -->
            <div id="changePasswordModal" class="modal" aria-hidden="true" role="dialog" aria-modal="false">
                <div class="modal-inner">
                    <button id="closeChangePwd" class="modal-close" aria-label="Schließen">×</button>
                    <h2 class="modal-title">Passwort ändern</h2>
                    <div class="modal-body">
                        <form name="changePasswordForm">
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" class="visually-hidden-username" aria-hidden="true">
                            <input type="password" id="currentPassword" placeholder="Aktuelles Passwort" autocomplete="current-password">
                            <input type="password" id="newPassword" placeholder="Neues Passwort (mind. 6 Zeichen)" autocomplete="new-password">
                            <input type="password" id="newPasswordConfirm" placeholder="Neues Passwort wiederholen" autocomplete="new-password">
                            <div class="modal-actions">
                                <button id="cancelChangePasswordBtn" type="button" class="btn btn-danger">Abbrechen</button>
                                <button id="changePasswordBtn" type="button" class="btn btn-primary">Ändern</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Modal 'Benutzername ändern' -->
            <div id="changeUsernameModal" class="modal" aria-hidden="true" role="dialog" aria-modal="false">
                <div class="modal-inner">
                    <button id="closeChangeUser" class="modal-close" aria-label="Schließen">×</button>
                    <h2 class="modal-title">Benutzername ändern</h2>
                    <div class="modal-body">
                        <form id="changeUsernameForm">
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" class="visually-hidden-username" aria-hidden="true">
                            <label for="newUsername">Neuer Benutzername (Login, a-zA-Z0-9_-)</label>
                            <input type="text" id="newUsername" placeholder="Neuer Benutzername (a-zA-Z0-9_-)" autocomplete="username">
                            <input type="password" id="currentPasswordForUsername" placeholder="Aktuelles Passwort" autocomplete="current-password">
                            <div class="modal-actions">
                                <button id="cancelChangeUsernameBtn" type="button" class="btn btn-danger">Abbrechen</button>
                                <button id="changeUsernameBtn" type="button" class="btn btn-primary">Ändern</button>
                            </div>
                        </form>

                        <!-- Neues Formular: Anzeigename (freie Darstellung, keine Passwort-Bestätigung erforderlich) -->
                        <form id="changeDisplayNameForm">
                            <label for="newDisplayName">Anzeigename (beliebige Darstellung)</label>
                            <input type="text" id="newDisplayName" placeholder="Anzeigename (z. B. 'Max Mustermann')" autocomplete="name" value="<?= htmlspecialchars($displayName ?? '') ?>">
                            <div class="modal-actions">
                                <button id="cancelChangeDisplayNameBtn" type="button" class="btn btn-danger">Abbrechen</button>
                                <button id="changeDisplayNameBtn" type="button" class="btn btn-primary">Ändern</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Modal 'E-Mail ändern' -->
            <div id="changeEmailModal" class="modal" aria-hidden="true" role="dialog" aria-modal="false">
                <div class="modal-inner">
                    <button id="closeChangeEmail" class="modal-close" aria-label="Schließen">×</button>
                    <h2 class="modal-title">E-Mail ändern</h2>
                    <div class="modal-body">
                        <form name="changeEmailForm">
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" class="visually-hidden-username" aria-hidden="true">
                            <input type="email" id="newEmail" placeholder="Neue E-Mail-Adresse" autocomplete="email">
                            <input type="password" id="currentPasswordForEmail" placeholder="Aktuelles Passwort" autocomplete="current-password">
                            <div class="modal-actions">
                                <button id="cancelChangeEmailBtn" type="button" class="btn btn-danger">Abbrechen</button>
                                <button id="changeEmailBtn" type="button" class="btn btn-primary">Ändern</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Modal 'Datenschutz' -->
            <div id="dataProtectionModal" class="modal" aria-hidden="true" role="dialog" aria-modal="false">
                <div class="modal-inner">
                    <button id="closeDataProtection" class="modal-close" aria-label="Schließen">×</button>
                    <h2 class="modal-title">Datenschutz</h2>
                    <div class="modal-body">
                        <p>Lade alle Deine bei uns gespeicherten persönlichen Daten als strukturierte Dateien (JSON) herunter. Diese Funktion ermöglicht es, Deine Daten zu archivieren oder zu einem anderen Anbieter mitzunehmen.</p>
                        <button id="downloadUserDataBtn" type="button" class="btn btn-primary">Meine Daten herunterladen</button>
                        <p>Lösche Dein Benutzerkonto und alle damit verbundenen Daten dauerhaft von unserem System. Diese Aktion ist endgültig und kann nicht rückgängig gemacht werden.</p>
                        </p>
                        <p class="note warning"><strong>Wichtig:</strong> Nach der Löschung kannst du Dein Konto nicht wiederherstellen und verlierst den Zugang zu allen Inhalten. Geteilte Listen bleiben für andere Benutzer erhalten, bis der letzte Benutzer sie löscht.</p>
                        <button id="quitAccountBtn" type="button" class="btn btn-danger">Benutzerkonto löschen</button>
                    </div>
                </div>
            </div>

            <!-- Modal 'Account löschen' (Bestätigung mit Passwort) -->
            <div id="confirmDeleteModal" class="modal" aria-hidden="true" role="dialog" aria-modal="false">
                <div class="modal-inner">
                    <button id="closeConfirmDelete" class="modal-close" aria-label="Schließen">×</button>
                    <h2 class="modal-title">Benutzerkonto dauerhaft löschen</h2>
                    <div class="modal-body">
                        <p>Diese Aktion löscht Dein Benutzerkonto und alle zugehörigen Daten dauerhaft. Dies kann nicht rückgängig gemacht werden.</p>
                        <form name="confirmDeleteForm">
                            <label for="confirmDeletePassword">Aktuelles Passwort</label>
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" class="visually-hidden-username" aria-hidden="true">
                            <input id="confirmDeletePassword" type="password" autocomplete="current-password" placeholder="Ihr Passwort">
                            <div class="modal-actions">
                                <button id="cancelDeleteBtn" type="button" class="btn btn-primary">Abbrechen</button>
                                <button id="confirmDeleteBtn" type="button" class="btn btn-danger">Benutzerkonto löschen</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Modal zum Löschen einer Liste -->
            <div id="deleteListModal" class="modal" aria-hidden="true" role="dialog" aria-modal="false">
                <div class="modal-inner">
                    <button id="closeDeleteList" class="modal-close" aria-label="Schließen">×</button>
                    <h2 class="modal-title">Liste löschen</h2>
                    <div class="modal-body">
                        <p id="deleteListModalText">Möchten Sie die Liste <strong id="deleteListModalName"></strong> wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.</p>
                        <div class="modal-actions">
                            <button id="cancelDeleteListBtn" type="button" class="btn btn-primary">Abbrechen</button>
                            <button id="confirmDeleteListBtn" type="button" class="btn btn-danger">Liste löschen</button>
                        </div>
                    </div>
                </div>
            </div>
        <?php endif; ?>

    </div>
    <script nonce="<?= htmlspecialchars($cspNonce, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?>">

        // Theme initialisation and menu label are handled in bin/frontend.js

        const speiseplanName = <?= json_encode($speiseplanName) ?>;
        const csrfToken = <?= json_encode($_SESSION['csrf_token'] ?? '') ?>;
        const syncInterval = <?= $syncInterval ?> * 1000;
        const inactivityTimeout = <?= $inactivityTimeout ?> * 60 * 1000;
        const username = <?= json_encode($username) ?>;
        // optional: Invite-Token in der URL (für Registrierung verwendet)
        const inviteToken = new URLSearchParams(window.location.search).get('invite');

        // Prüfe First-Run-Status via Backend, um doppelten PHP-Code zu vermeiden.
        (function() {
            // Nur wenn nicht angemeldet
            try {
                if (username || inviteToken) return;
            } catch (e) {}

            fetch('bin/backend.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'firstRun'
                })
            }).then(res => res.json()).then(data => {
                if (!data || data.success !== true) return;
                if (data.firstRun && data.invite) {
                    const cont = document.getElementById('firstRunBanner');
                    if (!cont) return;
                    const token = String(data.invite || '').replace(/[^a-zA-Z0-9_-]/g, '');
                    cont.style.display = 'block';
                    cont.className = 'first-run-banner';
                    cont.innerHTML = '<strong>Installation erfolgreich.</strong><br><span>Klicke hier um das</span> <a href="?invite=' + encodeURIComponent(token) + '">erste Benutzerkonto  zu erstellen</a>';
                }
            }).catch(() => {});
        })();
    </script>
    <script src="bin/frontend.js?<?= $scriptVersion ?>"></script>
</body>

</html>