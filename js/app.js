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
    if (window.YaraData) window.YaraData.cloudPush(STORAGE_KEY);
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
      const bg = s.img
        ? `<img class="sc-bg" src="${s.img}" alt="${s.name}" loading="lazy" />`
        : `<div class="sc-bg sc-placeholder">${s.name.charAt(0)}</div>`;
      const provLabel = s.desc
        ? s.desc
        : (s.providers.length > 1
            ? `مع ${s.providers.length} مزوّدات · ⏱ ${s.duration} دقيقة`
            : `مع ${s.providers[0]} · ⏱ ${s.duration} دقيقة`);
      const dots = Array.from({ length: 4 }, (_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("");
      return `
      <article class="service-card" data-book="${s.id}" tabindex="0" role="button" aria-label="احجزي ${s.name}">
        ${bg}
        <div class="sc-overlay"></div>
        <div class="sc-content">
          <div class="sc-glass">
            <div>
              <h3 class="sc-name">${s.name}</h3>
              <p class="sc-desc">${provLabel}</p>
            </div>
            <span class="sc-logo">✦</span>
          </div>
          <div class="sc-price-tag">₪ ${s.price}</div>
          <div class="sc-footer">
            <div class="sc-dots">${dots}</div>
            <button class="sc-book" data-book="${s.id}">احجزي الآن</button>
          </div>
        </div>
      </article>`;
    }).join("");

    // booking triggers (card + button)
    $$("[data-book]", grid).forEach((el) =>
      el.addEventListener("click", (e) => { e.stopPropagation(); openBooking(el.dataset.book); })
    );
    // keyboard access for cards
    $$(".service-card", grid).forEach((card) => {
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBooking(card.dataset.book); }
      });
      attachTilt(card);
    });
  }

  /* ---------- 3D tilt effect ---------- */
  function attachTilt(card) {
    const MAX = 8; // degrees
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const rotateX = ((y - r.height / 2) / (r.height / 2)) * -MAX;
      const rotateY = ((x - r.width / 2) / (r.width / 2)) * MAX;
      card.style.transition = "transform .1s ease-out";
      card.style.transform =
        `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.05,1.05,1.05)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transition = "transform .4s ease-in-out";
      card.style.transform = "perspective(1000px) rotateX(0) rotateY(0) scale3d(1,1,1)";
    });
  }

  /* ---------- Modal control ---------- */
  const modal = $("#bookingModal");

  function openBooking(serviceId) {
    loadServices(); // reflect any admin edits
    resetWizard();
    if (serviceId) {
      const svc = SERVICES.find((s) => s.id === serviceId);
      if (svc) {
        selectService(svc);
        // service already chosen from the card → skip step 1 and go straight
        // to choosing the provider (or the date, when there is only one provider)
        goToStep(svc.providers.length > 1 ? 2 : 3);
      }
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
      seen: false,
      archived: false,
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
  /* ---------- Site settings (editable from dashboard) ---------- */
  function applySettings() {
    if (!window.YaraData) return;
    const s = window.YaraData.getSettings();

    // colors → CSS variables
    const root = document.documentElement;
    root.style.setProperty("--gold", s.colors.gold);
    root.style.setProperty("--gold-dark", s.colors.goldDark);
    root.style.setProperty("--rose", s.colors.rose);
    root.style.setProperty("--beige", s.colors.beige);
    root.style.setProperty("--ink", s.colors.ink);

    // texts
    const setText = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    setText("s-heroEyebrow", s.heroEyebrow);
    setText("s-heroTitle", s.heroTitle);
    setText("s-heroSub", s.heroSub);
    setText("s-servicesTitle", s.servicesTitle);
    setText("s-servicesDesc", s.servicesDesc);
    setText("s-aboutTitle", s.aboutTitle);
    setText("s-aboutText", s.aboutText);
    setText("s-contactPhone", s.contactPhone);
    setText("s-contactAddress", s.contactAddress);

    const phoneLink = $("#s-phoneLink"); if (phoneLink) phoneLink.href = "tel:" + (s.contactPhone || "").replace(/\s/g, "");
    const waLink = $("#s-whatsappLink"); if (waLink) waLink.href = "https://wa.me/" + (s.contactWhatsapp || "").replace(/[^\d]/g, "");

    // brand name + logo (all occurrences)
    document.title = s.brandName + " | مركز تجميل فاخر";
    $$(".brand-name").forEach((el) => { el.textContent = s.brandName; });
    $$(".brand").forEach((brand) => {
      const mark = brand.querySelector(".brand-mark");
      if (!mark) return;
      if (s.logo) {
        mark.innerHTML = `<img src="${s.logo}" alt="${s.brandName}" style="height:1.4em;width:auto;border-radius:6px;vertical-align:middle;" />`;
      } else {
        mark.textContent = "✦";
      }
    });
  }

  /* ---------- Gallery slider (autoplay, infinite loop) ---------- */
  const AUTOPLAY_MS = 3000;
  let galleryImgs = [];
  let slideIndex = 0;
  let slideTimer = null;

  function renderGallery() {
    if (!window.YaraData) return;
    galleryImgs = window.YaraData.getGallery();
    const section = $("#gallery");
    const track = $("#sliderTrack");
    const thumbs = $("#sliderThumbs");
    const dots = $("#sliderDots");
    if (!track) return;

    if (!galleryImgs.length) { section.hidden = true; stopAutoplay(); return; }
    section.hidden = false;

    track.innerHTML = galleryImgs.map((src) =>
      `<div class="slider-slide"><img src="${src}" alt="من أعمال Yara Glow" loading="lazy" /></div>`).join("");
    thumbs.innerHTML = galleryImgs.map((src, i) =>
      `<button data-idx="${i}"><img src="${src}" alt="مصغّرة ${i + 1}" loading="lazy" /></button>`).join("");
    dots.innerHTML = galleryImgs.map((_, i) => `<button data-idx="${i}" aria-label="شريحة ${i + 1}"></button>`).join("");

    $$("#sliderThumbs button", thumbs).forEach((b) => b.addEventListener("click", () => goToSlide(Number(b.dataset.idx), true)));
    $$("#sliderDots button", dots).forEach((b) => b.addEventListener("click", () => goToSlide(Number(b.dataset.idx), true)));

    if (slideIndex >= galleryImgs.length) slideIndex = 0;
    updateSlider();
    startAutoplay();
  }

  function updateSlider() {
    const track = $("#sliderTrack");
    if (!track) return;
    // RTL: move track to the right for later slides
    track.style.transform = `translateX(${slideIndex * 100}%)`;
    $$("#sliderThumbs button").forEach((b, i) => b.classList.toggle("active", i === slideIndex));
    $$("#sliderDots button").forEach((b, i) => b.classList.toggle("active", i === slideIndex));
  }

  function goToSlide(i, userAction) {
    const n = galleryImgs.length;
    slideIndex = (i % n + n) % n; // wrap → infinite loop
    updateSlider();
    if (userAction) startAutoplay(); // reset timer on manual nav
  }
  function nextSlide() { goToSlide(slideIndex + 1); }
  function prevSlide() { goToSlide(slideIndex - 1); }

  function startAutoplay() {
    stopAutoplay();
    if (galleryImgs.length > 1) slideTimer = setInterval(nextSlide, AUTOPLAY_MS);
  }
  function stopAutoplay() { if (slideTimer) { clearInterval(slideTimer); slideTimer = null; } }

  function initSlider() {
    const prev = $("#sliderPrev"), next = $("#sliderNext"), main = $("#sliderMain");
    if (!prev) return;
    prev.addEventListener("click", () => goToSlide(slideIndex - 1, true));
    next.addEventListener("click", () => goToSlide(slideIndex + 1, true));
    // pause on hover, resume on leave
    main.addEventListener("mouseenter", stopAutoplay);
    main.addEventListener("mouseleave", startAutoplay);
    // pause when tab hidden
    document.addEventListener("visibilitychange", () => { document.hidden ? stopAutoplay() : startAutoplay(); });
    renderGallery();
  }

  function init() {
    applySettings();
    loadServices();
    renderServices();
    initSlider();
    $("#year").textContent = new Date().getFullYear();

    // live update when settings/services/gallery change in another tab
    window.addEventListener("storage", (e) => {
      if (e.key === window.YaraData.SETTINGS_KEY) applySettings();
      if (e.key === window.YaraData.SERVICES_KEY) { loadServices(); renderServices(); }
      if (e.key === window.YaraData.GALLERY_KEY) renderGallery();
    });

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

  function cloudSnapshot() {
    return ["yaraGlowSettings", "yaraGlowServices", "yaraGlowGallery"]
      .map((k) => localStorage.getItem(k) || "").join("|");
  }

  async function boot() {
    // pull shared data from the cloud first so every device shows the same content
    if (window.YaraCloud) {
      await window.YaraCloud.bootstrap(function ensureLocal() {
        window.YaraData.getServices(); window.YaraData.getSettings();
        window.YaraData.getGallery(); window.YaraData.getUsers();
      });
    }
    init();
    // keep in sync with edits made on other devices
    if (window.YaraCloud) {
      setInterval(async () => {
        const before = cloudSnapshot();
        await window.YaraCloud.pull();
        if (cloudSnapshot() !== before) { applySettings(); loadServices(); renderServices(); renderGallery(); }
      }, 6000);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
