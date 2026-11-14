/* Listas de Chequeo UAS · UBPD
   App web instalable (PWA) que funciona sin internet.
   Los registros se guardan en el dispositivo (IndexedDB) y se exportan como evidencia. */
"use strict";

const APP_VERSION = "1.8.0";
const MAX_CICLOS = 8;
const MAX_FOTOS = 4;
const ENTIDAD = { nombre: "Unidad de Búsqueda de Personas Dadas por Desaparecidas", sigla: "UBPD", logo: "img/logo-ubpd.png" };

/* ---------------- utilidades ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nowIso = () => new Date().toISOString();
const fmtDT = iso => iso ? new Date(iso).toLocaleString("es-CO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
const fmtT = iso => iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
const fmtHM = iso => iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
// Duración en formato de hora HH:MM (segundos redondeados al minuto).
const hhmm = s => { if (s == null) return "—"; const m = Math.round(s / 60); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const dur = (a, b) => { if (!a || !b) return "—"; const m = Math.round((new Date(b) - new Date(a)) / 60000); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; };
const RES = { ok: ["CUMPLE", "ok", "✓"], na: ["N/A", "na", "—"], nov: ["NOVEDAD", "nov", "!"] };
function toast(msg, ms = 2800) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function newId() { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
const safeName = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(0, 80);

/* ---------------- base de datos local (IndexedDB) ---------------- */
const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("checklist-uas", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("registros", { keyPath: "id" });
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction("registros", mode); const st = t.objectStore("registros");
      const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx("readonly", st => st.getAll()); },
  put(rec) { return this.tx("readwrite", st => st.put(rec)); },
  del(id) { return this.tx("readwrite", st => st.delete(id)); }
};

/* ---------------- listas de chequeo (archivos .txt) ---------------- */
function parseLista(txt, archivo) {
  const L = { id: archivo.replace(/\.txt$/i, ""), archivo, meta: {}, secciones: [] }; let sec = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    if (line.startsWith("==")) {
      const parts = line.slice(2).split("|").map(s => s.trim()); const flags = parts.slice(2).map(s => s.toLowerCase());
      sec = { id: parts[0], t: parts[1] || "", repetible: flags.includes("repetible"), rojo: flags.includes("rojo"), items: [] };
      L.secciones.push(sec); continue;
    }
    if (!sec) { const m = line.match(/^([A-Za-zÁÉÍÓÚáéíóúÑñ_]+)\s*:\s*(.*)$/); if (m) L.meta[m[1].toLowerCase()] = m[2].trim(); continue; }
    let nm = line, rojo = false, neg = false;
    while (/^[!*]/.test(nm)) { if (nm[0] === "!") rojo = true; else neg = true; nm = nm.slice(1).trim(); }
    // Ítem | Valor esperado | EVENTO (opcional: PRENDE, DECOLA, ATERRIZA o APAGA)
    const partes = nm.split("|").map(s => s.trim());
    const ev = (partes[2] || "").toUpperCase();
    sec.items.push({ n: partes[0], v: partes[1] || "", rojo, neg, ...(EVENTOS.includes(ev) ? { ev } : {}) });
  }
  L.meta.aeronave ||= L.id; L.meta.corto ||= L.meta.aeronave; L.meta.tipo ||= "NORMAL CHECK LIST";
  return L;
}
async function cargarListas() {
  const out = [], errores = [];
  let idx;
  try { idx = await (await fetch("listas/indice.txt", { cache: "no-cache" })).text(); }
  catch (e) { return { out, errores: ["No se pudo leer listas/indice.txt"] }; }
  const files = idx.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  for (const f of files) {
    try {
      const r = await fetch("listas/" + encodeURIComponent(f), { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const L = parseLista(await r.text(), f);
      if (!L.secciones.length) throw new Error("sin secciones");
      out.push(L);
    } catch (e) { errores.push(`No se pudo cargar la lista «${f}» (${e.message})`); }
  }
  return { out, errores };
}

/* ---------------- secuencia de pasos ---------------- */
/* Eventos de vuelo: la hora en que se marca el ítem es la hora del evento.
   Tiempo tripulación = PRENDE → APAGA. Tiempo aeronave = DECOLA → ATERRIZA. */
const EVENTOS = ["PRENDE", "DECOLA", "ATERRIZA", "APAGA"];
// Ítems que la app agrega en los cambios de batería: cada ciclo es un vuelo nuevo
// y necesita su propio aterrizaje y apagado (la lista impresa no los trae).
const ITEM_ATERRIZA = { n: "Aterrizaje", v: "Confirmado", ev: "ATERRIZA", auto: true };
const ITEM_APAGA = { n: "Motores", v: "Apagados", ev: "APAGA", auto: true };
// Listas en curso o cerradas que se iniciaron con la app 1.5.0 y las listas nuevas guardaron
// el evento dentro del valor ("Apagados | APAGA"). Se reconoce sin modificar el registro
// (así no cambia su código de verificación).
const RE_EVENTO = /\s*\|\s*(PRENDE|DECOLA|ATERRIZA|APAGA)\s*$/i;
const evDe = it => it.ev || (String(it.v || "").match(RE_EVENTO)?.[1].toUpperCase() ?? null);
const valDe = it => String(it.v || "").replace(RE_EVENTO, "");
const tieneEvento = (s, ev) => s.items.some(it => evDe(it) === ev);

function pasos(rec) {
  const out = [];
  const conEventos = rec.plantilla.secciones.some(s => s.items.some(it => evDe(it)));
  let ciclosVuelo = 0;
  for (const s of rec.plantilla.secciones) {
    if (s.repetible) {
      const esVuelo = conEventos && tieneEvento(s, "PRENDE");
      for (let c = 1; c <= MAX_CICLOS; c++) {
        const dk = `${s.id}d${c}`; out.push({ kind: "dec", key: dk, sec: s, ciclo: c });
        if (rec.resp[dk]?.r !== "si") break;
        if (esVuelo) {
          // Ciclo 1: el vuelo anterior ya aterrizó en DESCENSO; falta apagar.
          // Ciclo 2 en adelante: el vuelo anterior es el del ciclo previo.
          if (c > 1) out.push({ kind: "item", key: `${s.id}c${c}.at`, sec: s, ciclo: c, it: ITEM_ATERRIZA });
          out.push({ kind: "item", key: `${s.id}c${c}.ap`, sec: s, ciclo: c, it: ITEM_APAGA });
          ciclosVuelo++;
        }
        s.items.forEach((it, i) => out.push({ kind: "item", key: `${s.id}c${c}.${i}`, sec: s, ciclo: c, it }));
      }
    } else {
      // Si hubo cambios de batería, el último vuelo aterriza antes de la parada de motores.
      if (ciclosVuelo > 0 && tieneEvento(s, "APAGA")) out.push({ kind: "item", key: `${s.id}.at`, sec: s, it: ITEM_ATERRIZA });
      s.items.forEach((it, i) => out.push({ kind: "item", key: `${s.id}.${i}`, sec: s, it }));
    }
  }
  return out;
}

/* Vuelos del registro con sus cuatro horas y los tiempos de tripulación y aeronave (en segundos).
   Las horas salen de la barra de botones (rec.horas, una entrada por vuelo); si un evento no se
   registró en la barra, se usa la hora en que se marcó su ítem en la lista. */
function tiemposVuelo(rec) {
  const vuelos = [], porPaso = {};
  let idx = -1;
  for (const p of pasos(rec)) {
    if (p.kind !== "item" || !evDe(p.it)) continue;
    const ev = evDe(p.it).toLowerCase();
    if (ev === "prende" || idx < 0) idx++; // cada ítem PRENDE de la lista empieza un vuelo
    porPaso[p.key] = idx;
    const v = (vuelos[idx] ||= {});
    const r = rec.resp[p.key];
    if (r && r.r !== "na" && !v[ev]) v[ev] = r.h || r.t; // r.h: hora elegida en el reloj (versión 1.7.0)
  }
  (rec.horas || []).forEach((h, i) => {
    const v = (vuelos[i] ||= {});
    for (const ev of ["prende", "decola", "aterriza", "apaga"]) if (h?.[ev]) v[ev] = h[ev];
  });
  for (let i = 0; i < vuelos.length; i++) vuelos[i] ||= {};
  while (vuelos.length && !Object.keys(vuelos[vuelos.length - 1]).length) vuelos.pop(); // vuelos aún sin horas
  // Se restan las horas tal como se ven (HH:MM): 19:52 → 19:53 = 00:01, sin importar los segundos.
  const minuto = iso => Math.floor(new Date(iso).getTime() / 60000);
  const seg = (a, b) => a && b ? Math.max(0, (minuto(b) - minuto(a)) * 60) : null;
  let trip = 0, aero = 0;
  for (const v of vuelos) {
    v.tripulacion = seg(v.prende, v.apaga); v.aeronave = seg(v.decola, v.aterriza);
    // El total suma los minutos ya redondeados de cada vuelo, para que cuadre con la tabla.
    trip += Math.round((v.tripulacion || 0) / 60) * 60; aero += Math.round((v.aeronave || 0) / 60) * 60;
  }
  return { vuelos, tripulacion: trip, aeronave: aero, porPaso };
}
const minutoDe = iso => Math.floor(new Date(iso).getTime() / 60000);
const plantillaConEventos = rec => rec.plantilla.secciones.some(s => s.items.some(it => evDe(it)));
function progreso(rec) { const st = pasos(rec); return { st, done: st.filter(x => rec.resp[x.key]).length, total: st.length, next: st.find(x => !rec.resp[x.key]) }; }
const nNov = rec => Object.values(rec.resp).filter(r => r.r === "nov").length;
const nCiclos = rec => Object.entries(rec.resp).filter(([k, v]) => /d\d+$/.test(k) && v.r === "si").length;

/* ---------------- integridad ---------------- */
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v ?? null);
}
async function huella(rec) {
  const { hash, actualizado, _ult, ...rest } = rec; const txt = stable(rest);
  if (crypto?.subtle) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)); return "SHA256-" + [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase(); }
  let h = 0x811c9dc5; for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return "FNV32-" + h.toString(16).toUpperCase();
}

/* ---------------- GPS, fotos, firma ---------------- */
function tomarGPS(timeout = 15000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res({ error: "GPS no disponible en este equipo", t: nowIso() });
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), prec: Math.round(p.coords.accuracy), alt: p.coords.altitude != null ? Math.round(p.coords.altitude) : null, t: new Date(p.timestamp).toISOString() }),
      e => res({ error: e.code === 1 ? "Permiso de ubicación negado" : "No se obtuvo ubicación", t: nowIso() }),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}
const gpsTxt = g => !g ? "—" : g.error ? g.error : `${g.lat}, ${g.lon} (±${g.prec} m)`;
function comprimirFoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.72)); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("imagen no válida")); };
    img.src = url;
  });
}
function initFirma() {
  const c = $("#firma"); if (!c) return;
  const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const g = c.getContext("2d"); g.scale(dpr, dpr); g.lineWidth = 2.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0b1f4a";
  let draw = false, last = null; S.firmaVacia = true;
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { draw = true; last = pos(e); c.setPointerCapture(e.pointerId); };
  c.onpointermove = e => { if (!draw) return; const p = pos(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; S.firmaVacia = false; };
  c.onpointerup = c.onpointercancel = () => { draw = false; };
}

/* ---------------- estado ---------------- */
const S = { listas: [], errores: [], recs: [], view: "home", cur: null, verId: null, listaId: null, noteFor: null, openSec: null, firmaVacia: true, verificado: null, swWaiting: null };

async function guardar(rec) {
  if (rec.estado !== "cerrada") rec.actualizado = nowIso();
  try { await IDB.put(JSON.parse(JSON.stringify(rec))); }
  catch (e) { toast("No se pudo guardar en el dispositivo: " + (e?.message || e), 5000); return; }
  const i = S.recs.findIndex(r => r.id === rec.id); if (i >= 0) S.recs[i] = rec; else S.recs.push(rec);
}
function log(rec, accion, detalle) { (rec.bitacora ||= []).push({ t: nowIso(), accion, ...(detalle ? { detalle } : {}) }); }

/* ---------------- vistas ---------------- */
function header(L, rev) {
  const m = L?.meta || {};
  return `<div class="hdr">
    <div><div class="lg"><img src="${ENTIDAD.logo}" alt="${esc(ENTIDAD.sigla)}"></div><div class="sub">${esc(m.fabricante || "")}</div></div>
    <div class="mid">${esc(m.tipo || "LISTAS DE CHEQUEO UAS")}</div>
    <div><div class="lg">${m.logo ? `<img src="${esc(m.logo)}" alt="${esc(m.fabricante || "")}" onerror="this.remove()">` : `<b>${esc(m.fabricante || "")}</b>`}</div><div class="sub">${esc(rev || m.revision || "")}</div></div>
  </div>`;
}
function render() {
  const app = $("#app");
  if (S.view === "nuevo") app.innerHTML = vNuevo();
  else if (S.view === "run" && S.cur) app.innerHTML = vRun();
  else if (S.view === "ver" && S.recs.find(r => r.id === S.verId)) app.innerHTML = vVer(S.recs.find(r => r.id === S.verId));
  else if (S.view === "verificar") app.innerHTML = vVerificar();
  else { S.view = "home"; app.innerHTML = vHome(); }
  if (S.view === "run") initFirma();
  if (S.view === "nuevo") initNuevo();
}
const ordenTxt = r => r.ordenVuelo || r.mision || "";
const lugarTxt = r => [r.lugar, r.municipio, r.departamento].filter(Boolean).join(", ");
const cipuTxt = r => r.cipu || r.licencia || "";
function chipEstado(r) {
  if (r.estado === "cerrada") return nNov(r) ? `<span class="chip nov">Cerrada · ${nNov(r)} novedad${nNov(r) > 1 ? "es" : ""}</span>` : `<span class="chip ok">Cerrada sin novedad</span>`;
  return `<span class="chip na">En curso</span>`;
}

function vHome() {
  const recs = [...S.recs].sort((a, b) => (b.inicio || "").localeCompare(a.inicio || ""));
  const abiertas = recs.filter(r => r.estado !== "cerrada");
  const filtro = (S.filtro || "").toLowerCase();
  const hist = recs.filter(r => !filtro || [r.piloto, r.cedula, r.serial, r.matricula, ordenTxt(r), lugarTxt(r), r.plantilla?.meta?.corto].join(" ").toLowerCase().includes(filtro));
  const bp = basePilotos(), bf = lsGet("uas_base_flota", null);
  return `<div class="sheet">
    ${header({ meta: { tipo: "LISTAS DE CHEQUEO UAS", fabricante: "Manual de Operaciones" } }, "v" + APP_VERSION)}
    ${S.swWaiting ? `<div class="banner info row" style="margin-top:10px;justify-content:space-between"><span>Hay una versión nueva de la app o de las listas.</span><button class="pri" data-a="actualizar">Actualizar ahora</button></div>` : ""}
    ${!navigator.onLine ? `<div class="banner info" style="margin-top:10px">Sin conexión. La app funciona normalmente; los registros quedan guardados en este equipo.</div>` : ""}
    ${S.errores.map(e => `<div class="banner" style="margin-top:10px">${esc(e)}</div>`).join("")}
    ${abiertas.length ? `<h2 style="margin-top:14px">Listas sin cerrar</h2>` + abiertas.map(r => { const P = progreso(r); return `<div class="panel navy"><div class="row" style="justify-content:space-between"><div><b>${esc(r.plantilla.meta.corto)}</b> · ${esc(r.matricula || r.serial)} · OV ${esc(ordenTxt(r))}<div class="small muted">${esc(r.piloto)} · inicio ${esc(fmtDT(r.inicio))} · ${P.done}/${P.total} pasos</div></div><div class="row"><button class="lnk" data-a="borrar" data-id="${esc(r.id)}">Descartar</button><button class="pri" data-a="continuar" data-id="${esc(r.id)}">Continuar</button></div></div>${S.confirmBorrar === r.id ? `<div class="banner row" style="justify-content:space-between"><span>¿Descartar esta lista sin cerrar? No se puede recuperar.</span><span class="row"><button data-a="borrar-no">No</button><button class="warn" data-a="borrar-si" data-id="${esc(r.id)}">Sí, descartar</button></span></div>` : ""}</div>`; }).join("") : ""}
    <div class="panel ${bp ? "" : "navy"}" style="margin-top:14px"><div class="row" style="justify-content:space-between">
      <div style="flex:1 1 260px"><b>Base de pilotos</b><div class="small muted">${bp ? `${bp.pilotos.length} pilotos activos en este equipo · ${esc(bp.archivo)} · cargada el ${esc(fmtDT(bp.cargado))}.` : S.baseCifrada ? "Escriba la clave de la unidad para activar la base de pilotos en este equipo. Solo se hace una vez." : "Este equipo no tiene la base de pilotos."}</div></div>
      ${!bp && S.baseCifrada ? `<div class="row" style="flex:1 1 300px"><input id="claveBase" type="password" autocomplete="current-password" placeholder="Clave de la unidad" style="flex:1 1 180px"><button class="pri" data-a="desbloquear">Activar base</button></div>` : ""}
      <label class="small noprint" style="font-weight:normal"><span class="lnk" style="text-decoration:underline;color:var(--navy);cursor:pointer;padding:6px">${bp ? "Cargar otro Excel" : "o cargar desde Excel"}</span><input type="file" id="xlsBase" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
    </div></div>
    <h2 style="margin-top:16px">Iniciar lista de chequeo</h2>
    <div class="cards">${S.listas.map(L => `<div class="card">
        ${L.meta.logo ? `<img src="${esc(L.meta.logo)}" alt="" onerror="this.remove()">` : ""}
        <div class="acft">${esc(L.meta.aeronave)}</div>
        <div class="small muted">${esc(L.meta.tipo)} · ${esc(L.meta.revision || "")} · ${L.secciones.length} secciones · ${L.secciones.reduce((a, s) => a + s.items.length, 0)} ítems</div>
        <button class="pri" data-a="nueva" data-l="${esc(L.id)}">Iniciar</button></div>`).join("") || `<p class="muted">No hay listas cargadas.</p>`}</div>
    <div class="row" style="justify-content:space-between;margin-top:20px"><h2 style="margin:0">Historial en este equipo (${recs.length})</h2>
      <div class="row noprint"><button data-a="csv">Exportar historial (CSV)</button><button data-a="respaldo">Copia de respaldo</button><button data-a="verificar">Verificar evidencia</button></div></div>
    ${recs.length > 5 ? `<input id="filtro" placeholder="Buscar por piloto, cédula, matrícula, orden de vuelo o lugar" value="${esc(S.filtro || "")}" style="margin:8px 0">` : ""}
    <div class="tbl" style="margin-top:8px">${hist.length ? `<table><thead><tr><th>Inicio</th><th>Aeronave</th><th>Piloto</th><th>Orden de vuelo</th><th>Duración</th><th>Estado</th><th></th></tr></thead><tbody>
      ${hist.map(r => `<tr><td style="white-space:nowrap">${esc(fmtDT(r.inicio))}</td><td>${esc(r.plantilla.meta.corto)}<div class="small muted">${esc(r.matricula || r.serial)}</div></td><td>${esc(r.piloto)}</td><td>${esc(ordenTxt(r))}<div class="small muted">${esc([r.municipio, r.departamento].filter(Boolean).join(", "))}</div></td><td>${esc(dur(r.inicio, r.fin))}</td><td>${chipEstado(r)}</td><td><button class="lnk" data-a="ver" data-id="${esc(r.id)}">Ver</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:14px;margin:0">${recs.length ? "Ningún registro coincide con la búsqueda." : "Todavía no hay registros. Al iniciar una lista de chequeo aparecerá aquí."}</p>`}</div>
    <p class="foot">Los registros se guardan en este equipo. Exporta la evidencia de cada vuelo y haz copias de respaldo periódicas. · v${APP_VERSION}</p>
  </div>`;
}

/* ---------------- datos de apoyo: pilotos, flota y DIVIPOLA ---------------- */
const normTxt = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const soloDig = s => String(s ?? "").replace(/\D/g, "");
const hoyISO = () => new Date().toISOString().slice(0, 10);
function basePilotos() { return lsGet("uas_base_pilotos", null); }
function flota() { return lsGet("uas_base_flota", null)?.aeronaves || S.flotaWeb?.aeronaves || []; }
function flotaDeLista(L) {
  const mods = (L.meta.modelos || L.meta.aeronave).split(",").map(normTxt).filter(Boolean);
  return flota().filter(a => mods.includes(normTxt(a.modelo)));
}
function buscarPiloto(cc) { const c = soloDig(cc); return c ? (basePilotos()?.pilotos || []).find(p => soloDig(p.cedula) === c) : null; }

async function desbloquearBase(clave) {
  const B = S.baseCifrada; if (!B) throw new Error("sin base cifrada");
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(B.sal), iterations: B.iter, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(B.iv) }, key, b64(B.datos)); // falla si la clave es incorrecta
  const { pilotos } = JSON.parse(new TextDecoder().decode(plano));
  lsSet("uas_base_pilotos", { origen: "cifrada", generado: B.generado, archivo: "Base de la unidad del " + fmtDT(B.generado), cargado: nowIso(), pilotos });
  lsSet("uas_clave_base", clave);
  return pilotos.length;
}
async function cargarLibXLSX() {
  if (window.XLSX) return;
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/xlsx.full.min.js"; s.onload = res; s.onerror = () => rej(new Error("no se pudo cargar el lector de Excel")); document.head.appendChild(s); });
}
function filasHoja(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); }
function fechaISO(v) { if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return ""; }
async function importarExcel(file) {
  await cargarLibXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  let pilotos = null, aeronaves = null;
  for (const name of wb.SheetNames) {
    const rows = filasHoja(wb.Sheets[name]);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const H = (rows[i] || []).map(normTxt);
      const col = pred => H.findIndex(pred);
      if (!pilotos && H.includes("IDENTIFICACION")) {
        const cN = col(h => h.startsWith("NOMBRES")), cC = col(h => h === "IDENTIFICACION"), cP = col(h => h.includes("CERTIFICADO") && h.includes("IDONEIDAD") && !h.startsWith("CUENTA")),
          cV = col(h => h.startsWith("VIGENCIA")), cS = col(h => h.startsWith("SEDE"));
        pilotos = rows.slice(i + 1).filter(r => r && r[cC] && r[cN]).map(r => ({ nombre: String(r[cN]).replace(/\s+/g, " ").trim(), cedula: soloDig(r[cC]), cipu: String(r[cP] ?? "").trim(), vigencia: String(r[cV] ?? "").trim(), sede: String(r[cS] ?? "").replace(/\s+/g, " ").trim() }));
        break;
      }
      if (!aeronaves && H.some(h => h.includes("SERIE AERONAVE"))) {
        const sub = (rows[i + 1] || []).map(normTxt);
        const cMa = col(h => h === "MARCA"), cMo = col(h => h === "MODELO"), cSe = col(h => h.includes("SERIE AERONAVE")), cMt = col(h => h.startsWith("MATRICULA")), cR = col(h => h.includes("RUAS")), cT = col(h => h.startsWith("TERRITORIAL"));
        const cPm = sub.findIndex(h => h.startsWith("FECHA PROXIMO MANTENIMIENTO"));
        aeronaves = rows.slice(i + 2).filter(r => r && r[cSe] && r[cMo] && !normTxt(r[cT]).includes("HURTO") && !normTxt(r[cMo]).includes("M210")).map(r => {
          let ruas = String(r[cR] ?? "").trim(); if (/^x*$/i.test(ruas)) ruas = "";
          return { marca: String(r[cMa] ?? "").trim(), modelo: String(r[cMo]).trim(), serial: String(r[cSe]).trim(), matricula: String(r[cMt] ?? "").trim(), ruas, proxMant6: cPm >= 0 ? fechaISO(r[cPm]) : "" };
        });
        break;
      }
    }
  }
  if (!pilotos && !aeronaves) throw new Error("No se encontraron las hojas de pilotos (columna IDENTIFICACION) ni de aeronaves (columna No SERIE AERONAVE).");
  const meta = { archivo: file.name, cargado: nowIso() };
  if (pilotos) lsSet("uas_base_pilotos", { ...meta, pilotos });
  if (aeronaves) lsSet("uas_base_flota", { ...meta, aeronaves });
  return { pilotos: pilotos?.length || 0, aeronaves: aeronaves?.length || 0 };
}

function vNuevo() {
  const L = S.listas.find(x => x.id === S.listaId); const last = lsGet("uas_ult_datos", {});
  const naves = flotaDeLista(L); const bp = basePilotos();
  const opt = (arr, campo, sel) => `<option value="">— Seleccione —</option>` + arr.map((a, i) => `<option value="${i}" ${sel === a.serial ? "selected" : ""}>${esc(a[campo] || "Sin " + campo.toUpperCase())}</option>`).join("");
  const lastSerial = last[L.id + "_serial"];
  return `<div class="sheet">${header(L)}<div class="acft">${esc(L.meta.aeronave)}</div>
  <form id="fNuevo" autocomplete="off"><h1>Datos del vuelo</h1>

  <div class="panel navy"><h2>Identificación del piloto al mando (Piloto No. 1)</h2>
    ${!bp ? `<div class="banner">Este equipo no tiene cargada la base de pilotos. Actívela desde la pantalla de inicio, o escriba los datos a mano.</div>` : ""}
    <div class="row" style="align-items:flex-end">
      <label class="req" for="cedula" style="flex:1 1 220px"><span>Número de cédula del Piloto No. 1</span><input id="cedula" inputmode="numeric" required placeholder="Solo números" value="${esc(last.cedula || "")}"></label>
      <button type="button" class="pri" data-a="buscar-cc" data-sfx="">Buscar</button>
    </div>
    <div id="pilotoRes"></div>
  </div>

  <div class="panel"><h2>Piloto No. 2</h2>
    <div class="row" style="align-items:flex-end">
      <label for="cedula2" style="flex:1 1 220px"><span>Número de cédula del Piloto No. 2 (si aplica)</span><input id="cedula2" inputmode="numeric" placeholder="Solo números" value="${esc(last.cedula2 || "")}"></label>
      <button type="button" class="pri" data-a="buscar-cc" data-sfx="2">Buscar</button>
    </div>
    <div id="pilotoRes2"></div>
  </div>

  <div class="panel"><h2>Aeronave</h2>
    ${naves.length ? `<div class="form f3">
      <label class="req" for="selSerial"><span>Serial de la aeronave</span><select id="selSerial" data-campo="serial" required>${opt(naves, "serial", lastSerial)}</select></label>
      <label class="req" for="selMatricula"><span>Matrícula</span><select id="selMatricula" data-campo="matricula" required>${opt(naves, "matricula", lastSerial)}</select></label>
      <label for="selRuas"><span>RUAS</span><select id="selRuas" data-campo="ruas">${opt(naves, "ruas", lastSerial)}</select></label>
    </div><div id="naveAviso"></div>`
    : `<div class="banner">No hay aeronaves ${esc(L.meta.corto)} en la base de datos de la flota. Escriba los datos a mano.</div>
      <div class="form f3">
      <label class="req" for="txtSerial"><span>Serial de la aeronave</span><input id="txtSerial" required></label>
      <label class="req" for="txtMatricula"><span>Matrícula</span><input id="txtMatricula" required></label>
      <label for="txtRuas"><span>RUAS</span><input id="txtRuas"></label></div>`}
  </div>

  <div class="panel"><h2>Vuelo</h2><div class="form">
    <label class="req" for="orden"><span>No. orden de vuelo</span><input id="orden" required placeholder="Ej. OV-2026-045"></label>
    <label class="req" for="dpto"><span>Departamento</span><select id="dpto" required><option value="">— Seleccione —</option>${Object.keys(S.divipola || {}).map(d => `<option ${last.dpto === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
    <label class="req" for="mpio"><span>Municipio</span><select id="mpio" required><option value="">— Seleccione el departamento —</option></select></label>
    <span></span>
    <label class="req" for="lugar" style="grid-column:1/-1"><span>Lugar (vereda, sector o sitio)</span><input id="lugar" required placeholder="Escriba el lugar exacto del vuelo"></label>
  </div><p class="small muted" style="margin:0">Al pulsar «Comenzar» se registra la hora de inicio y se intenta tomar la ubicación GPS del equipo.</p></div>
  <div class="row"><button type="submit" class="pri">Comenzar lista de chequeo</button><button type="button" data-a="home">Cancelar</button></div></form></div>`;
}
function llenarMunicipios(sel) {
  const d = $("#dpto")?.value, m = $("#mpio"); if (!m) return;
  const lista = (S.divipola || {})[d] || [];
  m.innerHTML = `<option value="">${d ? "— Seleccione —" : "— Seleccione el departamento —"}</option>` + lista.map(x => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");
}
function mostrarPiloto(sfx = "") {
  const box = $("#pilotoRes" + sfx); if (!box) return;
  const cc = soloDig($("#cedula" + sfx).value); const p = buscarPiloto(cc);
  S["pilotoSel" + sfx] = p || null;
  const firma = cc + "|" + (sfx ? soloDig($("#cedula").value) : "") + "|" + !!p;
  if (box.dataset.firma === firma) return; // misma cédula: no rehacer (conserva lo escrito a mano)
  box.dataset.firma = firma;
  if (!cc) { box.innerHTML = ""; return; }
  if (sfx && cc === soloDig($("#cedula").value)) { box.innerHTML = `<div class="banner" style="margin-top:8px">El Piloto No. 2 no puede ser el mismo Piloto No. 1.</div>`; S.pilotoSel2 = null; return; }
  if (p) {
    const vig = normTxt(p.vigencia) === "VIGENTE";
    box.innerHTML = `<div class="grid-kv" style="margin-top:8px"><div><b>Piloto No. ${sfx || 1}</b>${esc(p.nombre)}</div><div><b>Certificado CIPU</b>${esc(p.cipu || "—")}</div><div><b>Vigencia CIPU</b><span class="chip ${vig ? "ok" : "nov"}">${esc(p.vigencia || "Sin dato")}</span></div><div style="grid-column:1/-1"><b>Sede</b>${esc(p.sede || "—")}</div></div>
      ${vig ? "" : `<div class="banner" style="margin-top:8px">El certificado CIPU de este piloto no figura como VIGENTE.</div>`}`;
  } else {
    box.innerHTML = `<div class="banner" style="margin-top:8px">${basePilotos() ? "La cédula no está en la base de pilotos." : "Sin base de pilotos en este equipo."} Escriba los datos a mano; el registro quedará marcado como «ingresado manualmente».</div>
      <div class="form" style="margin-top:8px"><label class="req" for="manNombre${sfx}"><span>Nombre del Piloto No. ${sfx || 1}</span><input id="manNombre${sfx}" required></label><label class="req" for="manCipu${sfx}"><span>Certificado CIPU</span><input id="manCipu${sfx}" required placeholder="CIPU-100-..."></label></div>`;
  }
}
function syncNave(origen) {
  const L = S.listas.find(x => x.id === S.listaId); const naves = flotaDeLista(L);
  const v = origen?.value ?? $("#selSerial")?.value;
  ["selSerial", "selMatricula", "selRuas"].forEach(id => { const el = $("#" + id); if (el) el.value = v ?? ""; });
  const a = naves[+v]; const av = $("#naveAviso"); if (!av) return;
  av.innerHTML = a && a.proxMant6 && a.proxMant6 < hoyISO() ? `<div class="banner" style="margin-top:8px">Atención: el mantenimiento de 6 meses de esta aeronave figura vencido desde ${esc(a.proxMant6)}.</div>` : a && !a.ruas ? `<div class="banner info" style="margin-top:8px">Esta aeronave no tiene registro RUAS en la base de datos.</div>` : "";
}
function initNuevo() {
  const last = lsGet("uas_ult_datos", {});
  llenarMunicipios(last.mpio); mostrarPiloto(); mostrarPiloto("2"); syncNave();
}

function filaItem(rec, p, isNext, cerrada) {
  const r = rec.resp[p.key]; const it = p.it;
  const cls = ["it", it.rojo ? "rojo" : "", it.neg ? "neg" : "", r ? "s-" + r.r : "", isNext && !cerrada ? "act" : "", !r && !isNext ? (evDe(it) && !cerrada ? "lock-ev" : "lock") : ""].join(" ");
  let extra = "";
  const ev = evDe(it);
  const ajustada = r && r.h && Math.abs(new Date(r.h) - new Date(r.t)) >= 60000;
  if (r) extra = `<div class="meta"><span class="t">${fmtT(r.t)}</span><span class="res-${r.r}">${RES[r.r][0]}</span>${ajustada ? `<span class="small">hora del evento ${fmtHM(r.h)}</span>` : ""}${r.n ? `<span class="nota">${esc(r.n)}</span>` : ""}${!cerrada && rec._ult === p.key ? `<button class="lnk noprint" data-a="corregir" data-k="${p.key}">Corregir</button>` : ""}</div>`;
  else if (isNext && !cerrada) extra = S.noteFor === p.key
    ? `<div class="note"><label for="nota"><span>Describa la novedad y la acción tomada</span><textarea id="nota"></textarea></label><div class="row"><button class="warn" data-a="nov-ok" data-k="${p.key}">Registrar novedad</button><button data-a="nov-no">Cancelar</button></div></div>`
    : `<div class="acts"><button class="ok" data-a="res" data-r="ok" data-k="${p.key}">✓ CUMPLE</button><button data-a="res" data-r="na" data-k="${p.key}">N/A</button><button class="warn" data-a="nov" data-k="${p.key}">NOVEDAD</button></div>`;
  // Etiqueta del evento en su propia línea, con la hora del vuelo (la de la barra, o la del ítem).
  // Botón del evento en su fase: siempre visible y activo mientras la lista está abierta.
  let evt = "", mostrarTiempos = false;
  if (ev) {
    const T = tiemposVuelo(rec), vi = T.porPaso[p.key] ?? 0, e = ev.toLowerCase(), horaEv = T.vuelos[vi]?.[e] || null;
    mostrarTiempos = e === "apaga" && !!horaEv && !cerrada; // al registrar APAGA se ven los tiempos completos
    if (cerrada) evt = `<div class="evt-l"><span class="evt evt-${e}">${ev}${horaEv ? " " + fmtHM(horaEv) : ""}</span></div>`;
    else {
      const abierto = S.relojEv?.key === p.key;
      evt = `<div class="evt-l"><button type="button" class="hb hb-${e}${horaEv ? " lleno" : ""}${abierto ? " sel" : ""}" data-a="hora-item" data-k="${p.key}" data-vi="${vi}" data-ev="${e}">🕐 ${ev}<span>${horaEv ? fmtHM(horaEv) : "—:—"}</span></button>${horaEv ? "" : `<span class="small muted">Toque para registrar la hora</span>`}</div>`
        + (abierto ? relojItem(p.key, vi, e, horaEv) : "");
    }
  }
  // Al registrar APAGA se muestran los tiempos completos (solo mientras se ejecuta la lista).
  const tiempos = mostrarTiempos ? bloqueTiempos(rec) : "";
  return `<div class="${cls}${it.auto ? " auto" : ""}" id="k_${p.key.replace(/\./g, "_")}"><div class="ln"><span class="nm">${esc(it.n)}</span><span class="dots"></span><span class="val">${esc(valDe(it))}</span><span class="mk">${r ? RES[r.r][2] : ""}</span></div>${evt}${extra}${tiempos}</div>`;
}

/* ---------------- reloj para la hora de los eventos de vuelo ---------------- */
const pad2 = n => String(n).padStart(2, "0");
const horaActual = () => { const d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
const EVS = ["prende", "decola", "aterriza", "apaga"];
/* Reloj que se abre debajo del botón del evento. */
function relojItem(key, vi, ev, hora) {
  return `<div class="hb-reloj noprint"><label for="relojBarra"><span>Hora de ${ev.toUpperCase()}${vi > 0 ? ` · vuelo ${vi + 1}` : ""}</span><input type="time" id="relojBarra" value="${hora ? fmtHM(hora) : horaActual()}"></label>
    <button type="button" class="pri" data-a="hora-guardar">Guardar</button><button type="button" data-a="hora-ya">Ahora</button><button type="button" data-a="hora-cancelar">Cancelar</button></div>`;
}
/* Vuelve a dibujar solo los ítems de eventos (y la tabla del cierre), sin redibujar la lista:
   así no se pierden la firma ni las observaciones del cierre. */
function refrescarEventos() {
  const rec = S.cur; if (!rec) return;
  const P = progreso(rec);
  for (const p of P.st) {
    if (p.kind !== "item" || !evDe(p.it)) continue;
    const el = document.getElementById("k_" + p.key.replace(/\./g, "_"));
    if (el) el.outerHTML = filaItem(rec, p, P.next?.key === p.key, rec.estado === "cerrada");
  }
  const tc = $("#cierre .tiempos"); if (tc) tc.outerHTML = bloqueTiempos(rec);
}
/* Guarda la hora elegida para un evento del vuelo vi, en orden y sin horas futuras. */
async function guardarHoraBarra(vi, ev, valor) {
  const rec = S.cur, d = horaAFecha(valor), E = ev.toUpperCase();
  if (!d) { toast(`Seleccione la hora de ${E}.`); return false; }
  if (d - Date.now() > 60000) { toast(`La hora de ${E} (${valor}) no puede ser posterior a la hora actual.`, 4500); return false; }
  const T = tiemposVuelo(rec), v = T.vuelos[vi] || {}, k = EVS.indexOf(ev);
  if (k > 0 && !v[EVS[k - 1]]) { toast(`Primero registre ${EVS[k - 1].toUpperCase()} del vuelo ${vi + 1}.`, 4000); return false; }
  const antes = k > 0 ? { ev: EVS[k - 1], t: v[EVS[k - 1]] } : (T.vuelos[vi - 1]?.apaga ? { ev: `APAGA del vuelo ${vi}`, t: T.vuelos[vi - 1].apaga } : null);
  const despues = k < 3 ? (v[EVS[k + 1]] ? { ev: EVS[k + 1], t: v[EVS[k + 1]] } : null) : (T.vuelos[vi + 1]?.prende ? { ev: `PRENDE del vuelo ${vi + 2}`, t: T.vuelos[vi + 1].prende } : null);
  if (antes && minutoDe(d) < minutoDe(antes.t)) { toast(`La hora de ${E} (${valor}) no puede ser anterior a ${antes.ev.toUpperCase()} (${fmtHM(antes.t)}).`, 5000); return false; }
  if (despues && minutoDe(d) > minutoDe(despues.t)) { toast(`La hora de ${E} (${valor}) no puede ser posterior a ${despues.ev.toUpperCase()} (${fmtHM(despues.t)}).`, 5000); return false; }
  rec.horas ||= []; while (rec.horas.length <= vi) rec.horas.push({});
  rec.horas[vi][ev] = d.toISOString();
  log(rec, "hora-evento", { vuelo: vi + 1, evento: E, hora: rec.horas[vi][ev] });
  await guardar(rec);
  return true;
}
/* "HH:MM" elegido → fecha completa. Si queda más de una hora en el futuro, es de ayer (vuelo cerca de medianoche). */
function horaAFecha(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number); if (isNaN(h) || isNaN(m)) return null;
  const ahora = new Date(), d = new Date(ahora); d.setHours(h, m, 0, 0);
  if (d - ahora > 60 * 60 * 1000) d.setDate(d.getDate() - 1);
  return d;
}

function grupos(st) {
  const g = []; for (const p of st) { const gk = p.sec.id + (p.ciclo ? "#" + p.ciclo : ""); let x = g.find(y => y.gk === gk); if (!x) { x = { gk, sec: p.sec, ciclo: p.ciclo, pasos: [] }; g.push(x); } x.pasos.push(p); } return g;
}

function hojaSecciones(rec, interactiva) {
  const P = progreso(rec), cerrada = rec.estado === "cerrada" || !interactiva; const nextKey = P.next?.key;
  const curG = P.next ? (P.next.sec.id + (P.next.ciclo ? "#" + P.next.ciclo : "")) : null;
  return `<div class="cols">${grupos(P.st).map(g => {
    const items = g.pasos.filter(p => p.kind === "item"), dec = g.pasos.find(p => p.kind === "dec");
    const d = dec && rec.resp[dec.key];
    const hechos = items.filter(p => rec.resp[p.key]).length;
    const titulo = g.sec.t + (g.sec.repetible && (g.ciclo > 1 || items.length) ? ` · CICLO ${g.ciclo}` : "");
    let body = "";
    if (dec) {
      if (!d && dec.key === nextKey && !cerrada) body += `<div class="decide"><b>¿Se realiza ${g.ciclo > 1 ? "otro " : ""}${esc(g.sec.t.toLowerCase())}?</b><div class="row"><button class="pri" data-a="dec" data-r="si" data-k="${dec.key}">Sí, registrar</button><button data-a="dec" data-r="no" data-k="${dec.key}">No, continuar</button></div></div>`;
      else if (d) body += `<div class="it ${d.r === "si" ? "s-ok" : "s-na"}"><div class="ln"><span class="nm">¿Se realiza?</span><span class="dots"></span><span class="val">${d.r === "si" ? "SÍ" : "NO APLICA"}</span><span class="mk">${d.r === "si" ? "✓" : "—"}</span></div><div class="meta"><span class="t">${fmtT(d.t)}</span>${!cerrada && rec._ult === dec.key ? `<button class="lnk noprint" data-a="corregir" data-k="${dec.key}">Corregir</button>` : ""}</div></div>`;
      else body += `<div class="it lock"><div class="ln"><span class="nm">¿Se realiza?</span><span class="dots"></span><span class="val">SÍ / NO</span><span class="mk"></span></div></div>`;
    }
    body += items.map(p => filaItem(rec, p, p.key === nextKey, cerrada)).join("");
    const st = items.length ? `${hechos}/${items.length}` : "";
    return `<section class="sec ${g.gk === curG && !cerrada ? "cur" : ""}"><div class="sec-t ${g.sec.rojo ? "rojo" : ""}"><span class="n">${esc(g.sec.id)}</span>–<span class="t">${esc(titulo)}</span><span class="st">${st}</span></div><div class="box">${body}</div></section>`;
  }).join("")}</div>`;
}

function avisoVersionHTML() {
  return `<div class="banner info row" style="margin:0 0 10px;justify-content:space-between"><span>Hay una versión nueva de la app. Actualice: la lista no se pierde y se retoma en el mismo paso.</span><button class="pri" data-a="actualizar">Actualizar ahora</button></div>`;
}
function vRun() {
  const rec = S.cur, L = rec.plantilla, P = progreso(rec), cerrada = rec.estado === "cerrada";
  const pct = Math.round(P.done / P.total * 100);
  const cierre = !P.next && !cerrada ? `<div class="panel navy" id="cierre"><h2>Cierre y firma del registro</h2>
    <div class="grid-kv"><div><b>Pasos</b>${P.done}/${P.total}</div><div><b>Novedades</b>${nNov(rec)}</div><div><b>Duración</b>${dur(rec.inicio, nowIso())}</div></div>
    ${bloqueTiempos(rec)}
    <label for="obs"><span>Observaciones generales (opcional)</span><textarea id="obs">${esc(rec.observaciones || "")}</textarea></label>
    <div><b class="small">Fotos de evidencia (opcional, hasta ${MAX_FOTOS})</b>
      <div class="fotos" style="margin:6px 0">${(rec.fotos || []).map((f, i) => `<figure><img src="${f.data}" alt="Foto ${i + 1}"><figcaption>${fmtT(f.t)} · <button class="lnk" data-a="foto-del" data-i="${i}">Quitar</button></figcaption></figure>`).join("")}</div>
      ${(rec.fotos || []).length < MAX_FOTOS ? `<label class="small" style="font-weight:normal"><span>Tomar o elegir foto</span><input type="file" id="foto" accept="image/*" capture="environment"></label>` : ""}</div>
    <div><b class="small">Firma del piloto</b><canvas id="firma" class="sig" aria-label="Espacio para firmar con el dedo"></canvas><button class="lnk" data-a="firma-borrar">Borrar firma</button></div>
    <label class="chk" for="decl"><input type="checkbox" id="decl"><span>Declaro que esta lista de chequeo fue ejecutada en campo, ítem por ítem y en el orden establecido, por el piloto <b>${esc(rec.piloto)}</b>.</span></label>
    <div class="row"><button class="pri" data-a="cerrar">Cerrar y firmar registro</button></div></div>` : "";
  return `<div class="sheet">
    <div class="topbar noprint"><div class="info"><b>${esc(L.meta.corto)} · ${esc(rec.matricula || rec.serial)}</b> — OV ${esc(ordenTxt(rec))}<br>${esc(rec.piloto)} · inicio ${fmtT(rec.inicio)} · ${P.done}/${P.total}<div class="bar"><i style="width:${pct}%"></i></div></div>
      <span id="crono" class="crono" hidden></span>${P.next ? `<button data-a="ir">Ir al paso actual</button>` : ""}<button data-a="home">Salir</button></div>
    <div id="avisoVersion" class="noprint">${S.swWaiting ? avisoVersionHTML() : ""}</div>
    <div id="alertaPaso" class="alerta-paso noprint" hidden role="alert"></div>
    ${header(L, rec.revision)}<div class="acft">${esc(L.meta.aeronave)}</div>
    ${hojaSecciones(rec, true)}
    ${cierre}
    <p class="foot">${esc(L.meta.elaboro || "")}${L.meta.elaboro ? "<br>" : ""}${esc(ENTIDAD.nombre)} · v${APP_VERSION}</p></div>`;
}

function datosVuelo(rec) {
  return `<div class="grid-kv" style="margin:10px 0">
    <div><b>Registro</b>${esc(rec.id)}</div><div><b>Estado</b>${rec.estado === "cerrada" ? "CERRADA" : "EN CURSO"}</div><div><b>Novedades</b>${nNov(rec)}</div>
    <div><b>Piloto al mando</b>${esc(rec.piloto)}${rec.pilotoManual ? ` <span class="chip nov">manual</span>` : ""}</div><div><b>Cédula</b>${esc(rec.cedula || "—")}</div><div><b>Certificado CIPU</b>${esc(cipuTxt(rec))}${rec.vigenciaCipu ? ` · ${esc(rec.vigenciaCipu)}` : ""}</div>
    <div><b>Serial aeronave</b>${esc(rec.serial)}</div><div><b>Matrícula</b>${esc(rec.matricula || "—")}</div><div><b>RUAS</b>${esc(rec.ruas || "—")}</div>
    <div><b>No. orden de vuelo</b>${esc(ordenTxt(rec))}</div><div><b>Departamento</b>${esc(rec.departamento || "—")}</div><div><b>Municipio</b>${esc(rec.municipio || "—")}</div>
    <div><b>Lugar</b>${esc(rec.lugar)}</div><div><b>Piloto No. 2</b>${rec.piloto2 ? `${esc(rec.piloto2.nombre)}${rec.piloto2.manual ? ` <span class="chip nov">manual</span>` : ""}<div class="small">C.C. ${esc(rec.piloto2.cedula)} · ${esc(rec.piloto2.cipu)}${rec.piloto2.vigencia ? " · " + esc(rec.piloto2.vigencia) : ""}</div>` : esc(rec.observador || "—")}</div><div><b>Mantenimiento 6 meses</b>${rec.mantVencido ? `<span class="chip nov">Vencido (${esc(rec.proxMant6)})</span>` : esc(rec.proxMant6 ? "Al día hasta " + rec.proxMant6 : "—")}</div>
    <div><b>Inicio</b>${esc(fmtDT(rec.inicio))}</div><div><b>Cierre</b>${esc(fmtDT(rec.fin))}</div>
    <div><b>Duración</b>${esc(dur(rec.inicio, rec.fin))}</div><div><b>GPS inicio</b>${esc(gpsTxt(rec.gpsInicio))}</div><div><b>GPS cierre</b>${esc(gpsTxt(rec.gpsCierre))}</div>
    <div><b>Ciclos cambio de batería</b>${nCiclos(rec)}</div><div><b>Correcciones</b>${(rec.bitacora || []).filter(b => b.accion === "corrección").length}</div><div><b>Alertas por demora (&gt;10 s)</b>${(rec.bitacora || []).filter(b => b.accion === "alerta-inactividad").length}</div><div><b>Equipo</b>${esc(rec.equipo || "—")}</div>
  </div>`;
}
/* Tabla de tiempos: una fila por vuelo (el principal y uno por cada cambio de batería). */
function bloqueTiempos(rec) {
  if (!plantillaConEventos(rec)) return "";
  const T = tiemposVuelo(rec);
  // data-l: rótulo de cada dato cuando la tabla se muestra como tarjetas en el celular.
  const filas = T.vuelos.map((v, i) => `<tr><td>${i === 0 ? "Vuelo 1" : `Vuelo ${i + 1} <span class="small muted">(batería ${i})</span>`}</td><td data-l="PRENDE">${fmtHM(v.prende)}</td><td data-l="DECOLA">${fmtHM(v.decola)}</td><td data-l="ATERRIZA">${fmtHM(v.aterriza)}</td><td data-l="APAGA">${fmtHM(v.apaga)}</td><td data-l="Tiempo tripulación"><b>${hhmm(v.tripulacion)}</b></td><td data-l="Tiempo aeronave"><b>${hhmm(v.aeronave)}</b></td></tr>`).join("");
  return `<div class="tiempos"><h2>Tiempos de vuelo</h2>
    <div class="tbl"><table><thead><tr><th>Vuelo</th><th>PRENDE</th><th>DECOLA</th><th>ATERRIZA</th><th>APAGA</th><th>Tiempo tripulación<div class="small">prende → apaga</div></th><th>Tiempo aeronave<div class="small">decola → aterriza</div></th></tr></thead>
    <tbody>${filas || `<tr><td colspan="7" class="muted">Aún no se ha registrado ningún evento.</td></tr>`}
    ${T.vuelos.length > 1 ? `<tr class="total"><td colspan="5"><b>TOTAL</b></td><td data-l="Tiempo tripulación"><b>${hhmm(T.tripulacion)}</b></td><td data-l="Tiempo aeronave"><b>${hhmm(T.aeronave)}</b></td></tr>` : ""}</tbody></table></div></div>`;
}
function bloqueEvidencia(rec) {
  return `${rec.observaciones ? `<p><b>Observaciones:</b> ${esc(rec.observaciones)}</p>` : ""}
    ${(rec.fotos || []).length ? `<div><b class="small">Fotos</b><div class="fotos">${rec.fotos.map((f, i) => `<figure><img src="${f.data}" alt="Foto ${i + 1}"><figcaption>${esc(fmtDT(f.t))}</figcaption></figure>`).join("")}</div></div>` : ""}
    <div class="row" style="align-items:flex-start;gap:16px;margin-top:8px">
      <div style="flex:1 1 260px"><b class="small">Declaración</b><p style="margin:2px 0">${rec.declaracion ? `El piloto <b>${esc(rec.piloto)}</b> declaró que la lista fue ejecutada en campo, ítem por ítem y en el orden establecido.` : "Registro sin cerrar."}</p>
      ${rec.hash ? `<b class="small">Código de verificación</b><div class="hash">${esc(rec.hash)}</div>` : ""}</div>
      ${rec.firma ? `<div style="flex:0 1 260px"><b class="small">Firma</b><img src="${rec.firma}" alt="Firma del piloto" style="width:100%;max-width:260px;border-bottom:1px solid #000;display:block"><div class="small">${esc(rec.piloto)} · C.C. ${esc(rec.cedula || "—")} · ${esc(cipuTxt(rec))}</div></div>` : ""}
    </div>`;
}

function vVer(rec) {
  const L = rec.plantilla;
  return `<div class="sheet">
    <div class="row noprint" style="justify-content:space-between;margin-bottom:10px"><button data-a="home">← Volver</button>
      <div class="row">${rec.estado !== "cerrada" ? `<button class="pri" data-a="continuar" data-id="${esc(rec.id)}">Continuar lista</button>` : ""}
      <button class="pri" data-a="pdf">Guardar PDF / Imprimir</button><button data-a="compartir" data-id="${esc(rec.id)}">Compartir evidencia</button>
      <button data-a="json" data-id="${esc(rec.id)}">Archivo de verificación</button>${rec.hash ? `<button data-a="integridad" data-id="${esc(rec.id)}">Verificar integridad</button>` : ""}</div></div>
    ${header(L, rec.revision)}<div class="acft">${esc(L.meta.aeronave)} · EVIDENCIA DE EJECUCIÓN</div>
    ${datosVuelo(rec)}
    ${bloqueTiempos(rec)}
    ${hojaSecciones(rec, false)}
    ${bloqueEvidencia(rec)}
    <p class="foot">${esc(L.meta.elaboro || "")}${L.meta.elaboro ? " · " : ""}${esc(ENTIDAD.nombre)} · Generado con Listas de Chequeo UAS v${esc(rec.appVersion || APP_VERSION)}</p></div>`;
}

function vVerificar() {
  const v = S.verificado;
  return `<div class="sheet">${header({ meta: { tipo: "VERIFICACIÓN DE EVIDENCIA", fabricante: "Manual de Operaciones" } }, "v" + APP_VERSION)}
    <h1>Verificar un archivo de evidencia</h1>
    <p class="muted">Selecciona el archivo <b>.json</b> de verificación que exportó el piloto. La app recalcula el código y confirma si el registro fue modificado después de cerrarse. También sirve para restaurar una copia de respaldo en este equipo.</p>
    <div class="panel"><label for="vfile"><span>Archivo .json</span><input type="file" id="vfile" accept=".json,application/json"></label></div>
    ${v ? `<div class="panel ${v.ok ? "" : "navy"}">${v.lista.map(x => `<div class="row" style="justify-content:space-between"><div><b>${esc(x.rec.plantilla?.meta?.corto || "")} · ${esc(x.rec.serial)}</b> · ${esc(x.rec.piloto)} · ${esc(fmtDT(x.rec.inicio))}</div>
       <span class="chip ${x.estado === "ok" ? "ok" : x.estado === "abierta" ? "na" : "nov"}">${x.estado === "ok" ? "Íntegro" : x.estado === "abierta" ? "Sin cerrar" : "MODIFICADO"}</span></div>`).join("")}
       <div class="row"><button class="pri" data-a="importar">Guardar ${v.lista.length > 1 ? "estos registros" : "este registro"} en este equipo</button></div></div>` : ""}
    <button data-a="home">← Volver</button></div>`;
}

/* ---------------- exportaciones ---------------- */
async function cssTexto() { try { return await (await fetch("styles.css")).text(); } catch (e) { return ""; } }
async function imgData(src) { try { const b = await (await fetch(src)).blob(); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); } catch (e) { return ""; } }
async function evidenciaHTML(rec) {
  let html = vVer(rec);
  const logos = [ENTIDAD.logo, rec.plantilla.meta.logo].filter(Boolean);
  for (const l of logos) { const d = await imgData(l); if (d) html = html.split(`src="${esc(l)}"`).join(`src="${d}"`); }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidencia ${esc(rec.id)}</title><style>${await cssTexto()} .noprint{display:none!important}</style></head><body>${html}</body></html>`;
}
async function entregar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo }); const file = new File([blob], nombre, { type: tipo });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nombre }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast("Archivo descargado: " + nombre);
}
const csvC = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
function columnasTiempos(r) {
  if (!plantillaConEventos(r)) return ["", "", "", "", "", "", "", ""];
  const T = tiemposVuelo(r), V = T.vuelos, ult = V[V.length - 1] || {};
  const det = V.map((v, i) => `V${i + 1}: prende ${fmtHM(v.prende)}, decola ${fmtHM(v.decola)}, aterriza ${fmtHM(v.aterriza)}, apaga ${fmtHM(v.apaga)}`).join(" | ");
  return [V.length, fmtHM(V[0]?.prende), fmtHM(V[0]?.decola), fmtHM(ult.aterriza), fmtHM(ult.apaga), hhmm(T.tripulacion), hhmm(T.aeronave), det];
}
function csvHistorial() {
  const rows = [["Registro", "Aeronave", "Revisión", "Piloto", "Cédula", "Certificado CIPU", "Vigencia CIPU", "Piloto No. 2", "Cédula Piloto No. 2", "CIPU Piloto No. 2", "Serial", "Matrícula", "RUAS", "No. orden de vuelo", "Departamento", "Municipio", "Lugar", "Inicio", "Cierre", "Duración", "Estado", "Novedades", "Ciclos batería", "Mantenimiento vencido", "GPS inicio", "GPS cierre", "Código verificación", "Detalle novedades",
    "Vuelos", "Prende (vuelo 1)", "Decola (vuelo 1)", "Aterriza (último vuelo)", "Apaga (último vuelo)", "Tiempo tripulación", "Tiempo aeronave", "Detalle tiempos"]];
  for (const r of [...S.recs].sort((a, b) => (a.inicio || "").localeCompare(b.inicio || ""))) {
    const novs = progreso(r).st.filter(p => r.resp[p.key]?.r === "nov").map(p => `${p.sec.id}. ${p.it.n}: ${r.resp[p.key].n}`).join(" | ");
    rows.push([r.id, r.plantilla.meta.aeronave, r.revision, r.piloto, r.cedula, cipuTxt(r), r.vigenciaCipu, r.piloto2?.nombre || r.observador || "", r.piloto2?.cedula || "", r.piloto2?.cipu || "", r.serial, r.matricula, r.ruas, ordenTxt(r), r.departamento, r.municipio, r.lugar, fmtDT(r.inicio), fmtDT(r.fin), dur(r.inicio, r.fin), r.estado, nNov(r), nCiclos(r), r.mantVencido ? "SÍ" : "NO", gpsTxt(r.gpsInicio), gpsTxt(r.gpsCierre), r.hash || "", novs,
      ...columnasTiempos(r)]);
  }
  return "﻿" + rows.map(r => r.map(csvC).join(";")).join("\r\n");
}

/* ---------------- acciones ---------------- */
function irAlPaso() {
  const P = progreso(S.cur); if (!P.next) { $("#cierre")?.scrollIntoView({ block: "start" }); return; }
  const el = document.getElementById("k_" + P.next.key.replace(/\./g, "_")) || document.querySelector(".sec.cur");
  el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
/* ---------------- contador entre pasos: alerta a los 10 segundos ---------------- */
const LIMITE_SEG = 10, REPETIR_SONIDO_SEG = 6;
let audioCtx = null;
function prepararAudio() { // debe llamarse desde un toque del usuario (requisito de iOS)
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (e) { }
}
function pitar() {
  if (!audioCtx) return;
  try {
    // Campanada de dos tonos tipo «master caution» (ding-dong ×2), con armónicos para que suene claro al aire libre
    const t0 = audioCtx.currentTime + 0.02;
    const maestro = audioCtx.createGain(); maestro.gain.value = 0.9; maestro.connect(audioCtx.destination); S._sonando = maestro;
    const nota = (frec, t) => {
      [[1, 0.55], [2, 0.18], [3, 0.08], [4.2, 0.04]].forEach(([mult, vol]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = frec * mult; o.connect(g); g.connect(maestro);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.start(t); o.stop(t + 0.95);
      });
    };
    [[1318.5, 0], [987.8, 0.32], [1318.5, 0.9], [987.8, 1.22]].forEach(([f, d]) => nota(f, t0 + d));
  } catch (e) { }
  try { navigator.vibrate?.([300, 150, 300]); } catch (e) { }
}
function silenciar() {
  try { if (S._sonando) { S._sonando.gain.cancelScheduledValues(audioCtx.currentTime); S._sonando.gain.setValueAtTime(0, audioCtx.currentTime); S._sonando.disconnect(); S._sonando = null; } } catch (e) { }
  try { navigator.vibrate?.(0); } catch (e) { }
}
let wakeLock = null;
async function mantenerPantalla(on) {
  try { if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); } if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) { }
}
/* Devuelve la sección empezada y no terminada, con el segundo desde el último paso marcado. */
function estadoCrono(rec) {
  const P = progreso(rec); if (!P.next || rec.estado === "cerrada") return null;
  const gk = p => p.sec.id + (p.ciclo ? "#" + p.ciclo : "");
  const grupo = P.st.filter(p => gk(p) === gk(P.next));
  const hechos = grupo.map(p => rec.resp[p.key]).filter(Boolean);
  if (!hechos.length) return null; // la sección no ha empezado: no se cuenta (p. ej. durante el vuelo)
  const ult = hechos.map(r => r.t).sort().pop();
  return { sec: P.next.sec, ciclo: P.next.ciclo, ult, seg: Math.floor((Date.now() - new Date(ult)) / 1000) };
}
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
setInterval(async () => {
  const c = $("#crono"), al = $("#alertaPaso");
  if (S.view !== "run" || !S.cur || !c) { document.body.classList.remove("en-alerta"); return; }
  // La alerta queda justo debajo de la barra superior (su alto cambia con la barra de horas).
  const tb = document.querySelector(".topbar"); if (tb) document.documentElement.style.setProperty("--alto-topbar", tb.offsetHeight + "px");
  const e = S.noteFor || S.relojEv ? null : estadoCrono(S.cur); // mientras escribe una novedad no se cuenta
  document.querySelectorAll(".it.pendiente").forEach(x => { if (!e || e.seg < LIMITE_SEG) x.classList.remove("pendiente"); });
  if (!e) { c.hidden = true; al.hidden = true; document.body.classList.remove("en-alerta"); return; }
  const tarde = e.seg >= LIMITE_SEG;
  if (tarde) { // resaltar el ítem donde quedó la lista
    const nx = progreso(S.cur).next; const el = nx && (document.getElementById("k_" + nx.key.replace(/\./g, "_")) || document.querySelector(".sec.cur .decide"));
    if (el && !el.classList.contains("pendiente")) { el.classList.add("pendiente"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
  c.hidden = false; c.classList.toggle("tarde", tarde);
  c.textContent = tarde ? `⚠ ${mmss(e.seg)} detenido` : `Sección ${e.sec.id} · ${mmss(e.seg)} / ${mmss(LIMITE_SEG)}`;
  document.body.classList.toggle("en-alerta", tarde);
  al.hidden = !tarde;
  if (tarde) {
    const html = `<b>¡CONTINÚE LA LISTA DE CHEQUEO!</b><span>La sección ${esc(e.sec.id)} – ${esc(e.sec.t)} lleva <b id="alSeg" style="font-size:inherit"></b> sin avanzar. No la deje a medias.</span><span class="row" style="flex:0 0 auto">${S._silencioDe === e.ult ? `<span class="small">🔇 Sonido silenciado</span>` : `<button data-a="silenciar">🔇 Silenciar</button>`}<button data-a="ir">Ir al paso pendiente</button></span>`;
    if (al._html !== html) { al.innerHTML = html; al._html = html; } // no rehacer cada segundo: los botones deben poder tocarse
    $("#alSeg").textContent = mmss(e.seg);
    if (S._silencioDe !== e.ult && (S._pitidoDe !== e.ult || Date.now() - S._ultPitido >= REPETIR_SONIDO_SEG * 1000)) { S._pitidoDe = e.ult; S._ultPitido = Date.now(); pitar(); }
    if (S.cur._alertaDe !== e.ult) { // una anotación por cada detención
      S.cur._alertaDe = e.ult; log(S.cur, "alerta-inactividad", { seccion: e.sec.id + (e.ciclo ? " ciclo " + e.ciclo : ""), desde: e.ult });
      await guardar(S.cur);
    }
  }
}, 1000);

async function responder(key, r, n) {
  prepararAudio(); silenciar(); mantenerPantalla(true);
  const rec = S.cur; if (rec.estado === "cerrada") return;
  const paso = progreso(rec).next;
  if (paso?.key !== key) return; // obliga el orden
  const t = nowIso();
  rec.resp[key] = { r, t, ...(n ? { n } : {}) }; rec._ult = key; S.noteFor = null;
  render(); await guardar(rec); setTimeout(irAlPaso, 40);
}

document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-a]"); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === "home") { mantenerPantalla(false); S.view = "home"; S.cur = null; S.relojEv = null; S.confirmBorrar = null; render(); scrollTo(0, 0); }
  else if (a === "nueva") { S.listaId = b.dataset.l; S.view = "nuevo"; render(); scrollTo(0, 0); }
  else if (a === "continuar") { const r = S.recs.find(x => x.id === id); if (!r) return; S.cur = JSON.parse(JSON.stringify(r)); S.relojEv = null; S.view = "run"; render(); setTimeout(irAlPaso, 60); }
  else if (a === "ver") { S.verId = id; S.view = "ver"; render(); scrollTo(0, 0); }
  else if (a === "ir") irAlPaso();
  else if (a === "silenciar") { const e = S.cur && estadoCrono(S.cur); if (e) { S._silencioDe = e.ult; silenciar(); const al = $("#alertaPaso"); al._html = null; } }
  else if (a === "desbloquear") {
    const clave = $("#claveBase").value; if (!clave) { toast("Escriba la clave de la unidad."); return; }
    b.disabled = true; b.textContent = "Verificando…";
    try { const n = await desbloquearBase(clave); toast(`Base activada: ${n} pilotos.`, 3500); render(); }
    catch (e) { b.disabled = false; b.textContent = "Activar base"; toast("Clave incorrecta. Verifique e intente de nuevo.", 4000); $("#claveBase").select(); }
  }
  else if (a === "buscar-cc") { const sfx = b.dataset.sfx || ""; mostrarPiloto(sfx); if (!S["pilotoSel" + sfx] && basePilotos() && soloDig($("#cedula" + sfx).value)) toast("Cédula no encontrada en la base de pilotos."); }
  else if (a === "res" || a === "dec") responder(b.dataset.k, b.dataset.r);
  else if (a === "hora-item") { // botón del evento dentro de su fase: abre el reloj del equipo
    prepararAudio();
    S.relojEv = S.relojEv?.key === b.dataset.k ? null : { key: b.dataset.k, vi: +b.dataset.vi, ev: b.dataset.ev };
    refrescarEventos();
    const i = $("#relojBarra"); if (i) { i.focus(); try { i.showPicker(); } catch (e) { } }
  }
  else if (a === "hora-ya") { const i = $("#relojBarra"); if (i) i.value = horaActual(); }
  else if (a === "hora-cancelar") { S.relojEv = null; refrescarEventos(); }
  else if (a === "hora-guardar") {
    const R = S.relojEv; if (!R || !S.cur) return;
    if (!(await guardarHoraBarra(R.vi, R.ev, $("#relojBarra")?.value))) return;
    S.relojEv = null; refrescarEventos();
    toast(`${R.ev.toUpperCase()} registrado: ${fmtHM(tiemposVuelo(S.cur).vuelos[R.vi]?.[R.ev])}`);
  }
  else if (a === "nov") { S.noteFor = b.dataset.k; render(); const t = $("#nota"); t?.focus(); }
  else if (a === "nov-no") { S.noteFor = null; render(); irAlPaso(); }
  else if (a === "nov-ok") { const n = $("#nota").value.trim(); if (!n) { toast("Escriba la novedad antes de registrarla."); $("#nota").focus(); return; } responder(b.dataset.k, "nov", n); }
  else if (a === "corregir") {
    const rec = S.cur, k = b.dataset.k; if (rec._ult !== k) return;
    log(rec, "corrección", { paso: k, anterior: rec.resp[k] }); delete rec.resp[k];
    const prev = Object.entries(rec.resp).sort((x, y) => x[1].t.localeCompare(y[1].t)).pop(); rec._ult = prev ? prev[0] : null;
    render(); await guardar(rec); setTimeout(irAlPaso, 40);
  }
  else if (a === "foto-del") { S.cur.fotos.splice(+b.dataset.i, 1); render(); await guardar(S.cur); $("#cierre")?.scrollIntoView(); }
  else if (a === "firma-borrar") initFirma();
  else if (a === "cerrar") {
    const rec = S.cur;
    if (S.firmaVacia) { toast("Falta la firma del piloto."); $("#firma")?.scrollIntoView({ block: "center" }); return; }
    if (!$("#decl").checked) { toast("Marque la declaración para cerrar el registro."); return; }
    b.disabled = true; b.textContent = "Tomando ubicación y cerrando…";
    rec.observaciones = $("#obs").value.trim(); rec.firma = $("#firma").toDataURL("image/png");
    rec.gpsCierre = await tomarGPS(10000);
    mantenerPantalla(false); rec.declaracion = true; rec.fin = nowIso(); rec.estado = "cerrada"; delete rec._ult; log(rec, "cierre");
    rec.hash = await huella(rec);
    await guardar(rec); S.verId = rec.id; S.view = "ver"; S.cur = null; render(); scrollTo(0, 0);
    toast("Registro cerrado y firmado. Exporte la evidencia.", 4000);
  }
  else if (a === "pdf") window.print();
  else if (a === "compartir") { const r = S.recs.find(x => x.id === id); entregar(`Evidencia_${safeName(r.plantilla.meta.corto)}_${safeName(r.serial)}_${r.id}.html`, await evidenciaHTML(r), "text/html"); }
  else if (a === "json") { const r = S.recs.find(x => x.id === id); entregar(`Verificacion_${safeName(r.serial)}_${r.id}.json`, JSON.stringify({ tipo: "registro-checklist-uas", version: APP_VERSION, registros: [r] }, null, 1), "application/json"); }
  else if (a === "integridad") { const r = S.recs.find(x => x.id === id); toast((await huella(r)) === r.hash ? "Íntegro: el registro no ha cambiado desde su cierre." : "ATENCIÓN: el registro fue modificado después de cerrarse.", 4500); }
  else if (a === "csv") entregar(`Historial_checklist_UAS_${new Date().toISOString().slice(0, 10)}.csv`, csvHistorial(), "text/csv");
  else if (a === "respaldo") entregar(`Respaldo_checklist_UAS_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ tipo: "registro-checklist-uas", version: APP_VERSION, registros: S.recs }, null, 1), "application/json");
  else if (a === "verificar") { S.verificado = null; S.view = "verificar"; render(); scrollTo(0, 0); }
  else if (a === "importar") {
    let n = 0; for (const x of S.verificado.lista) { if (!S.recs.find(r => r.id === x.rec.id)) { await guardar(x.rec); n++; } }
    toast(n ? `${n} registro(s) guardados en este equipo.` : "Esos registros ya estaban en este equipo."); S.view = "home"; render();
  }
  else if (a === "borrar") { S.confirmBorrar = id; render(); }
  else if (a === "borrar-no") { S.confirmBorrar = null; render(); }
  else if (a === "borrar-si") { await IDB.del(id); S.recs = S.recs.filter(r => r.id !== id); S.confirmBorrar = null; render(); toast("Lista descartada."); }
  else if (a === "actualizar") {
    // Si hay una lista abierta, se retoma sola después de recargar (ya está guardada en el equipo).
    if (S.cur) { try { sessionStorage.setItem("uas_reanudar", S.cur.id); } catch (e) { } }
    if (S.swWaiting) S.swWaiting.postMessage("skipWaiting"); else location.reload();
  }
});

document.addEventListener("input", ev => {
  if (ev.target.id === "cedula" || ev.target.id === "cedula2") { const sfx = ev.target.id === "cedula2" ? "2" : ""; clearTimeout(S["_ccT" + sfx]); S["_ccT" + sfx] = setTimeout(() => mostrarPiloto(sfx), 350); }
  if (ev.target.id === "filtro") { S.filtro = ev.target.value; const pos = ev.target.selectionStart; render(); const f = $("#filtro"); f.focus(); f.setSelectionRange(pos, pos); }
});

document.addEventListener("change", async ev => {
  const id = ev.target.id;
  if (id === "dpto") llenarMunicipios();
  if (id === "selSerial" || id === "selMatricula" || id === "selRuas") syncNave(ev.target);
  if (id === "xlsBase" && ev.target.files[0]) {
    try { const n = await importarExcel(ev.target.files[0]); toast(`Base cargada: ${n.pilotos} pilotos y ${n.aeronaves} aeronaves.`, 4000); render(); }
    catch (e) { toast("No se pudo leer el Excel: " + (e?.message || e), 6000); }
  }
  if (ev.target.id === "foto" && ev.target.files[0]) {
    try { const data = await comprimirFoto(ev.target.files[0]); (S.cur.fotos ||= []).push({ t: nowIso(), data }); await guardar(S.cur); render(); $("#cierre")?.scrollIntoView(); }
    catch (e) { toast("No se pudo leer la foto."); }
  }
  if (ev.target.id === "vfile" && ev.target.files[0]) {
    try {
      const j = JSON.parse(await ev.target.files[0].text());
      const regs = j.registros || (j.id ? [j] : []); if (!regs.length || !regs[0].plantilla) throw new Error();
      const lista = []; for (const rec of regs) { lista.push({ rec, estado: !rec.hash ? "abierta" : (await huella(rec)) === rec.hash ? "ok" : "mod" }); }
      S.verificado = { lista, ok: lista.every(x => x.estado === "ok") }; render();
    } catch (e) { toast("El archivo no es una evidencia válida de esta app."); }
  }
});

document.addEventListener("submit", async ev => {
  if (ev.target.id !== "fNuevo") return; ev.preventDefault();
  const g = id => ($("#" + id)?.value || "").trim(); const L = S.listas.find(x => x.id === S.listaId);
  mostrarPiloto(); mostrarPiloto("2");
  const p = S.pilotoSel, p2 = S.pilotoSel2, cc2 = soloDig(g("cedula2"));
  if (!p && (!g("manNombre") || !g("manCipu"))) { toast("Escriba el nombre y el certificado CIPU del Piloto No. 1."); $("#manNombre")?.focus(); return; }
  if (cc2 && cc2 === soloDig(g("cedula"))) { toast("El Piloto No. 2 no puede ser el mismo Piloto No. 1."); $("#cedula2").focus(); return; }
  if (cc2 && !p2 && (!g("manNombre2") || !g("manCipu2"))) { toast("Escriba el nombre y el certificado CIPU del Piloto No. 2."); $("#manNombre2")?.focus(); return; }
  const piloto2 = cc2 ? { nombre: p2 ? p2.nombre : g("manNombre2"), cedula: cc2, cipu: p2 ? p2.cipu : g("manCipu2"), vigencia: p2 ? p2.vigencia : "", sede: p2 ? p2.sede : "", manual: !p2 } : null;
  let nave;
  if ($("#selSerial")) { nave = flotaDeLista(L)[+g("selSerial")]; if (!nave) { toast("Seleccione la aeronave."); $("#selSerial").focus(); return; } }
  else nave = { serial: g("txtSerial"), matricula: g("txtMatricula"), ruas: g("txtRuas"), manual: true };
  const ult = lsGet("uas_ult_datos", {}); Object.assign(ult, { cedula: soloDig(g("cedula")), cedula2: cc2, [L.id + "_serial"]: nave.serial, dpto: g("dpto"), mpio: g("mpio") }); lsSet("uas_ult_datos", ult);
  const rec = {
    id: newId(), appVersion: APP_VERSION, lista: L.id, revision: L.meta.revision || "", plantilla: JSON.parse(JSON.stringify(L)),
    piloto: p ? p.nombre : g("manNombre"), cedula: soloDig(g("cedula")), cipu: p ? p.cipu : g("manCipu"), vigenciaCipu: p ? p.vigencia : "", sedePiloto: p ? p.sede : "", pilotoManual: !p,
    serial: nave.serial, matricula: nave.matricula, ruas: nave.ruas || "", aeronaveManual: !!nave.manual, mantVencido: !!(nave.proxMant6 && nave.proxMant6 < hoyISO()), proxMant6: nave.proxMant6 || "",
    piloto2, ordenVuelo: g("orden"), departamento: g("dpto"), municipio: g("mpio"), lugar: g("lugar"),
    equipo: (navigator.userAgent.match(/\(([^)]+)\)/)?.[1] || "").slice(0, 60),
    inicio: nowIso(), fin: null, estado: "en_curso", resp: {}, fotos: [], bitacora: []
  };
  log(rec, "inicio");
  S.cur = rec; S.view = "run"; await guardar(rec); render(); scrollTo(0, 0);
  navigator.storage?.persist?.().catch(() => { });
  tomarGPS().then(async gps => { rec.gpsInicio = gps; if (S.cur?.id === rec.id) S.cur.gpsInicio = gps; await guardar(S.cur?.id === rec.id ? S.cur : rec); });
});

window.addEventListener("online", () => S.view === "home" && render());
window.addEventListener("offline", () => S.view === "home" && render());

/* ---------------- arranque ---------------- */
(async function init() {
  try { await IDB.open(); S.recs = await IDB.all() || []; }
  catch (e) { S.errores.push("Este navegador no permite guardar datos (¿modo privado?). Los registros no se conservarán."); }
  const { out, errores } = await cargarListas(); S.listas = out; S.errores.push(...errores);
  try { S.divipola = await (await fetch("datos/divipola.json")).json(); } catch (e) { S.errores.push("No se pudo cargar la lista de departamentos y municipios."); }
  try { S.flotaWeb = await (await fetch("datos/flota.json", { cache: "no-cache" })).json(); } catch (e) { /* se usa la del Excel si existe */ }
  try {
    S.baseCifrada = await (await fetch("datos/pilotos.enc.json", { cache: "no-cache" })).json();
    // si el equipo ya tiene la clave y se publicó una base más nueva, se actualiza sola
    const bp = basePilotos(), clave = lsGet("uas_clave_base", null);
    if (clave && bp?.origen === "cifrada" && bp.generado !== S.baseCifrada.generado) await desbloquearBase(clave).catch(() => { });
  } catch (e) { S.baseCifrada = null; }
  let reanudar = null; try { reanudar = sessionStorage.getItem("uas_reanudar"); sessionStorage.removeItem("uas_reanudar"); } catch (e) { }
  const abierta = reanudar && S.recs.find(r => r.id === reanudar && r.estado !== "cerrada");
  if (abierta) { S.cur = JSON.parse(JSON.stringify(abierta)); S.view = "run"; render(); setTimeout(irAlPaso, 80); toast("App actualizada a la versión " + APP_VERSION + ". Continúe la lista.", 4000); }
  else render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const avisar = w => {
        if (!w || !navigator.serviceWorker.controller) return;
        S.swWaiting = w;
        if (S.view === "home") render();
        else { const av = $("#avisoVersion"); if (av) av.innerHTML = avisoVersionHTML(); } // sin redibujar la lista
      };
      avisar(reg.waiting);
      reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => w.state === "installed" && avisar(w)); });
      let recargado = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        let reanudar = false; try { reanudar = !!sessionStorage.getItem("uas_reanudar"); } catch (e) { }
        if (!recargado && (!S.cur || reanudar)) { recargado = true; location.reload(); }
      });
      setInterval(() => reg.update().catch(() => { }), 30 * 60 * 1000);
    } catch (e) { /* sin modo offline */ }
  }
})();
