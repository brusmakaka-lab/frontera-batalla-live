# FRONTERA Studio 2 · Batalla TikTok LIVE

Juego vertical **1080 × 1920** con Canvas y HTML/CSS/JavaScript puro en el navegador. La versión 2 incorpora **Euler Stream**, un **panel separado** y una **partida compartida que se recupera al recargar OBS o reiniciar el servidor**. TikFinity sigue disponible como proveedor alternativo.

## Inicio rápido

1. Instala **Node.js 22.15 o superior** desde [nodejs.org](https://nodejs.org/). En el equipo de desarrollo se verificó con Node 24.13.1.
2. Descomprime el proyecto en una carpeta propia. Ejecuta **INICIAR.bat** y conserva esa consola abierta. Si faltan dependencias, el lanzador instala el SDK de Euler y `ws` desde el registro de paquetes; esa primera ejecución necesita internet.
3. Abre el panel: **http://127.0.0.1:8080/admin**.
4. En OBS / TikTok Live Studio, crea una fuente de navegador con **http://127.0.0.1:8080/**. Ancho **1080**, alto **1920**, objetivo **60 FPS**.
5. Para probar, pulsa **Iniciar demo** en el panel. Detén la demo y pulsa **Nueva ronda** antes de conectar el LIVE.

También puedes ejecutar `node servidor.mjs` desde una terminal dentro de la carpeta. El repositorio contiene código y lockfile, y no incluye `node_modules`, claves ni partidas de prueba.

No mantengas dos servidores de este proyecto ejecutándose sobre la misma carpeta de `runtime/`. Abrir varios visores o el panel en varias pestañas sí está permitido: todos observan la misma partida.

## Configurar Euler Stream

1. Crea o utiliza tu cuenta en [Euler Stream](https://www.eulerstream.com/dashboard) y obtén una API key desde su dashboard. Consulta allí los límites del plan; no hace falta contratar un plan desde este juego.
2. En `/admin`, elige **Euler Stream**. Escribe el usuario de TikTok de tu LIVE, sin URL; se admite el prefijo `@` y se elimina al guardar.
3. Pega la clave en **API key de Euler Stream** y pulsa **Guardar configuración**. El campo se vacía tras guardarla; el panel muestra «Clave configurada» sin revelar su valor.
4. Inicia tu LIVE y pulsa **Conectar**. El panel distingue socket abierto, recepción de eventos, creador sin LIVE, fin de transmisión, límite de conexiones y credenciales rechazadas.
5. Si quieres que el servidor conecte al arrancar, marca **Conectar al iniciar el servidor** y guarda la configuración.

Arquitectura: **TikTok LIVE → Euler Stream → servidor Node local → overlay de OBS**. La API key viaja del servidor a Euler; el navegador recibe el estado del juego y no recibe esa clave. El conector solicita `schemaVersion=v2`, `rawMessages=false` y eventos agrupados; transforma comentarios, likes y regalos al formato del motor. El SDK se carga únicamente en Node.

Referencias utilizadas: [WebSocket de Euler](https://www.eulerstream.com/docs/api/websockets), [SDK oficial y formato de mensajes](https://github.com/EulerStream/Euler-WebSocket-SDK), [planes y límites](https://www.eulerstream.com/pricing).

### Configuración por archivo o entorno

Opcionalmente, copia **.env.example** a **.env** y completa:

```dotenv
EULER_API_KEY=tu_clave
TIKTOK_USERNAME=tu_usuario
PORT=8080
```

El panel guarda la clave en `.env` dentro de esta carpeta. También acepta `EULER_API_KEY` como variable del proceso; si existe, tiene prioridad y el panel indica que debes cambiarla allí y reiniciar. No se modifica ninguna variable global de Windows. Las opciones del panel se guardan en `runtime/settings.json`; su usuario guardado tiene prioridad sobre `TIKTOK_USERNAME`.

Para reemplazar la clave, pega una nueva y guarda. Un campo vacío conserva la anterior. La casilla **Borrar la clave guardada** la elimina de `.env`. El servidor solo escucha en `127.0.0.1`, y sus rutas HTTP no publican `.env`, archivos internos ni `runtime/`.

## Mantener TikFinity como alternativa

En el panel selecciona **TikFinity Desktop**, conserva **ws://localhost:21213/**, guarda y pulsa **Conectar**. TikFinity Desktop debe ejecutarse en el mismo equipo y estar conectado al LIVE. [Event API de TikFinity](https://tikfinity.zerody.one/es/).

Hay un solo proveedor activo. Al cambiar proveedor, usuario o clave y guardar, se cierra la conexión anterior. Conectar detiene la generación de demo. No hay cambio automático entre proveedores, para evitar mezclar eventos de dos fuentes. Si necesitas otro puerto para TikFinity, se admiten direcciones WebSocket de loopback; no se admiten hosts remotos en ese campo.

La reconexión usa espera progresiva con un máximo habitual de 30 segundos; un límite de conexiones espera al menos 60 segundos. Credenciales inválidas o permisos rechazados detienen los reintentos hasta corregir la configuración y conectar de nuevo. El estado «socket conectado» no asegura por sí solo que exista un LIVE; el panel informa la recepción real de eventos.

## Panel separado y controles

Abre `/admin` en un navegador normal, fuera de la escena de OBS. Puedes configurar la conexión, pausar/reanudar, terminar o comenzar rondas, guardar, reiniciar victorias, cambiar duración y HP, controlar el audio, ver los MVP y probar eventos.

Las nuevas reglas de **duración y HP** se aplican a la próxima ronda. **Volumen y habilitación de sonido** se aplican inmediatamente tras guardar. «Nueva ronda» vacía combate y ranking de esa ronda, conservando victorias e identidades. «Reiniciar marcador» pone las victorias globales a cero. La pausa se conserva hasta reanudarla, incluso si comienzas otra ronda.

Los eventos sintéticos y atajos de prueba se bloquean mientras el proveedor está conectado, conectando o reintentando. Desconéctalo para simular. La demo desconecta el proveedor; detenerla no borra las tropas que ya generó. Comienza una ronda nueva antes de emitir.

| Tecla | Acción |
| --- | --- |
| D en el overlay | Intenta abrir `/admin` en una ventana separada; si OBS bloquea ventanas, abre la URL manualmente |
| S en el overlay | Desbloquear Web Audio mediante interacción del navegador |
| 1 / 2 | Tropa roja / azul, en modo de pruebas |
| 3 / 4 | Titán rojo / azul |
| 5 / 6 | Meteorito rojo / azul |
| 7 / 8 | Diez likes / regalo de una moneda |

Los atajos 1–8 también funcionan en el panel cuando no estás escribiendo en un campo. En el overlay usan el usuario «Streamer»; en el panel usan el usuario configurado en el simulador.

### Audio en OBS / Live Studio

Habilita efectos y ajusta volumen desde `/admin`. En OBS activa **Controlar audio mediante OBS**, abre **Interactuar** sobre la fuente y pulsa **S**. El navegador necesita una interacción para permitir audio; el panel por sí solo no puede desbloquear el contexto de audio de otra pestaña o de OBS. Repite tras una recarga si vuelve a estar bloqueado y comprueba el mezclador. En Live Studio habilita el audio de esa fuente según su interfaz.

## Recuperación de la partida

El combate y el reloj corren en **Node**, no en las pestañas. Cerrar o recargar el overlay y el panel no reinicia la ronda. Cada visor obtiene un estado inicial completo y actualizaciones a 20 Hz; interpola posiciones y renderiza con objetivo de 60 FPS. Abrir dos fuentes no duplica el combate ni las invocaciones.

El servidor guarda `runtime/partida.json` cada **2 segundos**, además de guardar tras controles y cambios de ronda/resultado. Usa un archivo temporal y reemplazo atómico, con `partida.json.bak` como respaldo. Incluye tropas y su vida/posición, reloj, bases, victorias, ranking, usuarios, likes pendientes, cola, meteoritos y deduplicación de eventos. «Guardar ahora» permite crear un checkpoint explícito.

Al reiniciar el servidor, recupera el checkpoint válido más reciente. Si el principal está dañado, intenta el respaldo. Conserva la pausa y el estado de resultados sin sumar de nuevo una victoria. **El tiempo durante el que el servidor estuvo apagado no se simula**: se retoma desde el checkpoint. Un cierre brusco puede perder hasta unos 2 segundos de progreso; Ctrl+C solicita guardar antes de cerrar. Si falla el guardado por permisos/espacio, el panel lo indica.

El navegador reconecta automáticamente al servidor. La reconexión del proveedor al arrancar depende de la casilla de inicio automático. El estado de demo no se reactiva automáticamente, aunque sus unidades del último checkpoint se recuperen.

Los archivos de `runtime/` contienen datos de los participantes de la partida. No se incluyen en los entregables. Para conservar una partida al actualizar archivos, mantén `runtime/` y `.env` en su carpeta. La versión 1 no tenía checkpoints completos; su combate en memoria no se puede importar a esta versión.

## Mecánicas y ranking

- Chat con `rojo` o comando separado `1`: una básica roja. `azul` o `2`: una azul. Si aparecen ambos colores, se toma el primero mencionado. Un comentario posterior permite cambiar equipo; las tropas anteriores conservan su color.
- Cada 10 likes de un usuario: 3 minis. Se acumulan sobrantes y se ignora `totalLikeCount` global como incremento. Sin equipo previo, se asigna al azar.
- Regalo de **1–10 monedas**: 5 minis + un guerrero por regalo.
- **11–99**: meteorito central, elimina básicos/minis rivales dentro del radio, daña unidades grandes, empuja enemigos y desplaza territorio. Grandes rachas se consolidan en una explosión con potencia máxima ×6.
- **100+**: titán con avatar, alerta y efecto sonoro.
- El nivel usa el precio **unitario** del regalo. Las rachas se cuentan por incremento de `repeatCount`, conservando `groupId` cuando está disponible. El evento final no vuelve a invocar lo ya contabilizado. Un puente propio debe conservar estados intermedios e identificadores.
- Ronda inicial de **180 s**, bases de **10.000 HP**. Gana al destruir la base rival. Al agotar tiempo gana mayor HP; en igualdad decide territorio, y un empate exacto no suma victorias.
- MVP = daño efectivo + tropas realmente desplegadas. Se muestran los tres mejores durante **8 s** y comienza la siguiente ronda automáticamente. No se cuenta daño sobrante sobre enemigos ya muertos.

| Unidad | HP | Daño | Radio | Velocidad px/s |
| --- | ---: | ---: | ---: | ---: |
| Básica | 100 | 10 | 23 | 78 |
| Mini | 45 | 6 | 15 | 135 |
| Guerrero | 300 | 35 | 34 | 62 |
| Titán | 2500 | 150 | 69 | 38 |

Los eventos durante los resultados pueden actualizar equipo y deduplicación pero no generan tropas para la siguiente ronda. Los likes sobrantes se conservan.

## Rendimiento y límites

Simulación fija de 60 pasos/s, proximidad por cuadrícula y fondo de canvas precalculado. Límites: **360 unidades**, **3.000 invocaciones en cola**, **10.000 identidades**, **380 partículas**, **70 textos**, **16 meteoritos** y **8 visores simultáneos**. Los espectadores por encima de esas cotas pueden producir demora o descarte; el panel muestra saturación. Una conexión visual demasiado lenta se cierra y el navegador puede reconectar. El objetivo de 60 FPS depende del hardware y la carga de OBS.

Avatares con CORS anónimo, tiempo máximo de carga de 6,5 s, hasta 8 cargas simultáneas y caché de 420 imágenes. Si la URL falla o bloquea CORS, se dibujan iniciales en canvas; el servidor no descarga ni publica imágenes privadas y no usa proxies externos.

Solo el backend usa dependencias de npm: SDK oficial de Euler Stream y `ws`, con versiones fijadas. El navegador no descarga paquetes ni fuentes remotas. Si E:/Codex está disponible, el lanzador usa `E:/Codex/Caches/pnpm-store` para pnpm; TEMP/TMP solo se cambian dentro del proceso del lanzador y únicamente si ya existe `E:/Codex/Temp/Usuario`.

## Archivos y pruebas

- `index.html`, `style.css`, `game.js`: interfaz y motor compartido.
- `client.js`: visor sincronizado con el servidor.
- `admin.html`, `admin.css`, `admin.js`: panel separado.
- `servidor.mjs`: HTTP local, API de control y stream del estado.
- `server/runtime.mjs`, `server/providers.mjs`, `server/persistence.mjs`: ejecución, conectores y checkpoints.
- `INICIAR.bat`, `.env.example`, `package.json`, `pnpm-lock.yaml`: inicio y configuración.
- `tests/battle.test.cjs`, `tests/server.test.mjs`: pruebas de motor, transporte y recuperación.

Ejecuta `pnpm test` o `node --test --test-isolation=none tests/battle.test.cjs tests/server.test.mjs`. Las pruebas crean carpetas aisladas bajo `work/tests/` y usan credenciales ficticias; no llaman a un LIVE real. `tests/socket-fixture.mjs` conserva un emisor sintético estilo TikFinity en 21214.

Si deseas abrir `index.html` como archivo local, conserva un modo básico compatible con la versión anterior: combate en esa pestaña, TikFinity directo y panel D dentro de la fuente. **Euler, panel separado y recuperación del servidor requieren usar la URL HTTP de la versión 2.** Los parámetros antiguos `?demo=1` o `?debug=1` solo afectan ese modo básico de archivo local.

Antes de emitir, prueba tu LIVE real con Euler o TikFinity y comprueba el audio en OBS/Live Studio. Las pruebas de desarrollo validan el código y el transporte local, sin certificar la disponibilidad de TikTok ni los permisos de tu cuenta.


## Estado del respaldo en GitHub

Código fuente de FRONTERA Studio 2, versión 2.0.0. Preparado desde la carpeta de desarrollo el 16/11/2026. Incluye los dos conectores, motor, overlay, panel, persistencia, pruebas, lanzador, configuración de ejemplo y lockfile. No incluye credenciales, partidas, participantes, dependencias instaladas ni resultados generados.

Este repositorio conserva el código; el juego se ejecuta localmente siguiendo el inicio rápido. Para publicar una copia de tu trabajo no se concede automáticamente una licencia de terceros sobre SDKs, servicios o marcas.
