<?php
/* ===== Yara Glow — Authentication API (PHP + SQLite) =====
   Username/password login with hashed passwords and session tokens.
   Supports an owner account plus additional admins with limited permissions. */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) { @mkdir($dataDir, 0775, true); }
$dbFile = $dataDir . '/yara.sqlite';

try {
  $db = new PDO('sqlite:' . $dbFile);
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec('CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT "admin",
    perms TEXT NOT NULL DEFAULT "{}",
    created_at TEXT
  )');
  $db->exec('CREATE TABLE IF NOT EXISTS admin_tokens (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT
  )');
} catch (Exception $e) {
  http_response_code(500); echo json_encode(['error' => 'db_open_failed']); exit;
}

// --- seed default owner on first run ---
$cnt = (int)$db->query('SELECT COUNT(*) FROM admins')->fetchColumn();
if ($cnt === 0) {
  $st = $db->prepare('INSERT INTO admins (username, pass_hash, role, perms, created_at) VALUES (?,?,?,?,?)');
  $st->execute([
    'admin',
    password_hash('yara2026', PASSWORD_DEFAULT),
    'owner',
    json_encode(['bookings'=>true,'services'=>true,'gallery'=>true,'settings'=>true,'manageAdmins'=>true]),
    gmdate('c'),
  ]);
}

function body() { $b = json_decode(file_get_contents('php://input'), true); return is_array($b) ? $b : []; }
function out($x) { echo json_encode($x, JSON_UNESCAPED_UNICODE); exit; }
function fail($msg, $code = 400) { http_response_code($code); out(['ok' => false, 'error' => $msg]); }

function fullPerms() { return ['bookings'=>true,'services'=>true,'gallery'=>true,'settings'=>true,'manageAdmins'=>true]; }
function normPerms($p, $role) {
  if ($role === 'owner') return fullPerms();
  $keys = ['bookings','services','gallery','settings','manageAdmins'];
  $out = [];
  foreach ($keys as $k) { $out[$k] = !empty($p[$k]); }
  return $out;
}
function publicUser($row) {
  return ['username' => $row['username'], 'role' => $row['role'], 'perms' => json_decode($row['perms'], true) ?: []];
}
function userByToken($db, $token) {
  if (!$token) return null;
  $st = $db->prepare('SELECT a.* FROM admin_tokens t JOIN admins a ON a.username = t.username WHERE t.token = ?');
  $st->execute([$token]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return $r ?: null;
}

$b = body();
$action = isset($b['action']) ? $b['action'] : '';

if ($action === 'login') {
  $u = trim($b['username'] ?? '');
  $p = (string)($b['password'] ?? '');
  $st = $db->prepare('SELECT * FROM admins WHERE username = ?');
  $st->execute([$u]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row || !password_verify($p, $row['pass_hash'])) fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
  $token = bin2hex(random_bytes(24));
  $db->prepare('INSERT INTO admin_tokens (token, username, created_at) VALUES (?,?,?)')
     ->execute([$token, $row['username'], gmdate('c')]);
  out(['ok' => true, 'token' => $token, 'user' => publicUser($row)]);
}

if ($action === 'me') {
  $row = userByToken($db, $b['token'] ?? '');
  if (!$row) fail('انتهت الجلسة', 401);
  out(['ok' => true, 'user' => publicUser($row)]);
}

if ($action === 'logout') {
  $db->prepare('DELETE FROM admin_tokens WHERE token = ?')->execute([$b['token'] ?? '']);
  out(['ok' => true]);
}

if ($action === 'changePassword') {
  $row = userByToken($db, $b['token'] ?? '');
  if (!$row) fail('انتهت الجلسة', 401);
  if (!password_verify((string)($b['oldPassword'] ?? ''), $row['pass_hash'])) fail('كلمة المرور الحالية غير صحيحة');
  $new = (string)($b['newPassword'] ?? '');
  if (strlen($new) < 4) fail('كلمة المرور الجديدة قصيرة جداً');
  $db->prepare('UPDATE admins SET pass_hash = ? WHERE username = ?')
     ->execute([password_hash($new, PASSWORD_DEFAULT), $row['username']]);
  out(['ok' => true]);
}

// --- admin management (requires manageAdmins) ---
function requireManager($db, $b) {
  $row = userByToken($db, $b['token'] ?? '');
  if (!$row) fail('انتهت الجلسة', 401);
  $perms = json_decode($row['perms'], true) ?: [];
  if ($row['role'] !== 'owner' && empty($perms['manageAdmins'])) fail('لا تملك صلاحية إدارة المشرفين', 403);
  return $row;
}

if ($action === 'admins.list') {
  requireManager($db, $b);
  $rows = $db->query('SELECT username, role, perms FROM admins ORDER BY created_at')->fetchAll(PDO::FETCH_ASSOC);
  out(['ok' => true, 'admins' => array_map('publicUser', $rows)]);
}

if ($action === 'admins.create') {
  requireManager($db, $b);
  $u = trim($b['username'] ?? '');
  $p = (string)($b['password'] ?? '');
  if ($u === '' || strlen($p) < 4) fail('اسم مستخدم صالح وكلمة مرور (4 أحرف فأكثر) مطلوبة');
  $exists = $db->prepare('SELECT 1 FROM admins WHERE username = ?'); $exists->execute([$u]);
  if ($exists->fetch()) fail('اسم المستخدم موجود مسبقاً');
  $role = ($b['role'] ?? 'admin') === 'owner' ? 'owner' : 'admin';
  $perms = json_encode(normPerms($b['perms'] ?? [], $role), JSON_UNESCAPED_UNICODE);
  $db->prepare('INSERT INTO admins (username, pass_hash, role, perms, created_at) VALUES (?,?,?,?,?)')
     ->execute([$u, password_hash($p, PASSWORD_DEFAULT), $role, $perms, gmdate('c')]);
  out(['ok' => true]);
}

if ($action === 'admins.update') {
  $mgr = requireManager($db, $b);
  $u = trim($b['username'] ?? '');
  $st = $db->prepare('SELECT * FROM admins WHERE username = ?'); $st->execute([$u]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row) fail('المستخدم غير موجود');
  $role = isset($b['role']) ? (($b['role'] === 'owner') ? 'owner' : 'admin') : $row['role'];
  if (isset($b['perms']) || isset($b['role'])) {
    $perms = json_encode(normPerms($b['perms'] ?? (json_decode($row['perms'], true) ?: []), $role), JSON_UNESCAPED_UNICODE);
    $db->prepare('UPDATE admins SET role = ?, perms = ? WHERE username = ?')->execute([$role, $perms, $u]);
  }
  if (!empty($b['newPassword'])) {
    if (strlen((string)$b['newPassword']) < 4) fail('كلمة المرور الجديدة قصيرة جداً');
    $db->prepare('UPDATE admins SET pass_hash = ? WHERE username = ?')
       ->execute([password_hash((string)$b['newPassword'], PASSWORD_DEFAULT), $u]);
  }
  out(['ok' => true]);
}

if ($action === 'admins.delete') {
  $mgr = requireManager($db, $b);
  $u = trim($b['username'] ?? '');
  if ($u === $mgr['username']) fail('لا يمكنك حذف حسابك الحالي');
  $owners = (int)$db->query('SELECT COUNT(*) FROM admins WHERE role = "owner"')->fetchColumn();
  $target = $db->prepare('SELECT role FROM admins WHERE username = ?'); $target->execute([$u]);
  $trow = $target->fetch(PDO::FETCH_ASSOC);
  if ($trow && $trow['role'] === 'owner' && $owners <= 1) fail('لا يمكن حذف المالك الوحيد');
  $db->prepare('DELETE FROM admins WHERE username = ?')->execute([$u]);
  $db->prepare('DELETE FROM admin_tokens WHERE username = ?')->execute([$u]);
  out(['ok' => true]);
}

fail('إجراء غير معروف', 400);
