<?php
require __DIR__ . '/bin/config.php';
require __DIR__ . '/bin/helper.php';
if (session_status() === PHP_SESSION_NONE) session_start();

// Stylesheet-Versionierung
$styleVersion = file_exists(__DIR__ . '/links/style.css') ? date("Y-m-d_H-i-s", filemtime(__DIR__ . '/links/style.css')) : time();

$message = '';
$error = '';
$success = '';
$isTokenPage = false;
$token = '';

// Prüfen ob Token vorhanden ist (GET oder POST)
if (isset($_GET['token']) || isset($_POST['token'])) {
    $isTokenPage = true;
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
                
                // Passwort zurücksetzen (POST)
                if ($_SERVER['REQUEST_METHOD'] === 'POST') {
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
                                    @unlink($tokenFile);
                                    
                                    $tokenDir = $userDir . '/tokens';
                                    if (is_dir($tokenDir)) {
                                        $files = glob($tokenDir . '/*');
                                        if ($files !== false) {
                                            foreach ($files as $f) {
                                                if (is_file($f)) @unlink($f);
                                            }
                                        }
                                    }
                                    $success = 'Passwort wurde zurückgesetzt.<br/>Bitte melde dich mit dem neuen Passwort an.';
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} 
// Formular für Passwort-Reset anfordern (POST)
elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = isset($_POST['username']) ? trim((string)$_POST['username']) : '';
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    
    if (!checkRateLimit('reset_request_ip', $ip, $maxRequests, $timeWindow)) {
        header('Retry-After: ' . $timeWindow);
        $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
    } else {
        if (!preg_match($usernameMatch, $username)) {
            $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
        } else {
            $userDir = $usersDir . '/' . $username;
            $emailFile = $userDir . '/.settings';
            
            if (!is_dir($userDir) || !file_exists($emailFile)) {
                $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
            } else {
                $emailRaw = '';
                $raw = @file_get_contents($emailFile);
                
                if ($raw !== false) {
                    $decoded = json_decode($raw, true);
                    if (json_last_error() === JSON_ERROR_NONE && is_array($decoded) && isset($decoded['email'])) {
                        $emailRaw = trim((string)$decoded['email']);
                    } else {
                        $emailRaw = trim($raw);
                    }
                }
                
                if ($emailRaw === '' || !filter_var($emailRaw, FILTER_VALIDATE_EMAIL)) {
                    $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
                } else {
                    if (!is_dir($resetsDir) && !@mkdir($resetsDir, 0750, true)) {
                        $message = 'Server-Fehler.';
                    } else {
                        $token = bin2hex(random_bytes(32));
                        $safeToken = preg_replace('/[^a-zA-Z0-9]/', '', $token);
                        $tokenFile = $resetsDir . '/' . $safeToken;
                        $payload = json_encode([
                            'username' => $username,
                            'createdAt' => time(),
                            'expiresAt' => time() + (int)$resetTokenExpiry
                        ], JSON_UNESCAPED_UNICODE);
                        
                        if (@file_put_contents($tokenFile, $payload, LOCK_EX) === false) {
                            $message = 'Server-Fehler beim Erzeugen des Tokens.';
                        } else {
                            @chmod($tokenFile, 0640);
                            
                            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
                            $safeHost = filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME);
                            if (!$safeHost) {
                                $safeHost = 'localhost';
                            }
                            $base = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\');
                            $url = $scheme . '://' . $safeHost . $base . '/reset.php?token=' . $safeToken;
                            
                            $to = $emailRaw;
                            $subject = 'Passwort zurücksetzen';
                            $body = "Hallo $username,\n\n" .
                                "Es wurde eine Anfrage zum Zurücksetzen des Passworts gestellt.\n" .
                                "Wenn du das warst, öffne bitte den folgenden Link und lege ein neues Passwort fest:\n\n" .
                                "$url\n\n" .
                                "Der Link ist für eine Stunde gültig.\n\n" .
                                "Wenn du diese Anfrage nicht gestellt hast, ignoriere diese Nachricht.";
                            $headers = 'From: no-reply@' . $safeHost . "\r\n" . 'Content-Type: text/plain; charset=utf-8';
                            @mail($to, $subject, $body, $headers);
                            
                            $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
                        }
                    }
                }
            }
        }
    }
}
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
    <title><?= $isTokenPage ? 'Neues Passwort setzen' : 'Passwort zurücksetzen' ?></title>
</head>
<body>
    <div class="container">
        <div id="login">
            <span class="icon"></span>
            
            <?php if ($isTokenPage): ?>
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
            <?php else: ?>
                <h1>Passwort zurücksetzen</h1>
                <?php if ($message !== ''): ?>
                    <p><?= htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></p>
                <?php endif; ?>
                <form method="post" action="" class="reset-form">
                    <div class="input-row">
                        <input id="username" name="username" type="text" required pattern="[a-zA-Z0-9_-]+" placeholder="Benutzername">
                        <button type="submit">Link anfordern</button>
                    </div>
                    <div class="back-link">
                        <a href="./">Zurück zur Anmeldung</a>
                    </div>
                </form>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>