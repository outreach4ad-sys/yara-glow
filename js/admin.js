/* ===== Yara Glow — Admin Dashboard Logic ===== */
(function () {
  "use strict";

  /* ---------- Config ---------- */
  const AUTH_API = "api/auth.php";
  const SESSION_KEY = "yaraGlowSession";
  const STORAGE_KEY = "yaraGlowBookingsV2";
  let currentUser = null;   // { username, role, perms }
  let authToken = null;
  const fullPerms = () => ({ bookings: true, services: true, gallery: true, settings: true, manageAdmins: true });
  const can = (k) => !!(currentUser && (currentUser.role === "owner" || (currentUser.perms && currentUser.perms[k])));
  const OLD_KEY = "yaraGlowBookings";
  const NOTIFIED_KEY = "yaraGlowLastNotified";

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
  const esc = (str) => String(str == null ? "" : str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");

  const SVG = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICONS = {
    bell: SVG('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    calendar: SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    image: SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    scissors: SVG('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>'),
    user: SVG('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  };

  function parseKey(dk) { const [y, m, d] = dk.split("-").map(Number); return new Date(y, m - 1, d); }
  function formatDateAr(dk) { const d = parseKey(dk); return `${AR_DOW[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

  /* ---------- Bookings data (LocalStorage) ---------- */
  function getBookings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
    if (window.YaraData) window.YaraData.cloudPush(STORAGE_KEY);
  }
  function patchBooking(id, patch) {
    const list = getBookings();
    const rec = list.find((b) => b.id === id);
    if (rec) { Object.assign(rec, patch, { updatedAt: new Date().toISOString() }); saveAll(list); }
    return rec;
  }

  function migrateLegacy() {
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem(OLD_KEY)); } catch (e) { return; }
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return;
    const current = getBookings();
    let added = 0;
    Object.keys(legacy).forEach((key) => {
      const idx = key.lastIndexOf("_");
      const dk = idx > -1 ? key.slice(0, idx) : key;
      const provider = idx > -1 ? key.slice(idx + 1) : "—";
      (legacy[key] || []).forEach(([start, end]) => {
        current.push({ id: "legacy_" + dk + "_" + start, serviceId: "", serviceName: "حجز (نسخة سابقة)",
          provider, dateKey: dk, start, end, duration: end - start, price: 0,
          name: "—", phone: "", status: "new", seen: true, archived: false, createdAt: new Date().toISOString() });
        added++;
      });
    });
    if (added) { saveAll(current); try { localStorage.removeItem(OLD_KEY); } catch (e) {} }
  }

  /* ---------- Auth (username/password via api/auth.php) ---------- */
  async function authFetch(payload) {
    try {
      const r = await fetch(AUTH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, offline: true, data: null }; }
  }
  function saveSession(sess, remember) {
    const s = JSON.stringify(sess);
    try {
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, s);
      (remember ? sessionStorage : localStorage).removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function showDashboard() {
    const login = $("#loginScreen"), shell = $("#adminShell");
    login.hidden = true; login.style.display = "none";
    shell.hidden = false; shell.style.display = "block";
    initDashboard();
    applyPermissions();
  }
  function showLoginError(msg) { const el = $("#loginError"); if (!msg) { el.hidden = true; return; } el.textContent = msg; el.hidden = false; }

  async function initAuth() {
    const sess = loadSession();
    if (sess && sess.token) {
      if (sess.token === "offline") { currentUser = sess.user; authToken = "offline"; showDashboard(); return; }
      const res = await authFetch({ action: "me", token: sess.token });
      if (res.ok && res.data && res.data.ok) { currentUser = res.data.user; authToken = sess.token; showDashboard(); return; }
      if (res.offline) { currentUser = sess.user; authToken = sess.token; showDashboard(); return; }
      clearSession();
    }
    $("#loginForm").addEventListener("submit", onLogin);
  }

  async function onLogin(e) {
    e.preventDefault();
    const u = $("#loginUser").value.trim(), p = $("#loginPass").value, remember = $("#loginRemember").checked;
    const btn = $("#loginBtn"); btn.disabled = true; const old = btn.textContent; btn.textContent = "جارٍ الدخول…";
    const res = await authFetch({ action: "login", username: u, password: p });
    btn.disabled = false; btn.textContent = old;
    if (res.offline) {
      // no PHP server reachable → allow the default owner locally
      if (u === "admin" && p === "yara2026") {
        currentUser = { username: "admin", role: "owner", perms: fullPerms() }; authToken = "offline";
        saveSession({ token: "offline", user: currentUser }, remember); showLoginError(""); showDashboard(); return;
      }
      return showLoginError("تعذّر الاتصال بالخادم. تأكّدي من تفعيل PHP، أو ادخلي بـ admin/yara2026 مؤقتاً.");
    }
    if (res.ok && res.data && res.data.ok) {
      currentUser = res.data.user; authToken = res.data.token;
      saveSession({ token: authToken, user: currentUser }, remember);
      showLoginError(""); $("#loginPass").value = ""; showDashboard(); return;
    }
    showLoginError((res.data && res.data.error) || "فشل تسجيل الدخول");
  }

  /* ---------- Permission gating ---------- */
  function setTabVisible(view, vis) { const t = document.querySelector(`.tab[data-view="${view}"]`); if (t) t.style.display = vis ? "" : "none"; }
  function applyPermissions() {
    setTabVisible("bookings", can("bookings"));
    setTabVisible("services", can("services"));
    setTabVisible("gallery", can("gallery"));
    setTabVisible("settings", can("settings"));
    setTabVisible("admins", can("manageAdmins"));
    // show current user name
    const label = $("#currentUserLabel");
    if (label && currentUser) label.innerHTML = `<span class="ul-icon">${ICONS.user}</span> ${esc(currentUser.username)}${currentUser.role === "owner" ? " (مالك)" : ""}`;
    // open the first permitted view
    const first = ["bookings", "services", "gallery", "settings", "admins"].find((v) => can(v)) || "bookings";
    switchView(first);
  }

  /* ---------- Dashboard init ---------- */
  let dashboardReady = false;
  let showArchived = false;

  function initDashboard() {
    if (dashboardReady) { render(); return; }
    dashboardReady = true;
    migrateLegacy();
    populateProviderFilter();
    initBookingsToolbar();

    $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));
    initServicesView();
    initSettingsView();
    initGalleryView();
    initBookingModal();

    $("#fDay").addEventListener("change", render);
    $("#fProvider").addEventListener("change", render);
    $("#fStatus").addEventListener("change", render);
    $("#btnClearFilters").addEventListener("click", () => {
      $("#fDay").value = ""; $("#fProvider").value = ""; $("#fStatus").value = ""; render();
    });
    $("#btnLogout").addEventListener("click", async () => {
      if (authToken && authToken !== "offline") await authFetch({ action: "logout", token: authToken });
      clearSession(); location.reload();
    });
    initAdminsView();

    // notifications + cross-device cloud sync
    initLastNotified();
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) { checkNewBookings(); render(); }
    });
    window.addEventListener("focus", checkNewBookings);

    // Save changes / Clear cache / cloud status
    $("#btnSaveChanges").addEventListener("click", saveChangesToCloud);
    $("#btnClearCache").addEventListener("click", clearCacheAndReload);
    updateCloudStatus();

    // poll: pull cloud, detect new bookings from any device, refresh
    setInterval(cloudPoll, 5000);

    render();
  }

  async function cloudPoll() {
    if (window.YaraCloud) {
      const before = localStorage.getItem(STORAGE_KEY) || "";
      await window.YaraCloud.pull();
      updateCloudStatus();
      const after = localStorage.getItem(STORAGE_KEY) || "";
      checkNewBookings();
      if (after !== before) { populateProviderFilter(); if (!$("#viewBookings").hidden) render(); }
    } else {
      checkNewBookings();
    }
  }

  function updateCloudStatus() {
    const el = $("#cloudStatus");
    if (!el) return;
    const on = window.YaraCloud && window.YaraCloud.isOnline();
    el.textContent = on ? "● متصل" : "● غير متصل";
    el.style.color = on ? "#2e9e6b" : "#c0392b";
  }

  async function saveChangesToCloud() {
    if (!window.YaraCloud) { alert("المزامنة السحابية غير متاحة."); return; }
    const btn = $("#btnSaveChanges"); const old = btn.textContent;
    btn.textContent = "جارٍ الحفظ…"; btn.disabled = true;
    const ok = await window.YaraCloud.pushAll();
    updateCloudStatus();
    btn.textContent = ok ? "✓ تم الحفظ" : "تعذّر الحفظ";
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 2000);
  }

  async function clearCacheAndReload() {
    if (!confirm("سيتم حذف النسخة المؤقتة من هذا المتصفح وإعادة تحميل أحدث البيانات من السحابة. متابعة؟")) return;
    // keep the login session; clear only the data cache keys
    ["yaraGlowServices","yaraGlowSettings","yaraGlowGallery","yaraGlowUsers","yaraGlowBookingsV2","yaraGlowLastNotified"]
      .forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    if (window.YaraCloud) { try { await window.YaraCloud.pull(); } catch (e) {} }
    location.reload();
  }

  function populateProviderFilter() {
    const sel = $("#fProvider"); const current = sel.value;
    const fromServices = (window.YaraData ? window.YaraData.getServices() : []).flatMap((s) => s.providers);
    const fromBookings = getBookings().map((b) => b.provider);
    const providers = Array.from(new Set([...fromServices, ...fromBookings].filter(Boolean))).sort();
    sel.innerHTML = `<option value="">الكل</option>` + providers.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    sel.value = current;
  }

  function initBookingsToolbar() {
    const arch = $("#btnArchiveToggle2");
    arch.addEventListener("click", () => {
      showArchived = !showArchived;
      arch.textContent = showArchived ? "إخفاء الأرشيف" : "عرض الأرشيف";
      arch.classList.toggle("active", showArchived);
      render();
    });
    $("#btnRevenue").addEventListener("click", openRevenue);
    $$("[data-close-revenue]").forEach((el) => el.addEventListener("click", () => {
      $("#revenueModal").classList.remove("is-open"); $("#revenueModal").setAttribute("aria-hidden", "true");
    }));
  }

  /* ---------- Revenue report ---------- */
  const money = (n) => "₪ " + Number(n || 0).toLocaleString("en");
  function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function computeRevenue() {
    const all = getBookings();
    const tk = todayKey();
    const month = tk.slice(0, 7);
    const wa = new Date(); wa.setDate(wa.getDate() - 6); const weekAgo = keyOf(wa);
    let today = 0, week = 0, monthSum = 0, total = 0, expected = 0, completed = 0, confirmed = 0;
    const byService = {};
    all.forEach((b) => {
      if (b.status === "completed") {
        total += b.price; completed++;
        if (b.dateKey === tk) today += b.price;
        if (b.dateKey >= weekAgo && b.dateKey <= tk) week += b.price;
        if (b.dateKey.slice(0, 7) === month) monthSum += b.price;
        byService[b.serviceName] = (byService[b.serviceName] || 0) + b.price;
      } else if (b.status === "confirmed") { expected += b.price; confirmed++; }
    });
    return { today, week, monthSum, total, expected, completed, confirmed, byService };
  }

  function openRevenue() {
    const r = computeRevenue();
    const services = Object.entries(r.byService).sort((a, b) => b[1] - a[1]);
    const rows = services.length
      ? services.map(([n, v]) => `<div class="row"><span>${esc(n)}</span><b>${money(v)}</b></div>`).join("")
      : `<div class="row"><span>لا توجد إيرادات محقّقة بعد</span><b>—</b></div>`;
    $("#revenueBody").innerHTML = `
      <div class="rev-grid">
        <div class="rev-card today"><div class="rev-value">${money(r.today)}</div><div class="rev-label">إيرادات اليوم</div></div>
        <div class="rev-card"><div class="rev-value">${money(r.week)}</div><div class="rev-label">آخر 7 أيام</div></div>
        <div class="rev-card"><div class="rev-value">${money(r.monthSum)}</div><div class="rev-label">هذا الشهر</div></div>
        <div class="rev-card total"><div class="rev-value">${money(r.total)}</div><div class="rev-label">الإجمالي المحقّق</div></div>
        <div class="rev-card expected"><div class="rev-value">${money(r.expected)}</div><div class="rev-label">متوقّع (مؤكدة)</div></div>
        <div class="rev-card"><div class="rev-value">${r.completed}</div><div class="rev-label">حجوزات مكتملة</div></div>
      </div>
      <p class="rev-note">الإيرادات المحقّقة تُحتسب من الحجوزات ذات الحالة «مكتمل». المتوقّع من الحجوزات «المؤكدة».</p>
      <h4 class="rev-subhead">الإيرادات حسب الخدمة</h4>
      <div class="summary">${rows}</div>`;
    $("#revenueModal").classList.add("is-open");
    $("#revenueModal").setAttribute("aria-hidden", "false");
  }

  /* ---------- View switching ---------- */
  function switchView(view) {
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    // block access to views the user has no permission for
    const permKey = { bookings: "bookings", services: "services", gallery: "gallery", settings: "settings", admins: "manageAdmins" }[view];
    if (permKey && !can(permKey)) return;
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    $("#viewBookings").hidden = view !== "bookings";
    $("#viewServices").hidden = view !== "services";
    $("#viewSettings").hidden = view !== "settings";
    $("#viewGallery").hidden = view !== "gallery";
    $("#viewAdmins").hidden = view !== "admins";
    if (view === "bookings") { populateProviderFilter(); render(); }
    if (view === "services") renderServicesAdmin();
    if (view === "settings") renderSettings();
    if (view === "gallery") renderGalleryAdmin();
    if (view === "admins") renderAdminsView();
  }

  /* ---------- Bookings rendering ---------- */
  function applyFilters(list) {
    const day = $("#fDay").value, prov = $("#fProvider").value, st = $("#fStatus").value;
    return list.filter((b) =>
      (showArchived ? b.archived : !b.archived) &&
      (!day || b.dateKey === day) &&
      (!prov || b.provider === prov) &&
      (!st || b.status === st)
    );
  }
  // newest-created first
  function sortNewest(list) {
    return list.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  function renderStats() {
    const all = getBookings().filter((b) => !b.archived);
    const tk = todayKey();
    const todayCount = all.filter((b) => b.dateKey === tk && b.status !== "cancelled").length;
    const unseen = all.filter((b) => !b.seen && b.status !== "cancelled").length;
    const byStatus = (s) => all.filter((b) => b.status === s).length;
    $("#statsRow").innerHTML = `
      <div class="stat-card today"><div class="stat-value">${todayCount}</div><div class="stat-label">مواعيد اليوم</div></div>
      <div class="stat-card new-badge"><div class="stat-value">${unseen}</div><div class="stat-label">حجوزات جديدة</div></div>
      <div class="stat-card confirmed"><div class="stat-value">${byStatus("confirmed")}</div><div class="stat-label">مؤكدة</div></div>
      <div class="stat-card completed"><div class="stat-value">${byStatus("completed")}</div><div class="stat-label">مكتملة</div></div>
      <div class="stat-card cancelled"><div class="stat-value">${byStatus("cancelled")}</div><div class="stat-label">ملغاة</div></div>`;
  }

  function bookingRowHTML(b) {
    const isNew = !b.seen && !b.archived;
    return `
      <article class="booking-card st-${b.status} ${isNew ? "is-unseen" : ""}" data-open="${b.id}" tabindex="0" role="button">
        ${isNew ? `<span class="new-flag">جديد</span>` : ""}
        <div class="bk-main">
          <div class="bk-top">
            <span class="bk-time">${minToLabel(b.start)} — ${minToLabel(b.end)}</span>
            <span class="bk-date">${formatDateAr(b.dateKey)}</span>
            <span class="badge-status st-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="bk-service">${esc(b.serviceName)}</div>
          <div class="bk-meta">
            <span>العميلة: <b>${esc(b.name) || "—"}</b></span>
            <span>المزوّدة: <b>${esc(b.provider)}</b></span>
            <span>₪ ${b.price}</span>
          </div>
        </div>
        <div class="bk-chevron">‹</div>
      </article>`;
  }

  function render() {
    renderStats();
    const list = sortNewest(applyFilters(getBookings()));
    const box = $("#bookingsList"), empty = $("#emptyState");
    if (!list.length) { box.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    box.innerHTML = list.map(bookingRowHTML).join("");
    $$("[data-open]", box).forEach((card) => {
      card.addEventListener("click", () => openBookingModal(card.dataset.open));
      card.addEventListener("keydown", (e) => { if (e.key === "Enter") openBookingModal(card.dataset.open); });
    });
  }

  /* ---------- Booking details popup ---------- */
  let currentBookingId = null;
  function initBookingModal() {
    $$("[data-close-modal]").forEach((el) => el.addEventListener("click", closeBookingModal));
    $("#bkArchive").addEventListener("click", () => {
      if (!currentBookingId) return;
      patchBooking(currentBookingId, { archived: true });
      closeBookingModal(); render();
    });
    $("#bkDelete").addEventListener("click", () => {
      if (!currentBookingId) return;
      if (!confirm("هل تريدين حذف هذا الحجز نهائياً؟")) return;
      saveAll(getBookings().filter((b) => b.id !== currentBookingId));
      closeBookingModal(); render();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#bookingModal").classList.contains("is-open")) closeBookingModal();
    });
  }

  function openBookingModal(id) {
    const b = getBookings().find((x) => x.id === id);
    if (!b) return;
    currentBookingId = id;
    // opening clears the "new" flag
    if (!b.seen) patchBooking(id, { seen: true });

    $("#bkDetails").innerHTML = `
      <div class="summary">
        <div class="row"><span>العميلة</span><b>${esc(b.name) || "—"}</b></div>
        <div class="row"><span>الهاتف</span><b>${esc(b.phone) || "—"}</b></div>
        <div class="row"><span>الخدمة</span><b>${esc(b.serviceName)}</b></div>
        <div class="row"><span>المزوّدة</span><b>${esc(b.provider)}</b></div>
        <div class="row"><span>التاريخ</span><b>${formatDateAr(b.dateKey)}</b></div>
        <div class="row"><span>الوقت</span><b>${minToLabel(b.start)} — ${minToLabel(b.end)}</b></div>
        <div class="row"><span>المدة</span><b>${b.duration} دقيقة</b></div>
        <div class="row"><span>السعر</span><b>₪ ${b.price}</b></div>
        ${b.notes ? `<div class="row"><span>ملاحظات</span><b>${esc(b.notes)}</b></div>` : ""}
        <div class="row"><span>وقت الحجز</span><b>${new Date(b.createdAt).toLocaleString("ar")}</b></div>
      </div>`;
    $("#bkArchive").textContent = b.archived ? "إلغاء الأرشفة" : "أرشفة";
    renderStatusButtons(b.status);
    $("#bookingModal").classList.add("is-open");
    $("#bookingModal").setAttribute("aria-hidden", "false");
    render(); // refresh list (flag removed)
  }

  function renderStatusButtons(active) {
    $("#bkStatusBtns").innerHTML = STATUSES.map((s) =>
      `<button class="status-btn ${s.id === active ? "active" : ""}" data-status="${s.id}">${s.label}</button>`
    ).join("");
    $$("#bkStatusBtns .status-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        patchBooking(currentBookingId, { status: btn.dataset.status });
        renderStatusButtons(btn.dataset.status);
        render();
      })
    );
  }

  function closeBookingModal() {
    $("#bookingModal").classList.remove("is-open");
    $("#bookingModal").setAttribute("aria-hidden", "true");
    currentBookingId = null;
  }

  /* ---------- Notifications + sound ---------- */
  let lastNotified = "";
  function initLastNotified() {
    try { lastNotified = localStorage.getItem(NOTIFIED_KEY) || ""; } catch (e) {}
    // baseline: if nothing stored, set to the newest existing so we don't alert on load
    if (!lastNotified) {
      const newest = getBookings().reduce((m, b) => (b.createdAt > m ? b.createdAt : m), "");
      lastNotified = newest;
      try { localStorage.setItem(NOTIFIED_KEY, lastNotified); } catch (e) {}
    }
  }
  function checkNewBookings() {
    const fresh = getBookings()
      .filter((b) => !b.archived && (b.createdAt || "") > lastNotified)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    if (!fresh.length) return;
    fresh.forEach((b) => showToast(b));
    playSound();
    lastNotified = fresh[fresh.length - 1].createdAt;
    try { localStorage.setItem(NOTIFIED_KEY, lastNotified); } catch (e) {}
    if (!$("#viewBookings").hidden) render();
    // browser notification (if permitted)
    if ("Notification" in window && Notification.permission === "granted") {
      const b = fresh[fresh.length - 1];
      try { new Notification("حجز جديد — Yara Glow", { body: `${b.name} · ${b.serviceName} · ${formatDateAr(b.dateKey)} ${minToLabel(b.start)}` }); } catch (e) {}
    }
  }
  function playSound() {
    const a = $("#notifySound");
    if (a) { try { a.currentTime = 0; a.play().catch(() => {}); } catch (e) {} }
  }
  function showToast(b) {
    const wrap = $("#toastWrap");
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `
      <span class="toast-icon">${ICONS.bell}</span>
      <div class="toast-body">
        <b>حجز جديد!</b>
        <small>${esc(b.name)} · ${esc(b.serviceName)}</small>
        <small>${formatDateAr(b.dateKey)} — ${minToLabel(b.start)}</small>
      </div>
      <button class="toast-close" aria-label="إغلاق">✕</button>`;
    t.querySelector(".toast-close").addEventListener("click", () => t.remove());
    t.addEventListener("click", (e) => {
      if (e.target.closest(".toast-close")) return;
      switchView("bookings"); $$(".tab").forEach((x)=>x.classList.toggle("is-active", x.dataset.view==="bookings"));
      openBookingModal(b.id); t.remove();
    });
    wrap.appendChild(t);
    setTimeout(() => t.classList.add("show"), 20);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 8000);
  }

  /* ---------- Services management ---------- */
  const DAYS = [
    { n: 0, label: "الأحد" }, { n: 1, label: "الاثنين" }, { n: 2, label: "الثلاثاء" },
    { n: 3, label: "الأربعاء" }, { n: 4, label: "الخميس" }, { n: 5, label: "الجمعة" }, { n: 6, label: "السبت" },
  ];
  const timeToMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const minToTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

  function initServicesView() {
    $("#btnAddService").addEventListener("click", () => {
      const list = window.YaraData.getServices();
      list.push(window.YaraData.newService());
      window.YaraData.saveServices(list);
      renderServicesAdmin();
      const cards = $$(".svc-edit");
      if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function chipHTML(name) {
    return `<span class="chip" data-provider="${esc(name)}">${esc(name)}<button type="button" data-remove aria-label="حذف">✕</button></span>`;
  }

  function serviceCardHTML(s) {
    const daysHTML = DAYS.map((d) => `
      <label class="day-check"><input type="checkbox" data-day="${d.n}" ${s.days.includes(d.n) ? "checked" : ""} /><span>${d.label}</span></label>`).join("");
    return `
      <div class="svc-edit" data-id="${s.id}">
        <div class="svc-row">
          <label class="field"><span>اسم الخدمة</span><input type="text" data-f="name" value="${esc(s.name)}" /></label>
          <label class="field"><span>المدة (دقيقة)</span><input type="number" min="5" step="5" data-f="duration" value="${s.duration}" /></label>
          <label class="field"><span>السعر (₪)</span><input type="number" min="0" step="5" data-f="price" value="${s.price}" /></label>
        </div>
        <label class="field"><span>وصف قصير</span>
          <input type="text" data-f="desc" value="${esc(s.desc || "")}" placeholder="جملة قصيرة تظهر على البطاقة" /></label>
        <div class="field"><span>مقدّمات الخدمة</span>
          <div class="chips" data-chips>${s.providers.map(chipHTML).join("")}</div>
          <div class="chip-add">
            <input type="text" data-chip-input placeholder="اسم المقدّمة ثم اضغطي إضافة" />
            <button class="btn btn-ghost" data-act="addchip">+ إضافة</button>
          </div>
        </div>
        <div class="svc-img-row">
          <label class="field"><span>صورة الخدمة</span>
            <input type="text" data-f="img" value="${esc(s.img)}" placeholder="رابط أو ارفعي صورة" /></label>
          <div class="svc-img-preview">${s.img ? `<img src="${esc(s.img)}" alt="" onerror="this.parentNode.innerHTML='⚠'" />` : `<span>${esc(s.name.charAt(0))}</span>`}</div>
          <div class="svc-img-upload"><input type="file" accept="image/*" data-imgfile hidden /><button class="btn btn-ghost" data-act="upload">رفع صورة</button></div>
        </div>
        <div class="svc-row">
          <label class="field"><span>بداية الدوام</span><input type="time" data-f="open" value="${minToTime(s.openMin)}" /></label>
          <label class="field"><span>نهاية الدوام</span><input type="time" data-f="close" value="${minToTime(s.closeMin)}" /></label>
        </div>
        <div class="field"><span>أيام العمل</span><div class="days-grid">${daysHTML}</div></div>
        <div class="svc-actions">
          <button class="btn btn-primary" data-act="save">حفظ</button>
          <button class="btn btn-ghost btn-delete" data-act="delete">حذف الخدمة</button>
        </div>
      </div>`;
  }

  function renderServicesAdmin() {
    const box = $("#servicesAdmin");
    const list = window.YaraData.getServices();
    box.innerHTML = list.length ? list.map(serviceCardHTML).join("")
      : `<div class="empty-state"><span class="es-icon">${ICONS.scissors}</span><p>لا توجد خدمات. أضيفي خدمة جديدة.</p></div>`;

    $$(".svc-edit", box).forEach((card) => {
      const imgInput = card.querySelector('[data-f="img"]');
      const preview = card.querySelector(".svc-img-preview");
      const setPreview = (url) => {
        preview.innerHTML = url ? `<img src="${url.replace(/"/g,"&quot;")}" alt="" onerror="this.parentNode.innerHTML='⚠'" />`
          : `<span>${(card.querySelector('[data-f="name"]').value.trim().charAt(0)) || "?"}</span>`;
      };
      imgInput.addEventListener("input", () => setPreview(imgInput.value.trim()));
      const fileInput = card.querySelector("[data-imgfile]");
      card.querySelector('[data-act="upload"]').addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => readImageFile(fileInput, (dataUrl) => { imgInput.value = dataUrl; setPreview(dataUrl); }));
      // provider chips: add + remove
      const chipsBox = card.querySelector("[data-chips]");
      const chipInput = card.querySelector("[data-chip-input]");
      const addChip = () => {
        const val = chipInput.value.trim();
        if (!val) return;
        const exists = $$(".chip", chipsBox).some((c) => c.dataset.provider === val);
        if (!exists) chipsBox.insertAdjacentHTML("beforeend", chipHTML(val));
        chipInput.value = ""; chipInput.focus();
      };
      card.querySelector('[data-act="addchip"]').addEventListener("click", addChip);
      chipInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addChip(); } });
      chipsBox.addEventListener("click", (e) => { const rm = e.target.closest("[data-remove]"); if (rm) rm.parentNode.remove(); });

      card.querySelector('[data-act="save"]').addEventListener("click", () => saveServiceCard(card));
      card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteService(card.dataset.id));
    });
  }

  function readImageFile(input, cb) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { alert("حجم الصورة كبير (الحد ~1.5MB). الرجاء اختيار صورة أصغر."); return; }
    const reader = new FileReader();
    reader.onload = () => cb(reader.result);
    reader.readAsDataURL(file);
  }

  function saveServiceCard(card) {
    const id = card.dataset.id;
    const get = (f) => card.querySelector(`[data-f="${f}"]`);
    const name = get("name").value.trim() || "خدمة";
    const desc = get("desc").value.trim();
    const duration = Math.max(5, Number(get("duration").value) || 30);
    const price = Math.max(0, Number(get("price").value) || 0);
    const providers = $$(".chip", card).map((c) => c.dataset.provider).filter(Boolean);
    const openMin = timeToMin(get("open").value);
    const closeMin = timeToMin(get("close").value);
    const img = get("img").value.trim();
    const days = $$('input[data-day]', card).filter((c) => c.checked).map((c) => Number(c.dataset.day));

    if (!providers.length) { alert("الرجاء إدخال اسم مقدّمة واحدة على الأقل."); return; }
    if (closeMin <= openMin) { alert("يجب أن تكون نهاية الدوام بعد بدايته."); return; }
    if (closeMin - openMin < duration) { alert("مدة الدوام أقصر من مدة الخدمة."); return; }
    if (!days.length) { alert("الرجاء تحديد يوم عمل واحد على الأقل."); return; }

    const list = window.YaraData.getServices();
    const idx = list.findIndex((s) => s.id === id);
    const updated = { id, name, desc, duration, price, providers, days, openMin, closeMin, img };
    if (idx > -1) list[idx] = updated; else list.push(updated);
    window.YaraData.saveServices(list);
    populateProviderFilter();
    flashSaved();
  }

  function deleteService(id) {
    if (!confirm("هل تريدين حذف هذه الخدمة؟")) return;
    window.YaraData.saveServices(window.YaraData.getServices().filter((s) => s.id !== id));
    renderServicesAdmin(); populateProviderFilter();
  }

  function flashSaved() {
    const hint = $("#saveHint");
    hint.hidden = false; clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => { hint.hidden = true; }, 2000);
  }

  /* ---------- Settings management ---------- */
  function initSettingsView() {
    $("#btnSaveSettings").addEventListener("click", saveSettingsFromForm);
    $("#btnLogoUpload").addEventListener("click", () => $("#logoFile").click());
    $("#logoFile").addEventListener("change", () =>
      readImageFile($("#logoFile"), (dataUrl) => { $("#logoPreview").innerHTML = `<img src="${dataUrl}" alt="" />`; $("#logoPreview").dataset.logo = dataUrl; }));
    $("#btnLogoClear").addEventListener("click", () => { $("#logoPreview").innerHTML = "✦"; $("#logoPreview").dataset.logo = ""; });
    $("#btnAboutUpload").addEventListener("click", () => $("#aboutImgFile").click());
    $("#aboutImgFile").addEventListener("change", () =>
      readImageFile($("#aboutImgFile"), (dataUrl) => { $("#aboutImgPreview").innerHTML = `<img src="${dataUrl}" alt="" />`; $("#aboutImgPreview").dataset.img = dataUrl; saveSettingsFromForm(true); }));
    $("#btnAboutClear").addEventListener("click", () => { const d = "assets/about.svg"; $("#aboutImgPreview").innerHTML = `<img src="${d}" alt="" />`; $("#aboutImgPreview").dataset.img = d; saveSettingsFromForm(true); });
    $("#btnAddUser").addEventListener("click", addUser);
    // live preview on text/color change
    $$('#viewSettings [data-s], #viewSettings [data-c]').forEach((inp) =>
      inp.addEventListener("input", () => saveSettingsFromForm(true)));
  }

  function renderSettings() {
    const s = window.YaraData.getSettings();
    $$('#viewSettings [data-s]').forEach((inp) => { inp.value = s[inp.dataset.s] != null ? s[inp.dataset.s] : ""; });
    $$('#viewSettings [data-c]').forEach((inp) => { inp.value = s.colors[inp.dataset.c] || "#000000"; });
    const lp = $("#logoPreview");
    lp.dataset.logo = s.logo || "";
    lp.innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="" />` : "✦";
    const ap = $("#aboutImgPreview");
    const aboutImg = s.aboutImage || "assets/about.svg";
    ap.dataset.img = aboutImg;
    ap.innerHTML = `<img src="${esc(aboutImg)}" alt="" />`;
    renderUsers();
  }

  function saveSettingsFromForm(silent) {
    const s = window.YaraData.getSettings();
    $$('#viewSettings [data-s]').forEach((inp) => { s[inp.dataset.s] = inp.value; });
    $$('#viewSettings [data-c]').forEach((inp) => { s.colors[inp.dataset.c] = inp.value; });
    s.logo = $("#logoPreview").dataset.logo || "";
    s.aboutImage = $("#aboutImgPreview").dataset.img || "assets/about.svg";
    window.YaraData.saveSettings(s);
    if (!silent) flashSaved();
  }

  function renderUsers() {
    const users = window.YaraData.getUsers();
    const box = $("#usersList");
    box.innerHTML = users.length
      ? users.map((u, i) => `
        <div class="user-row">
          <div><b>${esc(u.name)}</b>${u.contact ? ` <small>${esc(u.contact)}</small>` : ""}</div>
          <button class="btn btn-ghost btn-delete" data-del-user="${i}">حذف</button>
        </div>`).join("")
      : `<p class="hint-small">لا يوجد مستخدمون بعد.</p>`;
    $$("[data-del-user]", box).forEach((btn) => btn.addEventListener("click", () => {
      const list = window.YaraData.getUsers(); list.splice(Number(btn.dataset.delUser), 1);
      window.YaraData.saveUsers(list); renderUsers();
    }));
  }
  function addUser() {
    const name = $("#uName").value.trim();
    const contact = $("#uContact").value.trim();
    if (!name) { alert("الرجاء إدخال الاسم."); return; }
    const list = window.YaraData.getUsers();
    list.push({ name, contact });
    window.YaraData.saveUsers(list);
    $("#uName").value = ""; $("#uContact").value = "";
    renderUsers();
  }

  /* ---------- Gallery management ---------- */
  function initGalleryView() {
    $("#btnGalleryUpload").addEventListener("click", () => $("#galleryFile").click());
    $("#galleryFile").addEventListener("change", () => {
      const files = Array.from($("#galleryFile").files || []);
      if (!files.length) return;
      let pending = files.length;
      const list = window.YaraData.getGallery();
      files.forEach((file) => {
        if (file.size > 1.5 * 1024 * 1024) { alert("صورة كبيرة تجاوزت ~1.5MB وتم تخطّيها: " + file.name); if (--pending === 0) finish(); return; }
        const reader = new FileReader();
        reader.onload = () => { list.push(reader.result); if (--pending === 0) finish(); };
        reader.onerror = () => { if (--pending === 0) finish(); };
        reader.readAsDataURL(file);
      });
      function finish() { window.YaraData.saveGallery(list); $("#galleryFile").value = ""; renderGalleryAdmin(); flashGallery(); }
    });
  }

  function renderGalleryAdmin() {
    const box = $("#galleryAdmin");
    const list = window.YaraData.getGallery();
    box.innerHTML = list.length
      ? list.map((src, i) => `
        <div class="gal-item" data-i="${i}">
          <img src="${esc(src)}" alt="صورة ${i + 1}" />
          <div class="gal-actions">
            <button data-move="-1" title="لليمين" ${i === 0 ? "disabled" : ""}>›</button>
            <button data-move="1" title="لليسار" ${i === list.length - 1 ? "disabled" : ""}>‹</button>
            <button data-del title="حذف" class="gal-del">✕</button>
          </div>
        </div>`).join("")
      : `<div class="empty-state"><span class="es-icon">${ICONS.image}</span><p>لا توجد صور. ارفعي صوراً للمعرض.</p></div>`;

    $$(".gal-item", box).forEach((el) => {
      const i = Number(el.dataset.i);
      el.querySelector("[data-del]").addEventListener("click", () => {
        const l = window.YaraData.getGallery(); l.splice(i, 1); window.YaraData.saveGallery(l); renderGalleryAdmin();
      });
      $$("[data-move]", el).forEach((btn) => btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const l = window.YaraData.getGallery();
        const j = i + Number(btn.dataset.move);
        if (j < 0 || j >= l.length) return;
        [l[i], l[j]] = [l[j], l[i]];
        window.YaraData.saveGallery(l); renderGalleryAdmin();
      }));
    });
  }
  function flashGallery() {
    const h = $("#galleryHint"); h.hidden = false; clearTimeout(flashGallery._t);
    flashGallery._t = setTimeout(() => { h.hidden = true; }, 2000);
  }

  /* ---------- Admins management ---------- */
  const PERM_LABELS = { bookings: "المواعيد", services: "الخدمات", gallery: "المعرض", settings: "الإعدادات", manageAdmins: "إدارة المشرفين" };

  function initAdminsView() {
    $("#btnChangePass").addEventListener("click", changeMyPassword);
    $("#btnAddAdmin").addEventListener("click", addAdmin);
  }

  async function changeMyPassword() {
    const oldp = $("#cpOld").value, newp = $("#cpNew").value;
    if (!newp || newp.length < 4) { alert("كلمة المرور الجديدة يجب أن تكون 4 أحرف فأكثر."); return; }
    if (authToken === "offline") { alert("تغيير كلمة المرور يتطلّب اتصال الخادم (PHP)."); return; }
    const res = await authFetch({ action: "changePassword", token: authToken, oldPassword: oldp, newPassword: newp });
    if (res.ok && res.data && res.data.ok) {
      $("#cpOld").value = ""; $("#cpNew").value = "";
      const h = $("#cpHint"); h.hidden = false; setTimeout(() => { h.hidden = true; }, 2000);
    } else alert((res.data && res.data.error) || "تعذّر تحديث كلمة المرور.");
  }

  async function addAdmin() {
    if (authToken === "offline") { alert("إضافة مشرفين تتطلّب اتصال الخادم (PHP)."); return; }
    const username = $("#naUser").value.trim(), password = $("#naPass").value;
    if (!username || password.length < 4) { alert("أدخلي اسم مستخدم وكلمة مرور (4 أحرف فأكثر)."); return; }
    const perms = {};
    $$('#naPerms input[data-perm]').forEach((c) => { perms[c.dataset.perm] = c.checked; });
    const res = await authFetch({ action: "admins.create", token: authToken, username, password, role: "admin", perms });
    if (res.ok && res.data && res.data.ok) {
      $("#naUser").value = ""; $("#naPass").value = "";
      renderAdminsView();
    } else alert((res.data && res.data.error) || "تعذّر إضافة المشرف.");
  }

  async function renderAdminsView() {
    const box = $("#adminsList");
    if (authToken === "offline") {
      $("#addAdminCard").style.display = "none";
      box.innerHTML = `<p class="hint-small">إدارة المشرفين تتطلّب اتصال الخادم (PHP). أنتِ الآن في وضع عدم الاتصال بحساب المالك الافتراضي.</p>`;
      return;
    }
    $("#addAdminCard").style.display = "";
    const res = await authFetch({ action: "admins.list", token: authToken });
    if (!res.ok || !res.data || !res.data.ok) { box.innerHTML = `<p class="hint-small">تعذّر جلب قائمة المشرفين.</p>`; return; }
    const admins = res.data.admins || [];
    box.innerHTML = admins.map((a) => {
      const isOwner = a.role === "owner";
      const permChecks = ["bookings","services","gallery","settings","manageAdmins"].map((k) =>
        `<label class="day-check"><input type="checkbox" data-perm="${k}" ${a.perms[k] ? "checked" : ""} ${isOwner ? "disabled" : ""} /><span>${PERM_LABELS[k]}</span></label>`).join("");
      return `
        <div class="admin-row" data-user="${esc(a.username)}">
          <div class="admin-row-head">
            <b>${esc(a.username)}</b>
            <span class="admin-role ${isOwner ? "owner" : ""}">${isOwner ? "مالك" : "مشرف"}</span>
          </div>
          <div class="perms-grid">${permChecks}</div>
          <div class="admin-row-actions">
            ${isOwner ? "" : `<button class="btn btn-ghost" data-save-perms>حفظ الصلاحيات</button>
            <button class="btn btn-ghost btn-delete" data-del-admin>حذف</button>`}
          </div>
        </div>`;
    }).join("");

    $$(".admin-row", box).forEach((row) => {
      const username = row.dataset.user;
      const saveBtn = row.querySelector("[data-save-perms]");
      const delBtn = row.querySelector("[data-del-admin]");
      if (saveBtn) saveBtn.addEventListener("click", async () => {
        const perms = {}; $$('input[data-perm]', row).forEach((c) => { perms[c.dataset.perm] = c.checked; });
        const r = await authFetch({ action: "admins.update", token: authToken, username, perms });
        if (r.ok && r.data && r.data.ok) { saveBtn.textContent = "✓ حُفظت"; setTimeout(() => { saveBtn.textContent = "حفظ الصلاحيات"; }, 1500); }
        else alert((r.data && r.data.error) || "تعذّر الحفظ.");
      });
      if (delBtn) delBtn.addEventListener("click", async () => {
        if (!confirm(`حذف المشرف "${username}"؟`)) return;
        const r = await authFetch({ action: "admins.delete", token: authToken, username });
        if (r.ok && r.data && r.data.ok) renderAdminsView();
        else alert((r.data && r.data.error) || "تعذّر الحذف.");
      });
    });
  }

  /* ---------- Boot ---------- */
  async function boot() {
    if (window.YaraCloud) {
      await window.YaraCloud.bootstrap(function ensureLocal() {
        window.YaraData.getServices(); window.YaraData.getSettings();
        window.YaraData.getGallery(); window.YaraData.getUsers();
      });
    }
    initAuth();
    if ("Notification" in window && Notification.permission === "default") {
      // request after first interaction to avoid blocking
      document.addEventListener("click", function once() { try { Notification.requestPermission(); } catch (e) {} document.removeEventListener("click", once); }, { once: true });
    }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
