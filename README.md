# Mambo Pilot

PWA in Svelte + TypeScript per pilotare un **Parrot Mambo** via **Web Bluetooth**, senza l'app ufficiale.

## Cosa fa

- Connessione BLE diretta al drone (nessun APK, nessun backend)
- Batteria in tempo reale, stato di volo, avvisi batteria bassa, quota (se il firmware la invia), contatore foto
- Decollo / atterraggio, stick virtuali multi-touch, flip nelle 4 direzioni
- Foto con la camera verticale, cannone e pinza
- Impostazioni: inclinazione massima, velocità verticale e di rotazione, flat trim
- **Percorsi**: registra i comandi che dai e li rigioca con gli stessi tempi (salvati in `localStorage`)
- Gamepad standard tramite Gamepad API
- Tasto **STOP MOTORI** sempre visibile (canale emergenza ad alta priorità)
- Modalità demo: apri con `?demo` per provare l'interfaccia senza drone

## Requisiti

- **Chrome su Android** (o Chrome/Edge desktop). Safari/iOS non supportano Web Bluetooth.
- Pagina servita in **HTTPS** (o `localhost`).
- **FlyPad spento**: il Mambo accetta una sola connessione BLE alla volta.

## Sviluppo

```bash
npm install
npm run dev        # http://localhost:5173 (e sulla LAN, ma senza HTTPS il BLE non va)
npm run build      # output in dist/
npm run check      # type-check
```

Per provare dal telefono durante lo sviluppo, il modo più rapido è il port forwarding USB di Chrome
(`chrome://inspect` → Port forwarding `5173 → localhost:5173`): sul telefono apri `localhost:5173` e il BLE funziona.

## Deploy

`dist/` è statico e usa percorsi relativi, quindi va bene ovunque ci sia HTTPS:
GitHub Pages (anche in una sottocartella tipo `/mambo-pwa/`), il tuo hosting, Cloudflare Pages, ecc.
Una volta aperta dal telefono: menu di Chrome → **Installa app**.

## Struttura

```
src/
  lib/mambo/protocol.ts   # ID comandi ARSDK, encoding/decoding pacchetti
  lib/mambo/connection.ts # Web Bluetooth: handshake, coda scritture GATT, loop PCMD 20 Hz, ack
  lib/drone.svelte.ts     # stato reattivo (runes), azioni, registrazione/replay
  lib/gamepad.svelte.ts   # Gamepad API
  lib/components/         # Joystick, Recorder
  App.svelte              # cockpit
public/                   # manifest, service worker, icone
```

## Protocollo in breve

Pacchetto: `[tipo u8][seq u8][project u8][class u8][cmd u16 LE][argomenti LE]`, enum come `u32`.
UUID: `9a66XXXX-0800-9191-11e4-012d1540cb8e`.

| Canale | UUID | Uso |
|---|---|---|
| `fa0a` | invio senza ack | solo PCMD (stick), 20 Hz |
| `fa0b` | invio con ack | tutti gli altri comandi |
| `fa0c` | alta priorità | emergenza |
| `fa1e` | ack | conferma dei dati ricevuti su `fb0e` |
| `fb0e` / `fb0f` | notifiche | eventi dal drone (batteria, stato, foto…) |

Gli ID vengono da `minidrone.xml` e `common.xml` dell'ARSDK Parrot. L'encoding è verificato byte per byte
contro pyparrot.

## Limiti noti

- **Foto**: vengono salvate nella memoria del drone; lo scaricamento via BLE FTP non è implementato.
- **Percorsi**: niente GPS né posizione assoluta, quindi il replay è "a comandi" e accumula deriva.
- **Quota**: alcuni firmware non inviano `DroneAltitude`; in quel caso il chip non compare.
- Le impostazioni di volo vengono inviate al drone ma non rilette.
- Il FlyPad probabilmente non viene visto come gamepad standard dal telefono; un controller generico sì.

## FlyPad Lab

`public/flypad-lab.html` (servito come `/flypad-lab.html`) è una pagina autonoma che si collega al FlyPad,
guida l'utente passo per passo (stick e tasti) e genera un report con la mappatura dei byte delle notifiche
`9e35fa01` / `9e35fb01`. Serve per scrivere il supporto al FlyPad come joystick dentro l'app.
