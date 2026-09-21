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
  const OLD_KEY = "yaraGlowBookings"; // legacy format: { "dateKey_provider": [[start,end],...] }

  // One-time migration of any bookings saved by an older cached app.js.
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
        current.push({
          id: "legacy_" + dk + "_" + start,
          serviceId: "", serviceName: "حجز (نسخة سابقة)", provider: provider,
          dateKey: dk, start: start, end: end, duration: end - start, price: 0,
          name: "—", phone: "", status: "new", createdAt: new Date().toISOString(),
        });
        added++;
      });
    });
    if (added) {
      saveAll(current);
      try { localStorage.removeItem(OLD_KEY); } catch (e) {}
    }
  }

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
    migrateLegacy();

    populateProviderFilter();

    // tab switching
    $$(".tab").forEach((t) =>
      t.addEventListener("click", () => switchView(t.dataset.view))
    );
    initServicesView();

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

  function populateProviderFilter() {
    const sel = $("#fProvider");
    const current = sel.value;
    const fromServices = (window.YaraData ? window.YaraData.getServices() : []).flatMap((s) => s.providers);
    const fromBookings = getBookings().map((b) => b.provider);
    const providers = Array.from(new Set([...fromServices, ...fromBookings].filter(Boolean))).sort();
    sel.innerHTML = `<option value="">الكل</option>` +
      providers.map((p) => `<option value="${p}">${p}</option>`).join("");
    sel.value = current;
  }

  /* ---------- View switching ---------- */
  function switchView(view) {
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    $("#viewBookings").hidden = view !== "bookings";
    $("#viewServices").hidden = view !== "services";
    if (view === "bookings") { populateProviderFilter(); render(); }
    if (view === "services") renderServicesAdmin();
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
      // scroll to the newly added card
      const cards = $$(".svc-edit");
      if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function serviceCardHTML(s) {
    const daysHTML = DAYS.map((d) => `
      <label class="day-check">
        <input type="checkbox" data-day="${d.n}" ${s.days.includes(d.n) ? "checked" : ""} />
        <span>${d.label}</span>
      </label>`).join("");
    return `
      <div class="svc-edit" data-id="${s.id}">
        <div class="svc-row">
          <label class="field"><span>اسم الخدمة</span>
            <input type="text" data-f="name" value="${escapeAttr(s.name)}" /></label>
          <label class="field"><span>المدة (دقيقة)</span>
            <input type="number" min="5" step="5" data-f="duration" value="${s.duration}" /></label>
          <label class="field"><span>السعر (₪)</span>
            <input type="number" min="0" step="5" data-f="price" value="${s.price}" /></label>
        </div>
        <label class="field"><span>مقدّمات الخدمة <em>(افصلي بين الأسماء بفاصلة)</em></span>
          <input type="text" data-f="providers" value="${escapeAttr(s.providers.join("، "))}" placeholder="لينا، رنا، هبة" /></label>
        <div class="svc-img-row">
          <label class="field"><span>رابط صورة الخدمة <em>(اتركيه فارغاً لصورة افتراضية)</em></span>
            <input type="text" data-f="img" value="${escapeAttr(s.img)}" placeholder="assets/service-cut.svg أو https://..." /></label>
          <div class="svc-img-preview">${s.img ? `<img src="${escapeAttr(s.img)}" alt="معاينة" />` : `<span>${escapeAttr(s.name.charAt(0))}</span>`}</div>
        </div>
        <div class="svc-row">
          <label class="field"><span>بداية الدوام</span>
            <input type="time" data-f="open" value="${minToTime(s.openMin)}" /></label>
          <label class="field"><span>نهاية الدوام</span>
            <input type="time" data-f="close" value="${minToTime(s.closeMin)}" /></label>
        </div>
        <div class="field"><span>أيام العمل</span>
          <div class="days-grid">${daysHTML}</div>
        </div>
        <div class="svc-actions">
          <button class="btn btn-primary btn-save" data-act="save">حفظ</button>
          <button class="btn btn-ghost btn-delete" data-act="delete">حذف الخدمة</button>
        </div>
      </div>`;
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function renderServicesAdmin() {
    const box = $("#servicesAdmin");
    const list = window.YaraData.getServices();
    box.innerHTML = list.length
      ? list.map(serviceCardHTML).join("")
      : `<div class="empty-state"><span>💇‍♀️</span><p>لا توجد خدمات. أضيفي خدمة جديدة.</p></div>`;

    $$(".svc-edit", box).forEach((card) => {
      card.querySelector('[data-act="save"]').addEventListener("click", () => saveServiceCard(card));
      card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteService(card.dataset.id));
      // live image preview
      const imgInput = card.querySelector('[data-f="img"]');
      const preview = card.querySelector(".svc-img-preview");
      imgInput.addEventListener("input", () => {
        const url = imgInput.value.trim();
        preview.innerHTML = url
          ? `<img src="${url.replace(/"/g, "&quot;")}" alt="معاينة" onerror="this.parentNode.innerHTML='⚠'" />`
          : `<span>${(card.querySelector('[data-f="name"]').value.trim().charAt(0)) || "?"}</span>`;
      });
    });
  }

  function saveServiceCard(card) {
    const id = card.dataset.id;
    const get = (f) => card.querySelector(`[data-f="${f}"]`);
    const name = get("name").value.trim() || "خدمة";
    const duration = Math.max(5, Number(get("duration").value) || 30);
    const price = Math.max(0, Number(get("price").value) || 0);
    const providers = get("providers").value.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
    const openMin = timeToMin(get("open").value);
    const closeMin = timeToMin(get("close").value);
    const img = get("img").value.trim();
    const days = $$('input[data-day]', card).filter((c) => c.checked).map((c) => Number(c.dataset.day));

    // validation
    if (!providers.length) { alert("الرجاء إدخال اسم مقدّمة واحدة على الأقل."); return; }
    if (closeMin <= openMin) { alert("يجب أن تكون نهاية الدوام بعد بدايته."); return; }
    if (closeMin - openMin < duration) { alert("مدة الدوام أقصر من مدة الخدمة."); return; }
    if (!days.length) { alert("الرجاء تحديد يوم عمل واحد على الأقل."); return; }

    const list = window.YaraData.getServices();
    const idx = list.findIndex((s) => s.id === id);
    const updated = { id, name, duration, price, providers, days, openMin, closeMin, img };
    if (idx > -1) list[idx] = updated; else list.push(updated);
    window.YaraData.saveServices(list);

    populateProviderFilter();
    flashSaved();
  }

  function deleteService(id) {
    if (!confirm("هل تريدين حذف هذه الخدمة؟")) return;
    const list = window.YaraData.getServices().filter((s) => s.id !== id);
    window.YaraData.saveServices(list);
    renderServicesAdmin();
    populateProviderFilter();
  }

  function flashSaved() {
    const hint = $("#saveHint");
    hint.hidden = false;
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => { hint.hidden = true; }, 2000);
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", initAuth);
})();
