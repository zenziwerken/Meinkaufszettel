<?php
require __DIR__ . '/bin/config.php';
require __DIR__ . '/bin/helper.php';
if (session_status() === PHP_SESSION_NONE) session_start();



$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = isset($_POST['username']) ? trim((string)$_POST['username']) : '';

    // Server-seitiges Ratelimit (IP-basiert) bevor aufwändige Operationen ausgeführt werden
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (!checkRateLimit('reset_request_ip', $ip, $maxRequests, $timeWindow)) {
        header('Retry-After: ' . $timeWindow);
        // generische Meldung beibehalten (vermeidet User-Enumeration)
        $message = 'Wenn ein Konto existiert, wurde eine E-Mail mit einem Link versandt.';
    } else {
        if (!preg_match($usernameMatch, $username)) {
            // generische Meldung (vermeidet User-Enumeration)
            $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
        } else {
            $userDir = $usersDir . '/' . $username;
            // E-Mail-Adresse wird jetzt in .settings gespeichert
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
                        // Fallback: alte Installation könnte noch plain-text E-Mail enthalten
                        $emailRaw = trim($raw);
                    }
                }

                if ($emailRaw === '' || !filter_var($emailRaw, FILTER_VALIDATE_EMAIL)) {
                    $message = 'Wenn ein Konto existiert, schicken wir eine E-Mail mit einem Link.';
                } else {
                    // Stelle sicher, dass das Reset-Verzeichnis existiert
                    if (!is_dir($resetsDir) && !@mkdir($resetsDir, 0750, true)) {
                        $message = 'Server-Fehler.';
                    } else {
                        // Token
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

                            // URL erstellen
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
    <title>Passwort zurücksetzen</title>
</head>

<body>
    <div class="container">
        <div id="login">
            <span class="icon"></span>
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
        </div>
    </div>
</body>

</html>