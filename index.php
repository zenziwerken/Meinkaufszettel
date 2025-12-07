<?php
// index.php
require __DIR__ . '/bin/config.php';
// Session prüfen, um zu erkennen ob der Besucher bereits angemeldet ist
if (session_status() === PHP_SESSION_NONE) session_start();
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
if (isset($username) && $username) {
    $safeUser = htmlspecialchars($username, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    if (preg_match('/[sxz]$/i', $username)) {
        $userHeadingText = $safeUser . "' Zettel";
    } else {
        $userHeadingText = $safeUser . 's Zettel';
    }
}

$createInviteLink = '';
if ($isAdmin) {
    $createInviteLink = '<hr><button id="menuCreateInvite" class="menu-item">Einladungslink erstellen</button>';
}
?>
<!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="links/website.manifest" crossorigin="use-credentials">
    <link rel="stylesheet" href="links/style.css?<?= $styleVersion ?>">
    <link rel="icon" type="image/svg+xml" href="links/icon.svg" />
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="apple-touch-icon" href="links/apple-touch-icon.png">
    <title>Meinkaufszettel</title>
    <?= $speiseplanCss ?>
</head>

<body>
    <div class="container">

        <div id="firstRunBanner" style="display:none"></div>

        <?php if ($hasInvite && !file_exists($userPasswordFile)): ?>
            <!-- Registrierung -->
            <div id="register">
                <span class="icon"></span>
                <h1>Erster Start</h1>
                <p class="hint">Willkommen beim <strong>Meinaufszettel</strong>. Wähle einen <strong>Benutzernamen</strong> und ein <strong>Passwort</strong> um das Benutzerkonto zu aktivieren. Die <strong>E-Mail</strong> wird ausschließlich verwendet, wenn du dein Passwort vergessen hast.</p>
                <div>
                    <form>
                    <input type="text" id="inviteInput" placeholder="Invite-Token (falls nicht per Link)" value="<?= htmlspecialchars($inviteParam) ?>">
                    <input type="text" id="registerUsername" placeholder="Benutzername (a-zA-Z0-9_-)">
                    <input type="password" id="passCode" placeholder="Passwort">
                    <input type="email" id="registerEmail" placeholder="E-Mail für Passwort-Zurücksetzen">
                    <button id="registerBtn">Festlegen</button>
                </form>
                </div>
            </div>
            <div id="login"></div>
            <div id="listOverview"></div>
            <div id="listElements"></div>
            <div id="status"></div>
        <?php else: ?>

            <!-- Login -->
            <div id="login">
                <span class="icon"></span>
                <h1>Meinkaufszettel</h1>
                <div>
                    <form>
                        <input type="text" id="loginUsername" placeholder="Benutzername" autocomplete="username">
                        <input type="password" id="passCode" placeholder="Passwort" autocomplete="current-password">
                        <button id="loginBtn">Anmelden</button>
                    </form>
                    <div class="forgot-pwd"><a href="reset_request.php" id="forgotPasswordLink">Passwort vergessen?</a></div>
                </div>
            </div>

            <!-- Übersicht -->
            <div id="listOverview">
                <span class="more" id="moreBtn" title="Mehr">⋯</span>
                <div id="moreMenu" class="more-menu" aria-hidden="true">
                    <button id="menuShowHelp" class="menu-item">Kurzanleitung</button>
                    <hr>
                    <button id="menuChangeUsername" class="menu-item">Benutzername ändern</button>
                    <button id="menuChangePassword" class="menu-item">Passwort ändern</button>
                    <button id="menuChangeEMail" class="menu-item">E-Mail ändern</button>
                    <?= $createInviteLink ?>
                    <hr>
                    <button id="menuLogout" class="menu-item">Abmelden</button>
                </div>
                <span class="icon"></span>
                <h1 id="userNamesZettel"><?= $userHeadingText ?></h1>
                <div class="input-row">
                    <input type="text" id="newListItem" placeholder="Ich gehe zu ...">
                    <button id="addListItemBtn">Hinzufügen</button>
                </div>
                <ul id="serverLists"></ul>
            </div>

            <!-- Einzelne Liste -->
            <div id="listElements">
                <span class="close" id="backBtn" title="zurück zur Übersicht"></span>
                <span class="icon"></span>
                <h1 id="listName"><?= $listNameOutput ?></h1>
                <div class="input-row">
                    <input type="text" id="newItem" placeholder="Ich brauche ...">
                    <button id="addItemBtn">Hinzufügen</button>
                </div>

                <ul id="itemList"></ul>
                <ul id="inactiveList" <?= $cssSpeiseplan ?>></ul>
            </div>

            <!-- Hilfetexte (Overlay/Modal) -->
            <div id="helpTexts" class="help" aria-hidden="true">
                <div class="help-inner" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
                    <button id="helpCloseBtn" class="help-close" aria-label="Hilfe schließen">×</button>
                    <h2 id="helpTitle" class="modal-title">Kurzanleitung</h2>
                    <ul>
                        <li><strong>Neuen Zettel</strong> erstellen: Gib einen Namen im Feld „Ich gehe zu ...“ ein und klicke auf „Hinzufügen“.</li>
                        <li>Zettel <strong>teilen</strong>: Klick auf das Teilen-Symbol <span class="shareBtn btn"></span> und ein Link wird in die Zwischenablage gelegt. Sende ihn an einen anderen Benutzer um den Zettel gemeinsam zu benutzen. Mehrere Personen können die Liste gleichzeitig bearbeiten. Änderungen werden live synchronisiert.</li>
                        <li>Zettel/Eintrag <strong>umbenennen</strong>: Klicke auf das Stift-Symbol <span class="editBtn btn"></span>.</li>
                        <li>Zettel/Eintrag <strong>löschen</strong>: Klicke auf das Papierkorb-Symbol <span class="deleteBtn btn"></span> neben dem Namen.</li>
                        <li>Neuen <strong>Eintrag hinzufügen</strong>: Wähle einen Zettel aus der Übersicht, gib einen Eintrag im Feld „Ich brauche ...“ ein und klicke auf „Hinzufügen“.</li>
                        <li>Einträge <strong>sortieren</strong>: halte und ziehe die Einträge auf dem Symbol <span class="dragHandle btn"></span> ganz vorne noch oben oder unten. Listen werden immer nach dem Alphabet sortiert.</li>
                        <li>Eintrag <strong>abhaken</strong>: Klicke auf den Namen des Eintrags, um ihn als erledigt zu markieren.</li>
                        <li>Abgehakten Eintrag <strong>wieder aktivieren</strong>: Klicke auf den Eintrag, um ihn wieder zu aktivieren.</li>
                        <li><strong>Speiseplan</strong>: Ein Zettel mit den Namen 'Speiseplan' hat eine Sonderrolle. Einträge werden farblich und mit Wochentag markiert und der aktive Eintrag wird immer um 8 Uhr deaktiviert.</li>
                        <li><strong>Wichtige / Unwichtige Einträge</strong> kann man mit einem '!' oder einem '?' am Ende versehen.</li>
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
                        <form>
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" style="position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden;" aria-hidden="true">
                            <input type="password" id="currentPassword" placeholder="Aktuelles Passwort" autocomplete="current-password">
                            <input type="password" id="newPassword" placeholder="Neues Passwort (mind. 6 Zeichen)" autocomplete="new-password">
                            <input type="password" id="newPasswordConfirm" placeholder="Neues Passwort wiederholen" autocomplete="new-password">
                            <div class="modal-actions">
                                <button id="cancelChangePasswordBtn" type="button">Abbrechen</button>
                                <button id="changePasswordBtn" type="button">Ändern</button>
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
                        <form>
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" style="position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden;" aria-hidden="true">
                            <input type="text" id="newUsername" placeholder="Neuer Benutzername (a-zA-Z0-9_-)" autocomplete="username">
                            <input type="password" id="currentPasswordForUsername" placeholder="Aktuelles Passwort" autocomplete="current-password">
                            <div class="modal-actions">
                                <button id="cancelChangeUsernameBtn" type="button">Abbrechen</button>
                                <button id="changeUsernameBtn" type="button">Ändern</button>
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
                        <form>
                            <input type="text" name="username" autocomplete="username" value="<?= htmlspecialchars($username ?? '') ?>" tabindex="-1" style="position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden;" aria-hidden="true">
                            <input type="email" id="newEmail" placeholder="Neue E-Mail-Adresse" autocomplete="email">   
                            <input type="password" id="currentPasswordForEmail" placeholder="Aktuelles Passwort" autocomplete="current-password">
                            <div class="modal-actions">
                                <button id="cancelChangeEmailBtn" type="button">Abbrechen</button>
                                <button id="changeEmailBtn" type="button">Ändern</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

        <?php endif; ?>

    </div>
    <script>
        const speiseplanName = <?= json_encode($speiseplanName) ?>;
        const syncInterval = <?= $syncInterval ?>;
        const inactivityTimeoutMs = <?= $inactivityTimeoutMs ?>;
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
                    cont.style.display = '';
                    cont.className = 'first-run-banner';
                    cont.innerHTML = '<strong>Installation erfolgreich.</strong><br><span>Klicke hier um den</span> <a href="?invite=' + encodeURIComponent(token) + '">ersten Account zu erstellen</a>';
                }
            }).catch(() => {});
        })();
    </script>
    <script src="bin/frontend.js?<?= $scriptVersion ?>"></script>
</body>

</html>