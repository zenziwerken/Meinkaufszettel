<?php
require __DIR__ . '/bin/config.php';
require __DIR__ . '/bin/helper.php';
if (session_status() === PHP_SESSION_NONE) session_start();

$error = '';
$success = '';


$token = isset($_GET['token']) ? trim((string)$_GET['token']) : (isset($_POST['token']) ? trim((string)$_POST['token']) : '');
if ($token === '') {
    $error = 'Token fehlt.';
} else {
    $safeToken = preg_replace('/[^a-zA-Z0-9]/', '', $token);
    $tokenFile = $resetsDir . '/' . $safeToken;
    if (!file_exists($tokenFile)) {
        $error = 'Ungültiger oder abgelaufener Link.';
    } else {
        $raw = @file_get_contents($tokenFile);
        $info = $raw ? json_decode($raw, true) : null;
        if (!is_array($info) || !isset($info['username']) || !isset($info['expiresAt'])) {
            $error = 'Ungültiger Token.';
        } elseif (time() > (int)$info['expiresAt']) {
            @unlink($tokenFile);
            $error = 'Der Link ist abgelaufen.';
        } else {
            $username = $info['username'];
            $userDir = $usersDir . '/' . $username;
            $userPasswordFile = $userDir . '/.password';

            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                // Server-seitiges Ratelimit für das Setzen eines neuen Passworts (IP-basiert)
                $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
                if (!checkRateLimit('reset_set_ip', $ip, $maxRequests, $timeWindow)) {
                    header('Retry-After: ' . $timeWindow);
                    $error = 'Zu viele Versuche. Bitte warten.';
                } else {
                    $p1 = isset($_POST['password']) ? (string)$_POST['password'] : '';
                    $p2 = isset($_POST['password_confirm']) ? (string)$_POST['password_confirm'] : '';
                    if ($p1 === '' || $p2 === '') {
                        $error = 'Bitte beide Passwortfelder ausfüllen.';
                    } elseif ($p1 !== $p2) {
                        $error = 'Passwörter stimmen nicht überein.';
                    } elseif (strlen($p1) < 6) {
                        $error = 'Neues Passwort ist zu kurz (mindestens 6 Zeichen).';
                    } else {
                        $hash = password_hash($p1, PASSWORD_DEFAULT);
                        if ($hash === false) {
                            $error = 'Server-Fehler beim Hashing.';
                        } else {
                            if (!atomicWrite($userPasswordFile, $hash)) {
                                $error = 'Konnte Passwort nicht speichern.';
                            } else {
                                @chmod($userPasswordFile, 0640);
                                // Token löschen
                                @unlink($tokenFile);
                                // Tokens des Users invalidieren (sessions)
                                $tokenDir = $userDir . '/tokens';
                                if (is_dir($tokenDir)) {
                                    $files = glob($tokenDir . '/*');
                                    if ($files !== false) foreach ($files as $f) if (is_file($f)) @unlink($f);
                                }
                                $success = 'Passwort wurde zurückgesetzt. Bitte melde dich mit dem neuen Passwort an.';
                            }
                        }
                    }
                }
            }
        }
    }
}
?>
<?php
// Stylesheet-Versionierung (falls vorhanden)
$styleVersion = file_exists(__DIR__ . '/links/style.css') ? date("Y-m-d_H-i-s", filemtime(__DIR__ . '/links/style.css')) : time();
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="manifest" href="links/website.manifest" crossorigin="use-credentials">
    <link rel="stylesheet" href="links/style.css?<?= $styleVersion ?>">
    <link rel="icon" type="image/svg+xml" href="links/icon.svg" />
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="apple-touch-icon" href="links/apple-touch-icon.png">
    <title>Neues Passwort setzen</title>
</head>
<body>
    <div class="container">
        <div id="login">
            <span class="icon"></span>
            <h1>Neues Passwort</h1>
            <?php if ($error !== ''): ?>
                <p class="error"><?= htmlspecialchars($error, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></p>
            <?php endif; ?>
            <?php if ($success !== ''): ?>
                <p class="success"><?= htmlspecialchars($success, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></p>
                <p><a href="index.php">Zur Anmeldung</a></p>
            <?php elseif ($error === ''): ?>
                <form method="post" action="" class="reset-form">
                    <input type="hidden" name="token" value="<?= htmlspecialchars($safeToken, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?>">
                            <input id="password" name="password" type="password" required minlength="6" placeholder="Neues Passwort">
                            <input id="password_confirm" name="password_confirm" type="password" required minlength="6" placeholder="Passwort wiederholen">
                        <button type="submit">Passwort setzen</button>
                        <div class="back-link">
                            <a href="./">Zurück zur Anmeldung</a>
                        </div>
                </form>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>
