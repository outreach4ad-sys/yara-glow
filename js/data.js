/* ===== Yara Glow — Shared Services Store ===== */
/* Single source of truth for services, shared by the public site (app.js)
   and the admin dashboard (admin.js). Stored in LocalStorage as the "database". */
window.YaraData = (function () {
  "use strict";

  const SERVICES_KEY = "yaraGlowServices";
  const SETTINGS_KEY = "yaraGlowSettings";
  const USERS_KEY = "yaraGlowUsers";
  const GALLERY_KEY = "yaraGlowGallery";

  const DEFAULT_GALLERY = [
    "assets/service-cut.svg",
    "assets/service-color.svg",
    "assets/service-skin.svg",
    "assets/service-makeup.svg",
  ];

  function getGallery() {
    let g;
    try { g = JSON.parse(localStorage.getItem(GALLERY_KEY)); } catch (e) { g = null; }
    if (!Array.isArray(g)) {
      g = DEFAULT_GALLERY.slice();
      try { localStorage.setItem(GALLERY_KEY, JSON.stringify(g)); } catch (e) {}
    }
    return g;
  }
  function saveGallery(list) {
    try { localStorage.setItem(GALLERY_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  const DEFAULT_SETTINGS = {
    brandName: "Yara Glow",
    logo: "", // data-URL or path; empty → ✦ mark
    colors: { gold: "#c9a15a", goldDark: "#b08843", rose: "#e9c4c4", beige: "#f3e7d6", ink: "#4a3b30" },
    heroEyebrow: "أهلاً بكِ في عالم الجمال",
    heroTitle: "تألّقي مع Yara Glow",
    heroSub: "مركز تجميل فاخر يجمع بين الرقّة والاحتراف. نمنحكِ تجربة عناية استثنائية بأيدي خبيرات متخصصات، في أجواء أنيقة تُشعركِ بالدلال والراحة.",
    servicesTitle: "لمسة جمال تليق بكِ",
    servicesDesc: "اختاري الخدمة التي تناسبكِ واحجزي موعدكِ في خطوات بسيطة.",
    aboutTitle: "جمالكِ.. شغفنا",
    aboutText: "في Yara Glow نؤمن أنّ لكلّ امرأة تألّقها الخاص. لذلك نقدّم خدمات تجميل راقية تعتمد على أجود المنتجات وأحدث التقنيات، ضمن بيئة نظيفة وهادئة صُمّمت خصيصاً لراحتكِ.",
    contactPhone: "059-000-0000",
    contactWhatsapp: "970590000000",
    contactAddress: "شارع الجمال، المدينة",
  };

  function getSettings() {
    let s;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) { s = null; }
    if (!s || typeof s !== "object") s = {};
    // deep-merge with defaults
    return Object.assign({}, DEFAULT_SETTINGS, s, {
      colors: Object.assign({}, DEFAULT_SETTINGS.colors, s.colors || {}),
    });
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  function getUsers() {
    try { const u = JSON.parse(localStorage.getItem(USERS_KEY)); return Array.isArray(u) ? u : []; }
    catch (e) { return []; }
  }
  function saveUsers(list) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  // days: allowed weekdays (0=الأحد .. 6=السبت)
  // openMin / closeMin: working hours in minutes from midnight
  const DEFAULTS = [
    { id: "cut",    name: "قص وتصفيف",     desc: "قصّة عصرية وتصفيف يبرز إطلالتكِ.",       duration: 45, price: 60,  providers: ["لينا"], days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "assets/service-cut.svg" },
    { id: "color",  name: "صبغة شعر",      desc: "ألوان راقية بمنتجات آمنة على الشعر.",   duration: 90, price: 150, providers: ["رنا"],  days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "assets/service-color.svg" },
    { id: "skin",   name: "عناية بالبشرة", desc: "جلسة تنظيف وترطيب تمنح بشرتكِ نضارة.",   duration: 60, price: 120, providers: ["هبة"],  days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "assets/service-skin.svg" },
    { id: "makeup", name: "مكياج مناسبات", desc: "مكياج احترافي يليق بأجمل مناسباتكِ.",    duration: 60, price: 200, providers: ["ليان"], days: [0,1,2,3,4,5,6], openMin: 600, closeMin: 1200, img: "assets/service-makeup.svg" },
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function getServices() {
    let list;
    try { list = JSON.parse(localStorage.getItem(SERVICES_KEY)); } catch (e) { list = null; }
    if (!Array.isArray(list) || !list.length) {
      list = clone(DEFAULTS);
      try { localStorage.setItem(SERVICES_KEY, JSON.stringify(list)); } catch (e) {}
    }
    // normalize (guard against older/partial records)
    return list.map((s) => ({
      id: s.id || ("svc_" + Math.random().toString(36).slice(2, 8)),
      name: s.name || "خدمة",
      desc: s.desc || "",
      duration: Number(s.duration) || 30,
      price: Number(s.price) || 0,
      providers: Array.isArray(s.providers) && s.providers.length ? s.providers : (s.provider ? [s.provider] : ["—"]),
      days: Array.isArray(s.days) && s.days.length ? s.days : [0,1,2,3,4,5,6],
      openMin: Number.isFinite(s.openMin) ? s.openMin : 600,
      closeMin: Number.isFinite(s.closeMin) ? s.closeMin : 1140,
      img: s.img || "",
    }));
  }

  function saveServices(list) {
    try { localStorage.setItem(SERVICES_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function newService() {
    return {
      id: "svc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: "خدمة جديدة", desc: "", duration: 45, price: 0, providers: ["مقدّمة الخدمة"],
      days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "",
    };
  }

  return {
    getServices, saveServices, newService, SERVICES_KEY,
    getSettings, saveSettings, SETTINGS_KEY, DEFAULT_SETTINGS,
    getUsers, saveUsers, USERS_KEY,
    getGallery, saveGallery, GALLERY_KEY,
  };
})();
