/* ===== Yara Glow — Admin Dashboard Logic ===== */
(function () {
  "use strict";

  /* ---------- Config ---------- */
  // ⚠️ كلمة مرور بسيطة للحماية من طرف العميل. غيّريها قبل النشر.
  //    (لحماية حقيقية استخدمي حماية على مستوى الخادم أو .htpasswd في Hostinger)
  const ADMIN_PASSWORD = "yara2026";
  const AUTH_KEY = "yaraGlowAdminAuth";
  const STORAGE_KEY = "yaraGlowBookingsV2";

  const STATUSES = [
    { id: "new",       label: "جديد" },
    { id: "confirmed", label: "مؤكد" },
    { id: "completed", label: "مكتمل" },
    { id: "cancelled", label: "ملغى" },
  ];
  const statusLabel = (id) => (STATUSES.find((s) => s.id === id) || { label: id }).label;

  const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const AR_DOW = ["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"];

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, "0");
  const minToLabel = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };

  function parseKey(dk) { const [y, m, d] = dk.split("-").map(Number); return new Date(y, m - 1, d); }
  function formatDateAr(dk) { const d = parseKey(dk); return `${AR_DOW[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

  /* ---------- Data (LocalStorage as DB) ---------- */
  function getBookings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function setStatus(id, status) {
    const list = getBookings();
    const rec = list.find((b) => b.id === id);
    if (rec) { rec.status = status; rec.updatedAt = new Date().toISOString(); saveAll(list); }
  }

  /* ---------- Auth ---------- */
  function isAuthed() {
    try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
  }
  function showDashboard() {
    // Use inline styles so this works even if an old cached admin.css is loaded.
    const login = $("#loginScreen");
    const shell = $("#adminShell");
    login.hidden = true; login.style.display = "none";
    shell.hidden = false; shell.style.display = "block";
    initDashboard();
  }
  function initAuth() {
    if (isAuthed()) { showDashboard(); return; }

    $("#loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const val = $("#loginPass").value;
      if (val === ADMIN_PASSWORD) {
        try { sessionStorage.setItem(AUTH_KEY, "1"); } catch (err) {}
        $("#loginError").hidden = true;
        showDashboard();
      } else {
        $("#loginError").hidden = false;
        $("#loginPass").value = "";
        $("#loginPass").focus();
      }
    });
  }

  /* ---------- Dashboard ---------- */
  let dashboardReady = false;

  function initDashboard() {
    if (dashboardReady) { render(); return; }
    dashboardReady = true;

    // populate provider filter from existing bookings
    const providers = Array.from(new Set(getBookings().map((b) => b.provider))).sort();
    const sel = $("#fProvider");
    providers.forEach((p) => {
      const o = document.createElement("option");
      o.value = p; o.textContent = p; sel.appendChild(o);
    });

    $("#fDay").addEventListener("change", render);
    $("#fProvider").addEventListener("change", render);
    $("#fStatus").addEventListener("change", render);
    $("#btnClearFilters").addEventListener("click", () => {
      $("#fDay").value = ""; $("#fProvider").value = ""; $("#fStatus").value = ""; render();
    });
    $("#btnLogout").addEventListener("click", () => {
      try { sessionStorage.removeItem(AUTH_KEY); } catch (e) {}
      location.reload();
    });

    render();
  }

  function applyFilters(list) {
    const day = $("#fDay").value;             // yyyy-mm-dd or ""
    const prov = $("#fProvider").value;
    const st = $("#fStatus").value;
    return list.filter((b) =>
      (!day || b.dateKey === day) &&
      (!prov || b.provider === prov) &&
      (!st || b.status === st)
    );
  }

  // sort by nearest appointment first (upcoming ascending), past ones after
  function sortByNearest(list) {
    const now = Date.now();
    const ts = (b) => parseKey(b.dateKey).getTime() + b.start * 60000;
    return list.slice().sort((a, b) => {
      const ta = ts(a), tb = ts(b);
      const aPast = ta < now, bPast = tb < now;
      if (aPast !== bPast) return aPast ? 1 : -1;   // upcoming before past
      return aPast ? tb - ta : ta - tb;             // upcoming asc, past desc
    });
  }

  function renderStats() {
    const all = getBookings();
    const tk = todayKey();
    const todayCount = all.filter((b) => b.dateKey === tk && b.status !== "cancelled").length;
    const active = all.filter((b) => b.status !== "cancelled");
    const upcoming = active.filter((b) => parseKey(b.dateKey).getTime() + b.start * 60000 >= Date.now()).length;
    const byStatus = (s) => all.filter((b) => b.status === s).length;

    $("#statsRow").innerHTML = `
      <div class="stat-card today"><div class="stat-value">${todayCount}</div><div class="stat-label">مواعيد اليوم</div></div>
      <div class="stat-card"><div class="stat-value">${upcoming}</div><div class="stat-label">مواعيد قادمة</div></div>
      <div class="stat-card confirmed"><div class="stat-value">${byStatus("confirmed")}</div><div class="stat-label">مؤكدة</div></div>
      <div class="stat-card completed"><div class="stat-value">${byStatus("completed")}</div><div class="stat-label">مكتملة</div></div>
      <div class="stat-card cancelled"><div class="stat-value">${byStatus("cancelled")}</div><div class="stat-label">ملغاة</div></div>
    `;
  }

  function bookingCardHTML(b) {
    const actions = STATUSES.map((s) =>
      `<button class="status-btn ${b.status === s.id ? "active" : ""}" data-id="${b.id}" data-status="${s.id}">${s.label}</button>`
    ).join("");
    const phone = b.phone ? ` · <span>📞 ${b.phone}</span>` : "";
    return `
      <article class="booking-card st-${b.status}">
        <div class="bk-main">
          <div class="bk-top">
            <span class="bk-time">${minToLabel(b.start)} — ${minToLabel(b.end)}</span>
            <span class="bk-date">${formatDateAr(b.dateKey)}</span>
            <span class="badge-status st-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="bk-service">${b.serviceName}</div>
          <div class="bk-meta">
            <span>العميلة: <b>${b.name || "—"}</b></span>
            <span>المزوّدة: <b>${b.provider}</b></span>
            <span>المدة: <b>${b.duration} دقيقة</b></span>
            <span>السعر: <b>₪ ${b.price}</b></span>${phone}
          </div>
        </div>
        <div class="bk-actions">${actions}</div>
      </article>`;
  }

  function render() {
    renderStats();
    const list = sortByNearest(applyFilters(getBookings()));
    const box = $("#bookingsList");
    const empty = $("#emptyState");

    if (!list.length) {
      box.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    box.innerHTML = list.map(bookingCardHTML).join("");

    $$(".status-btn", box).forEach((btn) =>
      btn.addEventListener("click", () => {
        setStatus(btn.dataset.id, btn.dataset.status);
        render();
      })
    );
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", initAuth);
})();
