/* ===== Yara Glow — Admin Dashboard Logic ===== */
(function () {
  "use strict";

  /* ---------- Config ---------- */
  // ⚠️ كلمة مرور بسيطة للحماية من طرف العميل. غيّريها قبل النشر.
  const ADMIN_PASSWORD = "yara2026";
  const AUTH_KEY = "yaraGlowAdminAuth";
  const STORAGE_KEY = "yaraGlowBookingsV2";
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

  /* ---------- Auth ---------- */
  function isAuthed() { try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; } }
  function showDashboard() {
    const login = $("#loginScreen"), shell = $("#adminShell");
    login.hidden = true; login.style.display = "none";
    shell.hidden = false; shell.style.display = "block";
    initDashboard();
  }
  function initAuth() {
    if (isAuthed()) { showDashboard(); return; }
    $("#loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      if ($("#loginPass").value === ADMIN_PASSWORD) {
        try { sessionStorage.setItem(AUTH_KEY, "1"); } catch (err) {}
        $("#loginError").hidden = true; showDashboard();
      } else {
        $("#loginError").hidden = false; $("#loginPass").value = ""; $("#loginPass").focus();
      }
    });
  }

  /* ---------- Dashboard init ---------- */
  let dashboardReady = false;
  let showArchived = false;

  function initDashboard() {
    if (dashboardReady) { render(); return; }
    dashboardReady = true;
    migrateLegacy();
    populateProviderFilter();
    injectArchiveToggle();

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
    $("#btnLogout").addEventListener("click", () => {
      try { sessionStorage.removeItem(AUTH_KEY); } catch (e) {}
      location.reload();
    });

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

  function injectArchiveToggle() {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost filter-clear";
    btn.id = "btnArchiveToggle";
    btn.textContent = "عرض الأرشيف";
    btn.addEventListener("click", () => {
      showArchived = !showArchived;
      btn.textContent = showArchived ? "إخفاء الأرشيف" : "عرض الأرشيف";
      btn.classList.toggle("active", showArchived);
      render();
    });
    $(".filters").appendChild(btn);
  }

  /* ---------- View switching ---------- */
  function switchView(view) {
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    $("#viewBookings").hidden = view !== "bookings";
    $("#viewServices").hidden = view !== "services";
    $("#viewSettings").hidden = view !== "settings";
    $("#viewGallery").hidden = view !== "gallery";
    if (view === "bookings") { populateProviderFilter(); render(); }
    if (view === "services") renderServicesAdmin();
    if (view === "settings") renderSettings();
    if (view === "gallery") renderGalleryAdmin();
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
      <span class="toast-icon">🔔</span>
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
      : `<div class="empty-state"><span>💇‍♀️</span><p>لا توجد خدمات. أضيفي خدمة جديدة.</p></div>`;

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
    renderUsers();
  }

  function saveSettingsFromForm(silent) {
    const s = window.YaraData.getSettings();
    $$('#viewSettings [data-s]').forEach((inp) => { s[inp.dataset.s] = inp.value; });
    $$('#viewSettings [data-c]').forEach((inp) => { s.colors[inp.dataset.c] = inp.value; });
    s.logo = $("#logoPreview").dataset.logo || "";
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
      : `<div class="empty-state"><span>🖼️</span><p>لا توجد صور. ارفعي صوراً للمعرض.</p></div>`;

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
