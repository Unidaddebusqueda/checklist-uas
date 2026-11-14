# Listas de Chequeo UAS · UBPD

App web instalable para ejecutar las listas de chequeo de aeronaves UAS **paso a paso**, **sin internet**, y dejar **evidencia** de cada ejecución.

## Qué hace

- Muestra la lista con el mismo formato de la Normal Check List impresa (encabezado, franja de la aeronave, secciones amarillas o rojas y recuadros verdes).
- Obliga a seguir el orden. Cada ítem se marca **CUMPLE**, **N/A** o **NOVEDAD**; la novedad exige una descripción.
- Registra la **hora de cada ítem**, el **GPS** al inicio y al cierre, fotos opcionales, la **firma del piloto** y una declaración.
- Las secciones marcadas como `repetible` (por ejemplo, el cambio de batería) se pueden registrar varias veces.
- Al cerrar, calcula un **código de verificación SHA-256**. Si alguien modifica el registro después, la verificación lo detecta.
- Las correcciones quedan anotadas en una bitácora interna.
- Cada registro guarda una copia de la lista usada, así que los registros viejos no se dañan si después cambia la lista.

### Evidencia que se puede exportar

| Botón | Archivo | Uso |
|---|---|---|
| Guardar PDF / Imprimir | PDF | Hoja de evidencia para archivo o para la Aerocivil |
| Compartir evidencia | `.html` | Reporte completo con fotos y firma. En el iPad se puede enviar por correo o WhatsApp, o guardar en Drive o Archivos |
| Archivo de verificación | `.json` | Datos completos con el código, para verificar la integridad en la oficina |
| Exportar historial | `.csv` | Todos los vuelos del equipo, para abrir en Excel |
| Copia de respaldo | `.json` | Respaldo de todos los registros del equipo |

> Los registros se guardan **en el equipo** (iPad o celular). Exporte la evidencia de cada vuelo y haga copias de respaldo con frecuencia.

---

## 1. Publicar la app en internet (gratis)

La app es una carpeta de archivos estáticos y no necesita servidor propio. Hay dos opciones gratuitas.

### Opción A: GitHub Pages (recomendada)

1. Cree una cuenta en <https://github.com> (gratis).
2. Pulse **New repository**. Nombre: `checklist-uas`, visibilidad **Public**. Luego **Create repository**.
3. Pulse **uploading an existing file** y arrastre **todo el contenido** de la carpeta `checklist-uas` (index.html, app.js, styles.css, sw.js, manifest.webmanifest y las carpetas img, icons y listas). Pulse **Commit changes**.
4. Vaya a **Settings → Pages**. En *Branch* elija `main` y la carpeta `/ (root)`, y pulse **Save**.
5. En uno o dos minutos la app queda en: `https://SU-USUARIO.github.io/checklist-uas/`

### Opción B: Netlify

1. Cree una cuenta en <https://app.netlify.com> (gratis).
2. Vaya a **Sites → Add new site → Deploy manually** y arrastre la carpeta `checklist-uas` completa.
3. Netlify le da una dirección del tipo `https://nombre.netlify.app` que puede renombrar.

> **Privacidad:** la dirección es pública, pero la app **no contiene datos**. Los registros de vuelo quedan solo en cada equipo hasta que el piloto los exporta.

---

## 2. Instalar en el iPad o el celular (una sola vez, con internet)

**iPad / iPhone (Safari):**
1. Abra la dirección de la app en **Safari**.
2. Toque **Compartir** (cuadro con flecha) y luego **Agregar a pantalla de inicio**.
3. Abra la app **siempre desde ese ícono**. iOS guarda por separado los datos del ícono y los de Safari.
4. La primera vez, permita el acceso a la **ubicación**.

**Android (Chrome):** abra la dirección, toque el menú ⋮ y luego **Instalar app** o **Agregar a pantalla principal**.

Después de abrirla una vez con internet, funciona **sin señal**.

---

## 2b. Activar la base de pilotos en cada iPad (una vez)

La cédula del piloto trae automáticamente su **nombre, Certificado CIPU, vigencia y sede**.

1. En la pantalla de inicio, en «Base de pilotos», escriba la **clave de la unidad** y toque **Activar base**.
2. La app confirma: «Base activada: 33 pilotos».

> **Protección de datos (Ley 1581 de 2012):** la base va publicada **cifrada** (AES-256) en `datos/pilotos.enc.json`. Sin la clave no se pueden leer nombres ni cédulas. Entregue la clave solo al personal autorizado y **nunca suba el Excel a GitHub**.

**Cuando cambie el personal:** actualice el Excel y genere de nuevo la base cifrada con la misma clave:
```
pip install openpyxl cryptography
python herramientas/cifrar_base.py "LISTADO DE PILOTOS DE DRON.xlsx"
```
Suba el nuevo `datos/pilotos.enc.json` y cambie el número de CACHE en `sw.js`. Los iPad que ya tienen la clave se actualizan solos.
(Alternativa sin clave: el enlace «cargar desde Excel» de la pantalla de inicio lee el Excel directamente en ese equipo.)

**Aeronaves:** la lista desplegable de *Serial / Matrícula / RUAS* muestra solo las aeronaves del modelo de la lista elegida (columna MODELO del Excel). Las aeronaves con TERRITORIAL «CASO DE HURTO» se excluyen, igual que los Matrice M210. Si el mantenimiento de 6 meses está vencido, la app lo advierte y lo deja anotado en la evidencia. La flota también está publicada en `datos/flota.json` (sin datos personales). Al cargar el Excel en un iPad, esa flota reemplaza la publicada.

**Departamento y municipio** salen de la DIVIPOLA oficial del DANE (`datos/divipola.json`).

---

## 3. Agregar otra aeronave

Cada aeronave es un archivo de texto en la carpeta `listas/`.

1. Copie `listas/m400-l2.txt` con un nombre nuevo, por ejemplo `listas/mavic3e.txt`.
2. Edítelo con el Bloc de notas y guárdelo con codificación **UTF-8**:

```
aeronave: DJI MAVIC 3 ENTERPRISE
corto: Mavic 3E
tipo: NORMAL CHECK LIST
fabricante: DJI
logo: img/logo-dji.png
revision: REV. 1.0 ENE-2026
elaboro: ING. Nombre Apellido

== 1 | INSPECCIÓN INICIAL
!Estuche De Transporte | Requerido/Abierto
Hélices | Puestas/Desplegadas
*Batería | >75%/Puesta

== 3 | ROTACIÓN DE HÉLICES | rojo
Área De Vuelo | Libre/Despejada

== 7 | TRÁNSITO CAMBIO DE BATERÍA | repetible
Batería Dron | Reemplazada
```

| Escriba | Resultado |
|---|---|
| `clave: valor` (antes de la primera sección) | Datos del encabezado: aeronave, corto, modelos (como aparecen en la columna MODELO del Excel, separados por coma), tipo, fabricante, logo, revision, elaboro |
| `== N \| TÍTULO` | Nueva sección |
| `== N \| TÍTULO \| rojo` | Título de sección resaltado en rojo |
| `== N \| TÍTULO \| repetible` | Sección que se puede repetir (pregunta «¿Se realiza?») |
| `Ítem \| Valor esperado` | Ítem normal |
| `Ítem \| Valor \| PRENDE` | Ítem que registra la **hora** de un evento de vuelo: `PRENDE`, `DECOLA`, `ATERRIZA` o `APAGA` |
| `!Ítem \| Valor` | Ítem en rojo (inspección de componente principal) |
| `*Ítem \| Valor` | Ítem en negrilla |
| `# texto` | Comentario (se ignora) |

### Horas de vuelo: PRENDE, DECOLA, ATERRIZA y APAGA

La hora de cada evento es la hora en que el piloto marca el ítem. Con esas horas la app calcula:

- **Tiempo tripulación** = de PRENDE a APAGA.
- **Tiempo aeronave** = de DECOLA a ATERRIZA.

En las listas actuales los eventos están en:

| Evento | Vuelo principal | Cada cambio de batería (sección 7) |
|---|---|---|
| PRENDE | 3 · Inicio Motores (M400: Libre Motores 1, 2, 3, 4) | Inicio Motores |
| DECOLA | 4 · Ascenso | Vuelo Estacionario |
| ATERRIZA | 6 · Call Outs De Alturas… | «Aterrizaje · Confirmado», que la app agrega sola antes del siguiente cambio de batería o de la parada de motores |
| APAGA | 8 · Motores Apagados | «Motores · Apagados», que la app agrega sola al empezar cada cambio de batería |

Cada cambio de batería es un vuelo nuevo. La evidencia muestra una tabla con las cuatro horas de cada vuelo, sus tiempos y el total. Si un evento se marca N/A, no se toma su hora.

3. Agregue el nombre del archivo en `listas/indice.txt`, uno por línea.
4. Si la aeronave es de otro fabricante, ponga su logo en `img/` (PNG) y escriba la ruta en `logo:`.
5. Suba los archivos cambiados a GitHub o Netlify.
6. Abra `sw.js` y cambie `checklist-uas-v1` por `checklist-uas-v2` (v3, v4… en cada cambio). Así los equipos instalados reciben el aviso **«Hay una versión nueva — Actualizar ahora»**.

> **Cambio de revisión:** edite el `.txt`, actualice la línea `revision:` y suba la versión en `sw.js`. Los registros anteriores conservan la revisión con la que se hicieron.

---

## 4. Verificar una evidencia en la oficina

1. Abra la app y toque **Verificar evidencia**.
2. Seleccione el archivo `.json` que envió el piloto.
3. La app muestra **Íntegro** si el registro no cambió desde su cierre, o **MODIFICADO** si fue alterado.
4. Puede guardar esos registros en el equipo de la oficina para tener el archivo central.

---

## Limitaciones conocidas

- La hora proviene del reloj del equipo. Mantenga la fecha y hora automáticas activadas.
- Si se borran los datos de Safari o se desinstala la app, se pierden los registros **no exportados**.
- En algunos iPad, «Guardar PDF / Imprimir» no abre desde el ícono instalado. En ese caso use **Compartir evidencia**, abra el `.html` en Safari y toque Compartir → Imprimir → Guardar en Archivos.
- El código de verificación detecta cambios en el registro, pero no reemplaza una firma digital certificada.
