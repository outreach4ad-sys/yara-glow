/* ===== Yara Glow — Shared Services Store ===== */
/* Single source of truth for services, shared by the public site (app.js)
   and the admin dashboard (admin.js). Stored in LocalStorage as the "database". */
window.YaraData = (function () {
  "use strict";

  const SERVICES_KEY = "yaraGlowServices";

  // days: allowed weekdays (0=الأحد .. 6=السبت)
  // openMin / closeMin: working hours in minutes from midnight
  const DEFAULTS = [
    { id: "cut",    name: "قص وتصفيف",     duration: 45, price: 60,  providers: ["لينا"],       days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "assets/service-cut.svg" },
    { id: "color",  name: "صبغة شعر",      duration: 90, price: 150, providers: ["رنا"],        days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "assets/service-color.svg" },
    { id: "skin",   name: "عناية بالبشرة", duration: 60, price: 120, providers: ["هبة"],        days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "assets/service-skin.svg" },
    { id: "makeup", name: "مكياج مناسبات", duration: 60, price: 200, providers: ["ليان"],       days: [0,1,2,3,4,5,6], openMin: 600, closeMin: 1200, img: "assets/service-makeup.svg" },
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
      name: "خدمة جديدة", duration: 45, price: 0, providers: ["مقدّمة الخدمة"],
      days: [0,1,2,3,4,6], openMin: 600, closeMin: 1140, img: "",
    };
  }

  return { getServices, saveServices, newService, SERVICES_KEY };
})();
