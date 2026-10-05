# Drashti's local API (v1)

Drashti answers on the mandir's local network, once the operator turns the network on (**Phones** in the header, Pro Mode). The phone remote, the stage display and the announcements page use this API; so can a script, or Bitfocus Companion's generic HTTP actions on a Stream Deck. It is loosely modelled on the network API of the presentation software Drashti replaces: actions are short paths such as `/trigger/next` and `/clear/slide`, but every request must carry a paired device's token.

Everything here is **local only**: requests are refused from addresses outside the private ranges, from a Host header that is not this computer's own address or name, and (from a browser) from pages that are not Drashti's own. See README, "The local network", for the security model.

## Basics

- **Address:** `http://<computer>:8740` (the port is set in the Phones panel). Examples below use

  ```sh
  DRASHTI=http://192.168.1.20:8740
  TOKEN=…   # a paired Remote device's token (see "A token for a script")
  ```

- **Versions:** everything is under `/api/v1`. Within v1, fields and requests may be added, never changed or taken away; a change that breaks would come as `/api/v2`.
- **Tokens:** every request except pairing needs `Authorization: Bearer <token>`. There are no cookies, and a token is never put in a URL.
- **Kinds of device:** a **Remote** may run the show (everything below except announcements), a **Stage** device only reads the state and the stage screen's settings, an **Announcements** device only sends announcements. No device can change the library, the screens, the sound, the stream or any settings.
- **Simple Mode** refuses over the network what it refuses in the operator window (running the show stays allowed in both).
- **Answers** are JSON: `{"ok": true, …}`, or `{"ok": false, "message": "…"}` with an HTTP status:

  | Status   | Meaning                                                                                                                              |
  | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
  | 400      | The request is not right (a missing field, a slide that does not exist).                                                             |
  | 401      | No token, or one Drashti does not know (the device was removed): pair again.                                                         |
  | 403      | This kind of device may not do this, Simple Mode refuses it, or the request came from outside the local network or another web page. |
  | 404      | No such request, playlist, presentation or media item.                                                                               |
  | 405      | That request takes another method (actions are `POST`).                                                                              |
  | 409      | The show cannot do it now (nothing is live, nothing to put back, no logo marked).                                                    |
  | 413, 415 | The body is too large (16 KB at most), or is not JSON.                                                                               |
  | 421      | The Host header is not this computer's address.                                                                                      |
  | 429      | Too many requests (about 20 a second per device), or too many wrong pairing codes.                                                   |
  | 503      | Drashti is busy; try again.                                                                                                          |

- **Actions** answer `{"ok": true, "changed": true, "rev": 42}`: `rev` is the engine state's revision after the action, which the state feed reaches too. Actions are `POST`, so a link or a browser's prefetch can never set one off. A body, when there is one, is JSON (`Content-Type: application/json`).

## A token for a script

Pair a **Remote** device in Drashti (Phones, then Pair a Remote device) and exchange the six-digit code (it works once, for two minutes) with `POST /api/v1/pair`, the one request that needs no token (five wrong codes a minute from one address, and every try is refused for the rest of the minute):

```sh
curl -s -X POST "$DRASHTI/api/v1/pair" -H 'Content-Type: application/json' -d '{"code":"123456"}'
# {"ok":true,"token":"…","device":{"name":"Remote 1","kind":"remote"}}
```

The token is shown this once; Drashti keeps only its hash. Keep it like a password. To take it away, remove the device in the Phones panel: it stops working at once.

## Reading

```sh
curl -s "$DRASHTI/api/v1/me" -H "Authorization: Bearer $TOKEN"
# {"ok":true,"device":{"name":"Remote 1","kind":"remote"}}

curl -s "$DRASHTI/api/v1/status" -H "Authorization: Bearer $TOKEN"
```

`GET /api/v1/status` (Remote, Stage) says where the show is, in short:

```json
{
  "ok": true,
  "status": {
    "live": {
      "presentationId": "…",
      "slideIndex": 2,
      "slideCount": 5,
      "playlist": { "playlistId": "…", "itemId": "…" },
      "onScreen": true
    },
    "blackout": false,
    "logo": false,
    "canPutBack": false,
    "next": { "kind": "slide", "presentationId": "…", "slideIndex": 3 },
    "messages": [{ "id": "message:…", "text": "Car 12 please move" }],
    "ticker": [{ "id": "…", "text": "Placeholder: prasad in the hall after arti" }],
    "timers": [{ "id": "…", "name": "Sabha starts in", "kind": "countdown", "running": true }],
    "stageMessage": false
  }
}
```

| Request                            | Who           | Answers                                                                                                                                                                                                        |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me`                   | any device    | `device`: its name and kind.                                                                                                                                                                                   |
| `GET /api/v1/status`               | Remote, Stage | `status`, as above.                                                                                                                                                                                            |
| `GET /api/v1/state`                | Remote, Stage | `rev` and `state`: the whole engine state, as the feed sends it.                                                                                                                                               |
| `GET /api/v1/stage`                | Stage         | `groupId`: the stage display's screen group (the first stage group, or null); `languages` it shows in the live Look (null for all); and `clock`: the locale and time zone the stage screens write the time in. |
| `GET /api/v1/playlists`            | Remote        | `playlists`: every playlist and folder (`isFolder`, `parentId`), with templates marked (`template`).                                                                                                           |
| `GET /api/v1/playlists/{id}/items` | Remote        | `items`: headers, presentations (with their order), media and empty slots.                                                                                                                                     |
| `GET /api/v1/presentations/{id}`   | Remote        | `presentation`: its groups, slides (as drawn) and arrangements. `{id}` can be a Shastra passage's, as the state names it, percent-encoded (`shastra:pg#14` is `shastra%3Apg%2314`).                            |
| `GET /api/v1/messages`             | Remote        | `messages`: the message templates and how their fields are filled.                                                                                                                                             |
| `GET /api/v1/timers`               | Remote        | `timers`: each timer, with when it started (each device works out the time).                                                                                                                                   |
| `GET /api/v1/logo`                 | Remote        | `logo`: the prop marked as the logo (`id`, `name`), or null.                                                                                                                                                   |
| `GET /api/v1/looks`                | Remote        | `looks`: every Look (`id`, `name`), in order (the first is the one Drashti starts with), and `liveId`: the live one.                                                                                           |
| `GET /api/v1/macros`               | Remote        | `macros`: every macro (`id`, `name`, `color`), in order.                                                                                                                                                       |
| `GET /api/v1/shastra`              | Remote        | `texts`: the loaded Shastra texts (`name`, `abbreviation`, `itemCount`), so a script knows which references work.                                                                                              |
| `GET /api/v1/media/{id}/preview`   | Remote        | A small JPEG of a picture, or one frame of a video (never the file itself).                                                                                                                                    |

## Running the show (Remote)

```sh
curl -s -X POST "$DRASHTI/api/v1/trigger/next" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$DRASHTI/api/v1/trigger/back" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$DRASHTI/api/v1/blackout"     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"on":true}'
curl -s -X POST "$DRASHTI/api/v1/clear/all"    -H "Authorization: Bearer $TOKEN"
```

| Request                              | Body                                                                                                    | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/trigger/next`          |                                                                                                         | Next slide, on into the next playlist item.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/trigger/back`          |                                                                                                         | Undoes the last Next exactly while nothing else changed; otherwise Previous.                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /api/v1/trigger/previous`      |                                                                                                         | The slide before.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/v1/trigger/next-item`     |                                                                                                         | The first slide of the next playlist item that can play.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /api/v1/trigger/previous-item` |                                                                                                         | The first slide of the one before.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/v1/trigger/slide`         | `{"presentationId":"…","slideIndex":3,"arrangementId":null,"playlist":{"playlistId":"…","itemId":"…"}}` | Puts a slide up: `slideIndex` is its place in the playing order; `arrangementId` (left out for the presentation's own choice, null for every slide in order) and `playlist` (so Next carries on through the playlist) are optional.                                                                                                                                                                                                                                      |
| `POST /api/v1/trigger/item`          | `{"playlistId":"…","itemId":"…"}`                                                                       | Starts a playlist item: a presentation at its first slide, or a picture, video or sound.                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /api/v1/clear/slide`           |                                                                                                         | Takes the slide down (also `background`, `audio`, `props`, `messages`, `ticker`, `masks`).                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/v1/clear/all`             |                                                                                                         | Takes everything down (Put it back brings it back).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/v1/put-back`              |                                                                                                         | Brings back what Clear all took down, while nothing else has gone up since.                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/blackout`              | `{"on":true}` or `{}`                                                                                   | Black-out on or off; with no `on`, the other way.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/v1/logo`                  | `{"on":true}` or `{}`                                                                                   | The marked logo instead of the picture, or the picture back; with no `on`, the other way.                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/v1/timers/{id}/start`     |                                                                                                         | Starts (or carries on) a timer; also `/pause` and `/reset`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/messages/{id}/show`    | `{"values":{"plate":"12"}}`                                                                             | Shows a message template with its fields filled in (`{id}` is the template's).                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /api/v1/messages/{id}/hide`    |                                                                                                         | Takes that message off.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/v1/looks/{id}/live`       |                                                                                                         | Makes that Look live: every screen group changes at once. Simple Mode refuses it (403), as it does in the operator window.                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/v1/macros/{id}/run`       |                                                                                                         | Runs that macro: its actions in order, as one change. Simple Mode refuses it (403); a macro that names something gone, or an action a macro may not do, is refused (409) and nothing changes.                                                                                                                                                                                                                                                                            |
| `POST /api/v1/shastra`               | `{"reference":"SD 14"}`                                                                                 | Puts up a Shastra passage by its reference, with each loaded text's own abbreviations: `SD 14`, a range `SD 14-16`, or with a section `Vach G.Pr. 1`. Answers with `reference`, as the screens write it. A reference that names nothing is refused (404) with why ("No loaded text is called “XY”…"). The passage plays like a presentation (its id is in `status.live.presentationId`; `GET /api/v1/presentations/{id}` gives its slides), and Next goes on through it. |

## Announcements (Announcements devices)

```sh
curl -s -X POST "$DRASHTI/api/v1/announcements" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"text":"Placeholder: prasad in the hall after arti","from":"Placeholder name","minutes":10}'
curl -s "$DRASHTI/api/v1/announcements/$ID" -H "Authorization: Bearer $TOKEN"
```

| Request                          | Body                                   | Answers                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/announcements`     | `{"text":"…","from":"…","minutes":10}` | `202` and `announcement` (`id`, `status: "waiting"`). The words (1 to 200 characters, on one line), who it is from (1 to 60) and how long to show it (1 to 120 minutes). Nothing reaches the screens until approved. |
| `GET /api/v1/announcements/{id}` |                                        | `announcement`: its `status` (`waiting`, `showing`, `ended` or `rejected`) and `until` (when it comes off by itself). Only for announcements this device sent.                                                       |

A phone (a device from one address) can have 3 announcements waiting at a time, and the queue holds 30; more get `429` until the operator has decided. The operator approves an announcement as a message (from a message template) or in the ticker along the bottom of the audience screens (README, "Announcements from phones").

## The state feed (WebSocket)

`ws://<computer>:8740/api/v1/feed` (Remote and Stage devices). The first message must say who the device is, within five seconds:

```js
const ws = new WebSocket('ws://192.168.1.20:8740/api/v1/feed');
ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  // {type:'welcome', device}, then {type:'engine', message: {kind:'snapshot', rev, state, …}},
  // then each change as {type:'engine', message: {kind:'patch', baseRev, rev, ops}}.
};
```

| From Drashti                                                                            | Means                                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `{"type":"welcome","device":{"name","kind"}}`                                           | The token is good.                                                                                                      |
| `{"type":"engine","message":{"kind":"snapshot","version","rev","state","sentAt"}}`      | The whole state.                                                                                                        |
| `{"type":"engine","message":{"kind":"patch","version","baseRev","rev","ops","sentAt"}}` | A change: apply `ops` (each replaces the value at `path`) to the state at `baseRev`.                                    |
| `{"type":"clock","t0","server"}`                                                        | The answer to a clock message: the engine's time (ms since 1970) when it answered.                                      |
| `{"type":"changed","what"}`                                                             | Playlists, presentations, messages, props or screens changed: read them again.                                          |
| `{"type":"bye","reason"}`                                                               | The connection is ending: `revoked` (the device was removed), `unauthorized`, `network-off`, `too-slow`, `not-allowed`. |

| To Drashti                                 | Means                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `{"type":"hello","token"}`                 | First, always.                                                                                                                   |
| `{"type":"clock","t0":<this device's ms>}` | Clock sync: of a few round trips, the shortest says how far this device's clock is from the engine's (`server - (t0 + t1) / 2`). |
| `{"type":"resync"}`                        | A revision went missing (`baseRev` is not the one held): send the whole state again.                                             |

A `version` the client does not know (`ENGINE_STATE_VERSION` in `src/shared/engine/state.ts`) means the state's shape changed: such a client should stop and say so. Output nodes (Session 13) will follow this same feed.

## Companion (Stream Deck)

Bitfocus Companion's **Generic HTTP** connection drives Drashti with a Remote device's token:

1. Pair a Remote device for Companion (above) and keep its token.
2. Add a Generic HTTP connection. For each button, a **POST** action with the URL `http://192.168.1.20:8740/api/v1/trigger/next` (and so on, from the table above), the header `{"Authorization": "Bearer <token>"}`, and, where the request takes one, a JSON body such as `{"on": true}` with `Content-Type: application/json`.
3. Next, Back, Clear all, Black-out (`{}` turns it the other way), Logo and the timers fit on buttons as they are.

The generic module cannot show state on the buttons (which slide is up, whether black-out is on). **A dedicated Companion module** would: ask for the Phones panel's code and pair itself (`/api/v1/pair`), keeping its token; follow the state feed (keeping a copy from the snapshot and patches, asking for the whole state when a revision goes missing, and connecting again by itself); offer the actions above with pickers filled from `/playlists`, `/playlists/{id}/items`, `/messages` and `/timers` (re-read when the feed says they changed); give feedbacks (black-out, logo, live slide or item, can put back, a timer running, a message up) and variables (the live slide's words, what is next, the time left on each timer, worked out from the feed's clock), and presets for the usual buttons; and stop with a message when the state's version is one it does not know.
