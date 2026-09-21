/* ===== Yara Glow — Internal Sync (PHP + SQLite) =====
   Shares all data (services, settings, gallery, users, bookings) across every
   browser and device through an internal SQLite database on your own hosting
   (api/kv.php). LocalStorage is a fast local cache; the SQLite database is the
   source of truth. If the API is unreachable (e.g. opening the files directly
   without a PHP server), the app keeps working from the local cache. */
window.YaraCloud = (function () {
  "use strict";

  // relative to the site root — works on Hostinger where index.html/admin.html live
  const API = "api/kv.php";

  // keys mirrored to the database
  const KEYS = ["yaraGlowServices", "yaraGlowSettings", "yaraGlowGallery", "yaraGlowUsers", "yaraGlowBookingsV2"];

  let online = false;

  // Pull every key from the database into localStorage. Returns the set of keys present.
  async function pull() {
    try {
      const r = await fetch(API, { headers: { "Accept": "application/json" }, cache: "no-store" });
      if (!r.ok) throw new Error("pull " + r.status);
      const rows = await r.json();
      online = true;
      const present = {};
      (rows || []).forEach((row) => {
        present[row.key] = true;
        try { localStorage.setItem(row.key, JSON.stringify(row.value)); } catch (e) {}
      });
      return present;
    } catch (e) { online = false; return null; }
  }

  // Upsert one key's current localStorage value to the database.
  async function push(key) {
    let value;
    try { value = JSON.parse(localStorage.getItem(key)); } catch (e) { value = undefined; }
    if (value === undefined || value === null) return false;
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key, value: value }),
      });
      online = r.ok;
      return r.ok;
    } catch (e) { online = false; return false; }
  }

  async function pushAll() {
    let ok = true;
    for (const k of KEYS) { const r = await push(k); ok = ok && (r || localStorage.getItem(k) === null); }
    return ok;
  }

  // First-run sync: pull the database, then push any local keys it is missing
  // (so the very first deployment seeds the database with defaults).
  async function bootstrap(ensureLocal) {
    const present = await pull();
    if (typeof ensureLocal === "function") ensureLocal(); // seed local defaults if empty
    if (present) {
      for (const k of KEYS) {
        if (!present[k] && localStorage.getItem(k) != null) await push(k);
      }
    }
    return online;
  }

  function isOnline() { return online; }

  return { pull, push, pushAll, bootstrap, isOnline, KEYS, API };
})();
