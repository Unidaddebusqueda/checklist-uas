/* Listas de Chequeo UAS · UBPD
   App web instalable (PWA) que funciona sin internet.
   Los registros se guardan en el dispositivo (IndexedDB) y se exportan como evidencia. */
"use strict";

const APP_VERSION = "1.0.0";
const MAX_CICLOS = 8;
const MAX_FOTOS = 4;
const ENTIDAD = { nombre: "Unidad de Búsqueda de Personas Dadas por Desaparecidas", sigla: "UBPD", logo: "img/logo-ubpd.png" };

/* ---------------- utilidades ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nowIso = () => new Date().toISOString();
const fmtDT = iso => iso ? new Date(iso).toLocaleString("es-CO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
const fmtT = iso => iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
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
    const i = nm.indexOf("|");
    sec.items.push({ n: (i < 0 ? nm : nm.slice(0, i)).trim(), v: i < 0 ? "" : nm.slice(i + 1).trim(), rojo, neg });
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
function pasos(rec) {
  const out = [];
  for (const s of rec.plantilla.secciones) {
    if (s.repetible) {
      for (let c = 1; c <= MAX_CICLOS; c++) {
        const dk = `${s.id}d${c}`; out.push({ kind: "dec", key: dk, sec: s, ciclo: c });
        if (rec.resp[dk]?.r !== "si") break;
        s.items.forEach((it, i) => out.push({ kind: "item", key: `${s.id}c${c}.${i}`, sec: s, ciclo: c, it }));
      }
    } else s.items.forEach((it, i) => out.push({ kind: "item", key: `${s.id}.${i}`, sec: s, it }));
  }
  return out;
}
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
}
function chipEstado(r) {
  if (r.estado === "cerrada") return nNov(r) ? `<span class="chip nov">Cerrada · ${nNov(r)} novedad${nNov(r) > 1 ? "es" : ""}</span>` : `<span class="chip ok">Cerrada sin novedad</span>`;
  return `<span class="chip na">En curso</span>`;
}

function vHome() {
  const recs = [...S.recs].sort((a, b) => (b.inicio || "").localeCompare(a.inicio || ""));
  const abiertas = recs.filter(r => r.estado !== "cerrada");
  const filtro = (S.filtro || "").toLowerCase();
  const hist = recs.filter(r => !filtro || [r.piloto, r.serial, r.mision, r.lugar, r.plantilla?.meta?.corto].join(" ").toLowerCase().includes(filtro));
  return `<div class="sheet">
    ${header({ meta: { tipo: "LISTAS DE CHEQUEO UAS", fabricante: "Manual de Operaciones" } }, "v" + APP_VERSION)}
    ${S.swWaiting ? `<div class="banner info row" style="margin-top:10px;justify-content:space-between"><span>Hay una versión nueva de la app o de las listas.</span><button class="pri" data-a="actualizar">Actualizar ahora</button></div>` : ""}
    ${!navigator.onLine ? `<div class="banner info" style="margin-top:10px">Sin conexión. La app funciona normalmente; los registros quedan guardados en este equipo.</div>` : ""}
    ${S.errores.map(e => `<div class="banner" style="margin-top:10px">${esc(e)}</div>`).join("")}
    ${abiertas.length ? `<h2 style="margin-top:14px">Listas sin cerrar</h2>` + abiertas.map(r => { const P = progreso(r); return `<div class="panel navy"><div class="row" style="justify-content:space-between"><div><b>${esc(r.plantilla.meta.corto)}</b> · ${esc(r.serial)} · ${esc(r.mision)}<div class="small muted">${esc(r.piloto)} · inicio ${esc(fmtDT(r.inicio))} · ${P.done}/${P.total} pasos</div></div><div class="row"><button class="lnk" data-a="borrar" data-id="${esc(r.id)}">Descartar</button><button class="pri" data-a="continuar" data-id="${esc(r.id)}">Continuar</button></div></div>${S.confirmBorrar === r.id ? `<div class="banner row" style="justify-content:space-between"><span>¿Descartar esta lista sin cerrar? No se puede recuperar.</span><span class="row"><button data-a="borrar-no">No</button><button class="warn" data-a="borrar-si" data-id="${esc(r.id)}">Sí, descartar</button></span></div>` : ""}</div>`; }).join("") : ""}
    <h2 style="margin-top:16px">Iniciar lista de chequeo</h2>
    <div class="cards">${S.listas.map(L => `<div class="card">
        ${L.meta.logo ? `<img src="${esc(L.meta.logo)}" alt="" onerror="this.remove()">` : ""}
        <div class="acft">${esc(L.meta.aeronave)}</div>
        <div class="small muted">${esc(L.meta.tipo)} · ${esc(L.meta.revision || "")} · ${L.secciones.length} secciones · ${L.secciones.reduce((a, s) => a + s.items.length, 0)} ítems</div>
        <button class="pri" data-a="nueva" data-l="${esc(L.id)}">Iniciar</button></div>`).join("") || `<p class="muted">No hay listas cargadas.</p>`}</div>
    <div class="row" style="justify-content:space-between;margin-top:20px"><h2 style="margin:0">Historial en este equipo (${recs.length})</h2>
      <div class="row noprint"><button data-a="csv">Exportar historial (CSV)</button><button data-a="respaldo">Copia de respaldo</button><button data-a="verificar">Verificar evidencia</button></div></div>
    ${recs.length > 5 ? `<input id="filtro" placeholder="Buscar por piloto, serial, misión o lugar" value="${esc(S.filtro || "")}" style="margin:8px 0">` : ""}
    <div class="tbl" style="margin-top:8px">${hist.length ? `<table><thead><tr><th>Inicio</th><th>Aeronave</th><th>Piloto</th><th>Misión</th><th>Duración</th><th>Estado</th><th></th></tr></thead><tbody>
      ${hist.map(r => `<tr><td style="white-space:nowrap">${esc(fmtDT(r.inicio))}</td><td>${esc(r.plantilla.meta.corto)}<div class="small muted">${esc(r.serial)}</div></td><td>${esc(r.piloto)}</td><td>${esc(r.mision)}</td><td>${esc(dur(r.inicio, r.fin))}</td><td>${chipEstado(r)}</td><td><button class="lnk" data-a="ver" data-id="${esc(r.id)}">Ver</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:14px;margin:0">${recs.length ? "Ningún registro coincide con la búsqueda." : "Todavía no hay registros. Al iniciar una lista de chequeo aparecerá aquí."}</p>`}</div>
    <p class="foot">Los registros se guardan en este equipo. Exporta la evidencia de cada vuelo y haz copias de respaldo periódicas. · v${APP_VERSION}</p>
  </div>`;
}

function vNuevo() {
  const L = S.listas.find(x => x.id === S.listaId); const last = lsGet("uas_ult_datos", {});
  const f = (id, lab, req, ph, val, type = "text") => `<label class="${req ? "req" : ""}" for="${id}"><span>${lab}</span><input id="${id}" type="${type}" ${req ? "required" : ""} placeholder="${esc(ph || "")}" value="${esc(val || "")}" autocomplete="off"></label>`;
  return `<div class="sheet">${header(L)}<div class="acft">${esc(L.meta.aeronave)}</div>
  <form id="fNuevo"><h1>Datos del vuelo</h1><div class="panel"><div class="form">
    ${f("piloto", "Piloto al mando", 1, "Nombre completo", last.piloto)}
    ${f("licencia", "Licencia / certificado", 1, "N.º de licencia", last.licencia)}
    ${f("serial", "Serial / matrícula de la aeronave", 1, "Serial o matrícula", last[L.id + "_serial"])}
    ${f("observador", "Observador / auxiliar", 0, "Nombre", last.observador)}
    ${f("mision", "Misión / caso", 1, "Ej. Búsqueda sector norte")}
    ${f("lugar", "Lugar", 1, "Municipio, vereda o sitio")}
    ${f("autorizacion", "Autorización / coordinación ATC", 0, "N.º de permiso o dependencia")}
  </div><p class="small muted" style="margin:0">Al pulsar «Comenzar» se registra la hora de inicio y se intenta tomar la ubicación GPS del equipo.</p></div>
  <div class="row"><button type="submit" class="pri">Comenzar lista de chequeo</button><button type="button" data-a="home">Cancelar</button></div></form></div>`;
}

function filaItem(rec, p, isNext, cerrada) {
  const r = rec.resp[p.key]; const it = p.it;
  const cls = ["it", it.rojo ? "rojo" : "", it.neg ? "neg" : "", r ? "s-" + r.r : "", isNext && !cerrada ? "act" : "", !r && !isNext ? "lock" : ""].join(" ");
  let extra = "";
  if (r) extra = `<div class="meta"><span class="t">${fmtT(r.t)}</span><span class="res-${r.r}">${RES[r.r][0]}</span>${r.n ? `<span class="nota">${esc(r.n)}</span>` : ""}${!cerrada && rec._ult === p.key ? `<button class="lnk noprint" data-a="corregir" data-k="${p.key}">Corregir</button>` : ""}</div>`;
  else if (isNext && !cerrada) extra = S.noteFor === p.key
    ? `<div class="note"><label for="nota"><span>Describa la novedad y la acción tomada</span><textarea id="nota"></textarea></label><div class="row"><button class="warn" data-a="nov-ok" data-k="${p.key}">Registrar novedad</button><button data-a="nov-no">Cancelar</button></div></div>`
    : `<div class="acts"><button class="ok" data-a="res" data-r="ok" data-k="${p.key}">✓ CUMPLE</button><button data-a="res" data-r="na" data-k="${p.key}">N/A</button><button class="warn" data-a="nov" data-k="${p.key}">NOVEDAD</button></div>`;
  return `<div class="${cls}" id="k_${p.key.replace(/\./g, "_")}"><div class="ln"><span class="nm">${esc(it.n)}</span><span class="dots"></span><span class="val">${esc(it.v)}</span><span class="mk">${r ? RES[r.r][2] : ""}</span></div>${extra}</div>`;
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

function vRun() {
  const rec = S.cur, L = rec.plantilla, P = progreso(rec), cerrada = rec.estado === "cerrada";
  const pct = Math.round(P.done / P.total * 100);
  const cierre = !P.next && !cerrada ? `<div class="panel navy" id="cierre"><h2>Cierre y firma del registro</h2>
    <div class="grid-kv"><div><b>Pasos</b>${P.done}/${P.total}</div><div><b>Novedades</b>${nNov(rec)}</div><div><b>Duración</b>${dur(rec.inicio, nowIso())}</div></div>
    <label for="obs"><span>Observaciones generales (opcional)</span><textarea id="obs">${esc(rec.observaciones || "")}</textarea></label>
    <div><b class="small">Fotos de evidencia (opcional, hasta ${MAX_FOTOS})</b>
      <div class="fotos" style="margin:6px 0">${(rec.fotos || []).map((f, i) => `<figure><img src="${f.data}" alt="Foto ${i + 1}"><figcaption>${fmtT(f.t)} · <button class="lnk" data-a="foto-del" data-i="${i}">Quitar</button></figcaption></figure>`).join("")}</div>
      ${(rec.fotos || []).length < MAX_FOTOS ? `<label class="small" style="font-weight:normal"><span>Tomar o elegir foto</span><input type="file" id="foto" accept="image/*" capture="environment"></label>` : ""}</div>
    <div><b class="small">Firma del piloto</b><canvas id="firma" class="sig" aria-label="Espacio para firmar con el dedo"></canvas><button class="lnk" data-a="firma-borrar">Borrar firma</button></div>
    <label class="chk" for="decl"><input type="checkbox" id="decl"><span>Declaro que esta lista de chequeo fue ejecutada en campo, ítem por ítem y en el orden establecido, por el piloto <b>${esc(rec.piloto)}</b>.</span></label>
    <div class="row"><button class="pri" data-a="cerrar">Cerrar y firmar registro</button></div></div>` : "";
  return `<div class="sheet">
    <div class="topbar noprint"><div class="info"><b>${esc(L.meta.corto)} · ${esc(rec.serial)}</b> — ${esc(rec.mision)}<br>${esc(rec.piloto)} · inicio ${fmtT(rec.inicio)} · ${P.done}/${P.total}<div class="bar"><i style="width:${pct}%"></i></div></div>
      ${P.next ? `<button data-a="ir">Ir al paso actual</button>` : ""}<button data-a="home">Salir</button></div>
    ${header(L, rec.revision)}<div class="acft">${esc(L.meta.aeronave)}</div>
    ${hojaSecciones(rec, true)}
    ${cierre}
    <p class="foot">${esc(L.meta.elaboro || "")}${L.meta.elaboro ? "<br>" : ""}${esc(ENTIDAD.nombre)}</p></div>`;
}

function datosVuelo(rec) {
  return `<div class="grid-kv" style="margin:10px 0">
    <div><b>Registro</b>${esc(rec.id)}</div><div><b>Estado</b>${rec.estado === "cerrada" ? "CERRADA" : "EN CURSO"}</div><div><b>Novedades</b>${nNov(rec)}</div>
    <div><b>Piloto al mando</b>${esc(rec.piloto)}</div><div><b>Licencia</b>${esc(rec.licencia)}</div><div><b>Observador</b>${esc(rec.observador || "—")}</div>
    <div><b>Serial / matrícula</b>${esc(rec.serial)}</div><div><b>Misión / caso</b>${esc(rec.mision)}</div><div><b>Lugar</b>${esc(rec.lugar)}</div>
    <div><b>Autorización ATC</b>${esc(rec.autorizacion || "—")}</div><div><b>Inicio</b>${esc(fmtDT(rec.inicio))}</div><div><b>Cierre</b>${esc(fmtDT(rec.fin))}</div>
    <div><b>Duración</b>${esc(dur(rec.inicio, rec.fin))}</div><div><b>GPS inicio</b>${esc(gpsTxt(rec.gpsInicio))}</div><div><b>GPS cierre</b>${esc(gpsTxt(rec.gpsCierre))}</div>
    <div><b>Ciclos cambio de batería</b>${nCiclos(rec)}</div><div><b>Correcciones</b>${(rec.bitacora || []).filter(b => b.accion === "corrección").length}</div><div><b>Equipo</b>${esc(rec.equipo || "—")}</div>
  </div>`;
}
function bloqueEvidencia(rec) {
  return `${rec.observaciones ? `<p><b>Observaciones:</b> ${esc(rec.observaciones)}</p>` : ""}
    ${(rec.fotos || []).length ? `<div><b class="small">Fotos</b><div class="fotos">${rec.fotos.map((f, i) => `<figure><img src="${f.data}" alt="Foto ${i + 1}"><figcaption>${esc(fmtDT(f.t))}</figcaption></figure>`).join("")}</div></div>` : ""}
    <div class="row" style="align-items:flex-start;gap:16px;margin-top:8px">
      <div style="flex:1 1 260px"><b class="small">Declaración</b><p style="margin:2px 0">${rec.declaracion ? `El piloto <b>${esc(rec.piloto)}</b> declaró que la lista fue ejecutada en campo, ítem por ítem y en el orden establecido.` : "Registro sin cerrar."}</p>
      ${rec.hash ? `<b class="small">Código de verificación</b><div class="hash">${esc(rec.hash)}</div>` : ""}</div>
      ${rec.firma ? `<div style="flex:0 1 260px"><b class="small">Firma</b><img src="${rec.firma}" alt="Firma del piloto" style="width:100%;max-width:260px;border-bottom:1px solid #000;display:block"><div class="small">${esc(rec.piloto)} · Lic. ${esc(rec.licencia)}</div></div>` : ""}
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
function csvHistorial() {
  const rows = [["Registro", "Aeronave", "Revisión", "Piloto", "Licencia", "Observador", "Serial", "Misión", "Lugar", "Autorización", "Inicio", "Cierre", "Duración", "Estado", "Novedades", "Ciclos batería", "GPS inicio", "GPS cierre", "Código verificación", "Detalle novedades"]];
  for (const r of [...S.recs].sort((a, b) => (a.inicio || "").localeCompare(b.inicio || ""))) {
    const novs = progreso(r).st.filter(p => r.resp[p.key]?.r === "nov").map(p => `${p.sec.id}. ${p.it.n}: ${r.resp[p.key].n}`).join(" | ");
    rows.push([r.id, r.plantilla.meta.aeronave, r.revision, r.piloto, r.licencia, r.observador, r.serial, r.mision, r.lugar, r.autorizacion, fmtDT(r.inicio), fmtDT(r.fin), dur(r.inicio, r.fin), r.estado, nNov(r), nCiclos(r), gpsTxt(r.gpsInicio), gpsTxt(r.gpsCierre), r.hash || "", novs]);
  }
  return "﻿" + rows.map(r => r.map(csvC).join(";")).join("\r\n");
}

/* ---------------- acciones ---------------- */
function irAlPaso() {
  const P = progreso(S.cur); if (!P.next) { $("#cierre")?.scrollIntoView({ block: "start" }); return; }
  const el = document.getElementById("k_" + P.next.key.replace(/\./g, "_")) || document.querySelector(".sec.cur");
  el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
async function responder(key, r, n) {
  const rec = S.cur; if (rec.estado === "cerrada") return;
  if (progreso(rec).next?.key !== key) return; // obliga el orden
  rec.resp[key] = { r, t: nowIso(), ...(n ? { n } : {}) }; rec._ult = key; S.noteFor = null;
  render(); await guardar(rec); setTimeout(irAlPaso, 40);
}

document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-a]"); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === "home") { S.view = "home"; S.cur = null; S.confirmBorrar = null; render(); scrollTo(0, 0); }
  else if (a === "nueva") { S.listaId = b.dataset.l; S.view = "nuevo"; render(); scrollTo(0, 0); }
  else if (a === "continuar") { const r = S.recs.find(x => x.id === id); if (!r) return; S.cur = JSON.parse(JSON.stringify(r)); S.view = "run"; render(); setTimeout(irAlPaso, 60); }
  else if (a === "ver") { S.verId = id; S.view = "ver"; render(); scrollTo(0, 0); }
  else if (a === "ir") irAlPaso();
  else if (a === "res" || a === "dec") responder(b.dataset.k, b.dataset.r);
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
    rec.declaracion = true; rec.fin = nowIso(); rec.estado = "cerrada"; delete rec._ult; log(rec, "cierre");
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
  else if (a === "actualizar") { S.swWaiting?.postMessage("skipWaiting"); }
});

document.addEventListener("input", ev => {
  if (ev.target.id === "filtro") { S.filtro = ev.target.value; const pos = ev.target.selectionStart; render(); const f = $("#filtro"); f.focus(); f.setSelectionRange(pos, pos); }
});

document.addEventListener("change", async ev => {
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
  const g = id => $("#" + id).value.trim(); const L = S.listas.find(x => x.id === S.listaId);
  const ult = lsGet("uas_ult_datos", {}); Object.assign(ult, { piloto: g("piloto"), licencia: g("licencia"), observador: g("observador"), [L.id + "_serial"]: g("serial") }); lsSet("uas_ult_datos", ult);
  const rec = {
    id: newId(), appVersion: APP_VERSION, lista: L.id, revision: L.meta.revision || "", plantilla: JSON.parse(JSON.stringify(L)),
    piloto: g("piloto"), licencia: g("licencia"), serial: g("serial"), observador: g("observador"), mision: g("mision"), lugar: g("lugar"), autorizacion: g("autorizacion"),
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
  render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const avisar = w => { if (w && navigator.serviceWorker.controller) { S.swWaiting = w; if (S.view === "home") render(); } };
      avisar(reg.waiting);
      reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => w.state === "installed" && avisar(w)); });
      let recargado = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!recargado && !S.cur) { recargado = true; location.reload(); } });
      setInterval(() => reg.update().catch(() => { }), 30 * 60 * 1000);
    } catch (e) { /* sin modo offline */ }
  }
})();
