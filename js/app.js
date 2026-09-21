/* ===== Yara Glow — Booking Logic ===== */
(function () {
  "use strict";

  /* ---------- Data ---------- */
  // Services are loaded from the shared store (managed in the admin dashboard).
  let SERVICES = [];
  function loadServices() { SERVICES = (window.YaraData ? window.YaraData.getServices() : []); }

  const SLOT_STEP = 15; // minutes between slots

  const STORAGE_KEY = "yaraGlowBookingsV2";

  /* ---------- State ---------- */
  const state = { service: null, provider: null, date: null, time: null, step: 1 };
  let calMonth = new Date(); // month currently displayed in calendar

  /* ---------- Helpers ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const AR_DOW = ["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"];

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minToLabel = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

  // Bookings are stored as an array of full records (acts as the "database").
  // record = { id, serviceId, serviceName, provider, dateKey, start, end,
  //            duration, price, name, phone, status, createdAt }
  function getBookings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveBookingRecord(rec) {
    const all = getBookings();
    all.push(rec);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  // Busy intervals for a given day + provider (cancelled bookings free the slot).
  function bookedIntervals(dk, provider) {
    return getBookings()
      .filter((b) => b.dateKey === dk && b.provider === provider && b.status !== "cancelled")
      .map((b) => [b.start, b.end]);
  }

  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  /* ---------- Render: services section ---------- */
  function renderServices() {
    const grid = $("#servicesGrid");
    grid.innerHTML = SERVICES.map((s) => {
      const media = s.img
        ? `<img src="${s.img}" alt="${s.name}" loading="lazy" />`
        : `<div class="sc-placeholder">${s.name.charAt(0)}</div>`;
      const provLabel = s.providers.length > 1
        ? `${s.providers.length} مزوّدات`
        : s.providers[0];
      return `
      <article class="service-card">
        <div class="sc-media">
          ${media}
          <span class="sc-price">₪ ${s.price}</span>
        </div>
        <div class="sc-body">
          <h3 class="sc-name">${s.name}</h3>
          <div class="sc-meta">
            <span>⏱ ${s.duration} دقيقة</span>
            <span>₪ ${s.price}</span>
          </div>
          <div class="sc-provider">
            <span class="sc-avatar">${s.providers[0].charAt(0)}</span>
            <div><small>المزوّدة</small><b>${provLabel}</b></div>
          </div>
          <button class="btn btn-primary" data-book="${s.id}">احجزي</button>
        </div>
      </article>`;
    }).join("");

    $$("[data-book]", grid).forEach((btn) =>
      btn.addEventListener("click", () => openBooking(btn.dataset.book))
    );
  }

  /* ---------- Modal control ---------- */
  const modal = $("#bookingModal");

  function openBooking(serviceId) {
    loadServices(); // reflect any admin edits
    resetWizard();
    if (serviceId) {
      const svc = SERVICES.find((s) => s.id === serviceId);
      if (svc) { selectService(svc); }
    }
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeBooking() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function resetWizard() {
    state.service = state.provider = state.date = state.time = null;
    state.step = 1;
    calMonth = new Date();
    renderServiceOptions();
    goToStep(1);
    $("#wizardFoot").style.display = "";
  }

  /* ---------- Step navigation ---------- */
  function goToStep(step) {
    state.step = step;
    $$(".wizard-step").forEach((p) => p.classList.remove("is-active"));
    const panel = $(`[data-step-panel="${step}"]`);
    if (panel) panel.classList.add("is-active");

    // steps indicator
    $$(".step").forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle("is-active", n === step);
      el.classList.toggle("is-done", n < step);
    });

    // render step-specific content
    if (step === 2) renderProviderOptions();
    if (step === 3) renderCalendar();
    if (step === 4) renderTimeSlots();
    if (step === 5) renderReview();

    updateFooter();
  }

  function updateFooter() {
    const back = $("#btnBack");
    const next = $("#btnNext");
    back.disabled = state.step === 1;

    const ready = {
      1: !!state.service,
      2: !!state.provider,
      3: !!state.date,
      4: state.time != null,
      5: true, // validation happens on confirm
    }[state.step];
    next.disabled = !ready;
    next.textContent = state.step === 5 ? "تأكيد الحجز" : "التالي";

    // recap line
    const bits = [];
    if (state.service) bits.push(state.service.name);
    if (state.date) bits.push(formatDateAr(state.date));
    if (state.time != null) bits.push(minToLabel(state.time));
    $("#selectionRecap").textContent = bits.join(" • ");
  }

  /* ---------- Step 1: service ---------- */
  function renderServiceOptions() {
    const box = $("#serviceOptions");
    box.innerHTML = SERVICES.map((s) => `
      <button class="option ${state.service && state.service.id === s.id ? "is-selected" : ""}" data-svc="${s.id}">
        <span class="opt-avatar">${s.name.charAt(0)}</span>
        <span class="opt-text"><b>${s.name}</b><small>${s.duration} دقيقة — ₪ ${s.price}</small></span>
      </button>
    `).join("");
    $$("[data-svc]", box).forEach((b) =>
      b.addEventListener("click", () => {
        selectService(SERVICES.find((s) => s.id === b.dataset.svc));
        renderServiceOptions();
      })
    );
  }
  function selectService(svc) {
    if (state.service && state.service.id !== svc.id) {
      // service changed → reset later choices
      state.provider = state.date = state.time = null;
    }
    state.service = svc;
    // auto-select provider only when there is exactly one
    state.provider = svc.providers.length === 1 ? svc.providers[0] : null;
    updateFooter();
  }

  /* ---------- Step 2: provider ---------- */
  function renderProviderOptions() {
    const box = $("#providerOptions");
    const providers = state.service.providers;
    if (providers.length === 1) state.provider = providers[0];

    box.innerHTML = providers.map((p) => `
      <button class="option ${state.provider === p ? "is-selected" : ""}" data-provider="${p}">
        <span class="opt-avatar">${p.charAt(0)}</span>
        <span class="opt-text"><b>${p}</b><small>خبيرة ${state.service.name}</small></span>
      </button>`).join("");

    $$("[data-provider]", box).forEach((btn) =>
      btn.addEventListener("click", () => {
        if (state.provider !== btn.dataset.provider) {
          state.provider = btn.dataset.provider;
          state.time = null; // provider changed → time may differ
        }
        renderProviderOptions();
        updateFooter();
      })
    );
    updateFooter();
  }

  /* ---------- Step 3: calendar ---------- */
  function renderCalendar() {
    const cal = $("#calendar");
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const first = new Date(y, m, 1);
    const startDow = first.getDay(); // 0=Sunday
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = startOfToday();

    // Can we go to previous month? Only if it still contains selectable (future) days
    const prevMonthLast = new Date(y, m, 0);
    const canPrev = prevMonthLast >= today;

    let cells = "";
    // weekday headers
    AR_DOW.forEach((d) => (cells += `<div class="cal-dow">${d}</div>`));
    // leading empties
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-day cal-empty"></div>`;
    // days
    const workDays = state.service.days; // allowed weekdays
    for (let d = 1; d <= daysInMonth; d++) {
      const cur = new Date(y, m, d);
      const isPast = cur < today;
      const isClosed = !workDays.includes(cur.getDay());
      const disabled = isPast || isClosed;
      const isToday = cur.getTime() === today.getTime();
      const isSelected = state.date && dateKey(state.date) === dateKey(cur);
      cells += `<button class="cal-day ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""} ${isClosed && !isPast ? "is-closed" : ""}"
                  data-day="${d}" ${disabled ? "disabled" : ""} title="${isClosed && !isPast ? "يوم إجازة" : ""}">${d}</button>`;
    }

    cal.innerHTML = `
      <div class="cal-head">
        <div class="cal-title">${AR_MONTHS[m]} ${y}</div>
        <div class="cal-nav">
          <button data-cal="next" aria-label="الشهر التالي">‹</button>
          <button data-cal="prev" aria-label="الشهر السابق" ${canPrev ? "" : "disabled"}>›</button>
        </div>
      </div>
      <div class="cal-grid">${cells}</div>`;

    $("[data-cal='prev']", cal).addEventListener("click", () => {
      if (!canPrev) return;
      calMonth = new Date(y, m - 1, 1); renderCalendar();
    });
    $("[data-cal='next']", cal).addEventListener("click", () => {
      calMonth = new Date(y, m + 1, 1); renderCalendar();
    });
    $$(".cal-day[data-day]", cal).forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => {
        state.date = new Date(y, m, Number(btn.dataset.day));
        state.time = null;
        renderCalendar();
        updateFooter();
      });
    });
  }

  function formatDateAr(d) {
    return `${AR_DOW[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
  }

  /* ---------- Step 4: time slots ---------- */
  function renderTimeSlots() {
    const box = $("#timeSlots");
    const empty = $("#emptyTimes");
    const svc = state.service;
    const booked = bookedIntervals(dateKey(state.date), state.provider);

    const now = new Date();
    const isToday = dateKey(state.date) === dateKey(startOfToday());
    const nowMin = now.getHours() * 60 + now.getMinutes();

    let html = "";
    let available = 0;

    for (let start = svc.openMin; start + svc.duration <= svc.closeMin; start += SLOT_STEP) {
      const end = start + svc.duration;
      // conflict with an existing booking?
      const overlaps = booked.some(([bs, be]) => start < be && end > bs);
      // in the past (today only)?
      const past = isToday && start <= nowMin;
      const disabled = overlaps || past;
      if (!disabled) available++;
      const selected = state.time === start ? "is-selected" : "";
      html += `<button class="time-slot ${selected}" data-time="${start}" ${disabled ? "disabled" : ""}>${minToLabel(start)}</button>`;
    }

    box.innerHTML = html;
    empty.hidden = available > 0;
    box.hidden = available === 0;

    $$(".time-slot[data-time]", box).forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => {
        state.time = Number(btn.dataset.time);
        renderTimeSlots();
        updateFooter();
      });
    });
  }

  function showFormError(msg) {
    const err = $("#formError");
    err.textContent = msg;
    err.hidden = false;
  }

  /* ---------- Step 5: review summary ---------- */
  function renderReview() {
    const svc = state.service;
    const start = state.time;
    const end = start + svc.duration;
    $("#reviewSummary").innerHTML = `
      <h4>ملخّص الحجز</h4>
      <div class="row"><span>الخدمة</span><b>${svc.name}</b></div>
      <div class="row"><span>المزوّدة</span><b>${state.provider}</b></div>
      <div class="row"><span>الموعد</span><b>${formatDateAr(state.date)} — ${minToLabel(start)} إلى ${minToLabel(end)}</b></div>
      <div class="row"><span>المدة</span><b>${svc.duration} دقيقة</b></div>
      <div class="row"><span>السعر</span><b>₪ ${svc.price}</b></div>`;
    $("#formError").hidden = true;
  }

  /* ---------- Confirm ---------- */
  function confirmBooking() {
    const svc = state.service;
    const start = state.time;
    const end = start + svc.duration;
    const name = ($("#custName").value || "").trim();
    const phone = ($("#custPhone").value || "").trim();
    const notes = ($("#custNotes").value || "").trim();
    const err = $("#formError");

    // Validate required customer fields
    if (!name) { showFormError("الرجاء إدخال الاسم."); $("#custName").focus(); return; }
    if (!phone) { showFormError("الرجاء إدخال رقم الهاتف."); $("#custPhone").focus(); return; }

    // Prevent double-booking: re-check the slot is still free for this provider
    const busy = bookedIntervals(dateKey(state.date), state.provider);
    const clash = busy.some(([bs, be]) => start < be && end > bs);
    if (clash) {
      showFormError("عذراً، تمّ حجز هذا الوقت للتوّ. الرجاء اختيار وقت آخر.");
      goToStep(4); // back to time selection (slot will now appear disabled)
      return;
    }
    err.hidden = true;

    saveBookingRecord({
      id: "bk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      serviceId: svc.id,
      serviceName: svc.name,
      provider: state.provider,
      dateKey: dateKey(state.date),
      start: start,
      end: end,
      duration: svc.duration,
      price: svc.price,
      name: name,
      phone: phone,
      notes: notes,
      status: "new",
      createdAt: new Date().toISOString(),
    });

    $("#bookingSummary").innerHTML = `
      <div class="row"><span>الاسم</span><b>${name}</b></div>
      <div class="row"><span>الهاتف</span><b>${phone}</b></div>
      <div class="row"><span>الخدمة</span><b>${svc.name}</b></div>
      <div class="row"><span>المزوّدة</span><b>${state.provider}</b></div>
      <div class="row"><span>التاريخ</span><b>${formatDateAr(state.date)}</b></div>
      <div class="row"><span>الوقت</span><b>${minToLabel(start)} — ${minToLabel(end)}</b></div>
      <div class="row"><span>المدة</span><b>${svc.duration} دقيقة</b></div>
      <div class="row"><span>السعر</span><b>₪ ${svc.price}</b></div>
      ${notes ? `<div class="row"><span>ملاحظات</span><b>${notes}</b></div>` : ""}`;

    $$(".step").forEach((el) => el.classList.add("is-done"));
    $$(".wizard-step").forEach((p) => p.classList.remove("is-active"));
    $('[data-step-panel="done"]').classList.add("is-active");
    $("#wizardFoot").style.display = "none";
  }

  /* ---------- Wire up ---------- */
  function init() {
    loadServices();
    renderServices();
    $("#year").textContent = new Date().getFullYear();

    $$("[data-open-booking]").forEach((b) => b.addEventListener("click", () => openBooking()));
    $$("[data-close-booking]").forEach((b) => b.addEventListener("click", closeBooking));

    $("#btnNext").addEventListener("click", () => {
      if (state.step === 5) { confirmBooking(); return; }
      goToStep(state.step + 1);
    });
    $("#btnBack").addEventListener("click", () => {
      if (state.step > 1) goToStep(state.step - 1);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeBooking();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
