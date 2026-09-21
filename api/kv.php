<?php
/* ===== Yara Glow — internal SQLite key-value API =====
   Stores all site data (services, settings, gallery, users, bookings)
   in an internal SQLite database on your own hosting (Hostinger).
   No external service is used. */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// --- open / create the SQLite database ---
$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) { @mkdir($dataDir, 0775, true); }
$dbFile = $dataDir . '/yara.sqlite';

try {
  $db = new PDO('sqlite:' . $dbFile);
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec('CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )');
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(['error' => 'db_open_failed', 'message' => $e->getMessage()]);
  exit;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $key = isset($_GET['key']) ? $_GET['key'] : null;
  if ($key !== null) {
    $st = $db->prepare('SELECT key, value FROM kv WHERE key = ?');
    $st->execute([$key]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  } else {
    $rows = $db->query('SELECT key, value FROM kv')->fetchAll(PDO::FETCH_ASSOC);
  }
  $out = [];
  foreach ($rows as $r) {
    $out[] = ['key' => $r['key'], 'value' => json_decode($r['value'], true)];
  }
  echo json_encode($out, JSON_UNESCAPED_UNICODE);
  exit;
}

if ($method === 'POST') {
  $raw = file_get_contents('php://input');
  $body = json_decode($raw, true);
  if ($body === null) { http_response_code(400); echo json_encode(['error' => 'invalid_json']); exit; }
  // accept a single {key,value} or an array of them
  if (isset($body['key'])) { $body = [$body]; }
  if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'invalid_body']); exit; }

  $st = $db->prepare('INSERT INTO kv (key, value, updated_at) VALUES (:k, :v, :u)
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  $now = gmdate('c');
  $count = 0;
  foreach ($body as $item) {
    if (!isset($item['key'])) { continue; }
    $st->execute([
      ':k' => $item['key'],
      ':v' => json_encode(isset($item['value']) ? $item['value'] : null, JSON_UNESCAPED_UNICODE),
      ':u' => $now,
    ]);
    $count++;
  }
  echo json_encode(['ok' => true, 'saved' => $count]);
  exit;
}

http_response_code(405);
echo json_encode(['error' => 'method_not_allowed']);
