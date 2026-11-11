"""Cifra la base de pilotos del Excel para publicarla en la app sin exponer cédulas.

Uso (en el computador de la unidad, con Python 3):
    pip install openpyxl cryptography
    python herramientas/cifrar_base.py "LISTADO DE PILOTOS DE DRON.xlsx"

Pide la clave de la unidad y genera datos/pilotos.enc.json (AES-256-GCM, clave derivada con
PBKDF2-SHA256 de 310 000 iteraciones). Luego suba ese archivo a GitHub y cambie el número de
CACHE en sw.js. NUNCA suba el Excel.
"""
import base64, datetime, getpass, json, os, re, sys, unicodedata

import openpyxl
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 310_000
SALIDA = os.path.join(os.path.dirname(__file__), "..", "datos", "pilotos.enc.json")


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def leer_pilotos(ruta):
    wb = openpyxl.load_workbook(ruta, data_only=True)
    for ws in wb.worksheets:
        filas = list(ws.iter_rows(values_only=True))
        for i, fila in enumerate(filas[:30]):
            H = [norm(c) for c in fila]
            if "IDENTIFICACION" not in H:
                continue
            col = lambda pred: next(j for j, h in enumerate(H) if pred(h))
            cN = col(lambda h: h.startswith("NOMBRES")); cC = col(lambda h: h == "IDENTIFICACION")
            cP = col(lambda h: "CERTIFICADO" in h and "IDONEIDAD" in h and not h.startswith("CUENTA"))
            cV = col(lambda h: h.startswith("VIGENCIA")); cS = col(lambda h: h.startswith("SEDE"))
            out = []
            for r in filas[i + 1:]:
                if not r or not r[cC] or not r[cN]:
                    continue
                out.append({"nombre": " ".join(str(r[cN]).split()), "cedula": re.sub(r"\D", "", str(r[cC])),
                            "cipu": str(r[cP] or "").strip(), "vigencia": str(r[cV] or "").strip(),
                            "sede": " ".join(str(r[cS] or "").split())})
            return out
    raise SystemExit("No se encontró la hoja de pilotos (columna IDENTIFICACION).")


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    pilotos = leer_pilotos(sys.argv[1])
    clave = os.environ.get("CLAVE_BASE") or getpass.getpass("Clave de la unidad: ")
    if len(clave) < 10:
        raise SystemExit("La clave debe tener al menos 10 caracteres.")
    sal, iv = os.urandom(16), os.urandom(12)
    k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITER).derive(clave.encode("utf-8"))
    datos = json.dumps({"pilotos": pilotos}, ensure_ascii=False).encode("utf-8")
    cifrado = AESGCM(k).encrypt(iv, datos, None)
    b64 = lambda b: base64.b64encode(b).decode()
    paquete = {"formato": "ubpd-pilotos-v1", "generado": datetime.datetime.now().isoformat(timespec="seconds"),
               "iter": ITER, "sal": b64(sal), "iv": b64(iv), "datos": b64(cifrado)}
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(paquete, f, indent=1)
    print(f"{len(pilotos)} pilotos cifrados en {os.path.normpath(SALIDA)}")


if __name__ == "__main__":
    main()
