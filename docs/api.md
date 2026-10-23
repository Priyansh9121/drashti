# Drashti's local API (v1)

Drashti answers on the mandir's local network, once the operator turns the network on (**Phones** in the header, Pro Mode). The phone remote, the stage display and the announcements page use this API; so can a script, or Bitfocus Companion's generic HTTP actions on a Stream Deck. It is loosely modelled on the network API of the presentation software Drashti replaces: actions are short paths such as `/trigger/next` and `/clear/slide`, but every request must carry a paired device's token.

Everything here is **local only**: requests are refused from addresses outside the private ranges, from a Host header that is not this computer's own address or name, and (from a browser) from pages that are not Drashti's own. See README, "The local network", for the security model.

**Not here: the node link.** Output nodes (Session 13: other computers running Drashti as a Node) talk to Main on a port of their own (8741) over TLS with Main's own certificate, which each node pins when it pairs. That link is for Drashti alone and is not part of this API: a script or Companion cannot use it, and it refuses browsers. See README, "Output nodes".

## Basics

- **Address:** `http://<computer>:8740` (the port is set in the Phones panel). Examples below use

  ```sh
  DRASHTI=http://192.168.1.20:8740
  TOKEN=…   # a paired Remote device's token (see "A token for a script")
  ```

- **Versions:** everything is under `/api/v1`. Within v1, fields and requests may be added, never changed or taken away; a change that breaks would come as `/api/v2`.
- **Tokens:** every request except pairing needs `Authorization: Bearer <token>`. There are no cookies, and a token is never put in a URL.
- **Kinds of device:** a **Remote** may run the show (everything below except announcements), a **Stage** device only reads the state, the stage screen's settings and (Session 51) the small previews its audience picture box draws, an **Announcements** device only sends announcements. No device can change the library, the screens, the sound, the stream or any settings.
- **Simple Mode** refuses over the network what it refuses in the operator window (running the show and reading the library stay allowed in both).
- **Roles** (Session 14) change nothing here: a Remote device's requests are an operator's (running the show), so they never need the admin PIN, and no request on this API can do what only an admin may (pairing devices and nodes is done in Drashti's own window).
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
    "stageMessage": false,
    "repeating": { "playlistId": "…", "name": "Lobby pictures" }
  }
}
```

`next` is what Next puts up: the next slide (`{"kind": "slide", "presentationId", "slideIndex"}`), the next playlist item when it is a picture, video or sound (`{"kind": "media", "itemId", "label"}`) or, since Session 51, a video input (`{"kind": "input", "itemId", "label"}`), or `null` when nothing comes next.

`repeating` is a Repeat Slides playlist going round (Session 26d), or `null`. While it goes round, `live.presentationId` is `repeat:` and the playlist's id: its steps are its pictures and its presentations' slides, in order.

| Request                                        | Who           | Answers                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me`                               | any device    | `device`: its name and kind.                                                                                                                                                                                                                                                    |
| `GET /api/v1/status`                           | Remote, Stage | `status`, as above.                                                                                                                                                                                                                                                             |
| `GET /api/v1/state`                            | Remote, Stage | `rev`, `session` and `state`: the whole engine state, as the feed sends it. `session` (since Session 53) is the run of the engine `rev` counts in: its revisions start again from 0 each time Drashti starts.                                                                   |
| `GET /api/v1/stage`                            | Stage         | `groupId`: the stage display's screen group (the first stage group, or null); `languages` it shows in the live Look (null for all); `clock`: the locale and time zone the stage screens write the time in; and `hall` (Session 51, below).                                      |
| `GET /api/v1/hall`                             | Remote        | `groupId`: the hall's screen group (the first audience group, or null), whose settings in the live Look (engine state) the remote's picture follows (Sessions 31–36); `clock`: the locale and time zone Drashti's computer writes the time in; `switches` (Session 50, below).  |
| `GET /api/v1/playlists`                        | Remote        | `playlists`: every playlist and folder (`isFolder`, `parentId`), with templates marked (`template`).                                                                                                                                                                            |
| `GET /api/v1/playlists/{id}/items`             | Remote        | `items`: headers, presentations (with their order), media, empty slots and (Session 51) video inputs (below).                                                                                                                                                                   |
| `GET /api/v1/presentations/{id}`               | Remote        | `presentation`: its groups, slides (as drawn) and arrangements. `{id}` can be a Shastra passage's, as the state names it, percent-encoded (`shastra:pg#14` is `shastra%3Apg%2314`).                                                                                             |
| `GET /api/v1/presentations?offset=0&limit=100` | Remote        | The library a page at a time (Session 18): `presentations` by name (`id`, `name`, `libraryName`, `slideCount`, and a kirtan's `category` or null), `offset` and `total`. `limit` is 100 unless asked for fewer (at most 200). No files, and nothing to change the library with. |
| `GET /api/v1/search?q=words`                   | Remote        | The library searched as the operator window searches it (Session 18): `hits` (`presentationId`, `name`, `libraryName`, and `match`: the title, a kirtan's detail, or a line of slide words with its `slideId`), up to 50, and `more` when more matched.                         |
| `GET /api/v1/messages`                         | Remote        | `messages`: the message templates and how their fields are filled.                                                                                                                                                                                                              |
| `GET /api/v1/timers`                           | Remote        | `timers`: each timer, with when it started (each device works out the time).                                                                                                                                                                                                    |
| `GET /api/v1/logo`                             | Remote        | `logo`: the prop marked as the logo (`id`, `name`), or null.                                                                                                                                                                                                                    |
| `GET /api/v1/looks`                            | Remote        | `looks`: every Look (`id`, `name`), in order (the first is the one Drashti starts with), and `liveId`: the live one.                                                                                                                                                            |
| `GET /api/v1/shastra`                          | Remote        | `texts`: the loaded Shastra texts (`name`, `abbreviation`, `itemCount`), so a script knows which references work.                                                                                                                                                               |
| `GET /api/v1/media/{id}/preview`               | Remote, Stage | A small JPEG of a picture, or one frame of a video (never the file itself): for the remote's pictures and, since Session 51, a stage display's audience picture box.                                                                                                            |

## Running the show (Remote)

```sh
curl -s -X POST "$DRASHTI/api/v1/trigger/next" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$DRASHTI/api/v1/trigger/back" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$DRASHTI/api/v1/blackout"     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"on":true}'
curl -s -X POST "$DRASHTI/api/v1/clear/all"    -H "Authorization: Bearer $TOKEN"
```

| Request                              | Body                                                                                                    | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/trigger/next`          | `{"rev": 12, "session": "…"}` (optional): the revision and run this device saw (`GET /api/v1/state`)    | Next slide, on into the next playlist item. With `rev`, only when the show has not moved since (Sessions 31–36): otherwise nothing changes and the answer says `"changed": false`, so two people pressing Next at once move one slide. With `session` (Session 53), only in that run of the engine, so a revision from before a restart is never taken. The phone remote sends both; without either (Companion, an older phone, the operator window) Next always acts.   |
| `POST /api/v1/trigger/back`          |                                                                                                         | Undoes the last Next exactly while nothing else changed; otherwise Previous.                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /api/v1/trigger/previous`      |                                                                                                         | The slide before.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/v1/trigger/next-item`     |                                                                                                         | The first slide of the next playlist item that can play.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /api/v1/trigger/previous-item` |                                                                                                         | The first slide of the one before.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/v1/trigger/slide`         | `{"presentationId":"…","slideIndex":3,"arrangementId":null,"playlist":{"playlistId":"…","itemId":"…"}}` | Puts a slide up: `slideIndex` is its place in the playing order; `arrangementId` (left out for the presentation's own choice, null for every slide in order) and `playlist` (so Next carries on through the playlist) are optional.                                                                                                                                                                                                                                      |
| `POST /api/v1/trigger/item`          | `{"playlistId":"…","itemId":"…"}`                                                                       | Starts a playlist item: a presentation at its first slide, a picture, video or sound, or (Session 51) a video input, where Main's computer has one of its name (otherwise refused, 409, saying so).                                                                                                                                                                                                                                                                      |
| `POST /api/v1/clear/slide`           |                                                                                                         | Takes the slide down (also `background`, `audio`, `props`, `pip`, `lowerThird`, `messages`, `ticker`, `masks`). `POST /api/v1/clear/pip` takes the picture-in-picture box off (Session 50), going out as its Take off does; `/clear/background` takes a video input off as any background; `/clear/slide` a timer shown alone.                                                                                                                                           |
| `POST /api/v1/clear/all`             |                                                                                                         | Takes everything down (Put it back brings it back).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/v1/repeat/{id}/start`     | `{"slideIndex":2}` or `{}`                                                                              | Starts a Repeat Slides playlist going round (Session 26d), from its first slide or the step given: each is up for the playlist's seconds, the last back to the first.                                                                                                                                                                                                                                                                                                    |
| `POST /api/v1/repeat/stop`           |                                                                                                         | Stops Repeat Slides going round; its slide stays on the screens. Anything else going up, Clear all, or the slide cleared stops it too.                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/v1/put-back`              |                                                                                                         | Brings back what Clear all took down, while nothing else has gone up since.                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/blackout`              | `{"on":true}` or `{}`                                                                                   | Black-out on or off; with no `on`, the other way.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/v1/logo`                  | `{"on":true}` or `{}`                                                                                   | The marked logo instead of the picture, or the picture back; with no `on`, the other way.                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/v1/timers/{id}/start`     |                                                                                                         | Starts (or carries on) a timer; also `/pause` and `/reset`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/v1/messages/{id}/show`    | `{"values":{"plate":"12"}}`                                                                             | Shows a message template with its fields filled in (`{id}` is the template's).                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /api/v1/messages/{id}/hide`    |                                                                                                         | Takes that message off.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/v1/looks/{id}/live`       |                                                                                                         | Makes that Look live: every screen group changes at once. Simple Mode refuses it (403), as it does in the operator window.                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/v1/music/play`            |                                                                                                         | Plays the audio playlist (Session 14): on from where it was paused, or the one played last (or the first) from its start. Refused (409) when there is no audio playlist with a sound that can play. Simple Mode allows it, as it allows Play in the window.                                                                                                                                                                                                              |
| `POST /api/v1/music/pause`           |                                                                                                         | Pauses the audio playlist where it is (it fades out). Refused (409) when no audio playlist is playing.                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/v1/music/next`            |                                                                                                         | The audio playlist's next track (at the end it goes round again, or stops, as the playlist says).                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/v1/music/previous`        |                                                                                                         | The audio playlist's previous track.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/markers/{id}/jump`     | `{"layer":"background"}` or `{"layer":"audio"}`                                                         | Jumps the background video (or, with `audio`, the sound) to one of its file's markers (Session 14), in step on every screen and the audio player. The markers playing are in the state: `layers.background.marks` and `layers.audio.marks` (`id`, `name`, `atMs`). Refused (409) when that marker is not on what is playing.                                                                                                                                             |
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

| From Drashti                                                                                 | Means                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"type":"welcome","device":{"name","kind"}}`                                                | The token is good.                                                                                                                                                                                                      |
| `{"type":"engine","message":{"kind":"snapshot","version","rev","state","sentAt","session"}}` | The whole state. `session` (since Session 53) is the run of the engine it is from: a new run (Drashti started again) counts its revisions from 0 again, so a copy takes a snapshot from another run whatever its `rev`. |
| `{"type":"engine","message":{"kind":"patch","version","baseRev","rev","ops","sentAt"}}`      | A change: apply `ops` (each replaces the value at `path`) to the state at `baseRev`.                                                                                                                                    |
| `{"type":"clock","t0","server"}`                                                             | The answer to a clock message: the engine's time (ms since 1970) when it answered.                                                                                                                                      |
| `{"type":"changed","what"}`                                                                  | Playlists, presentations, messages, props or screens changed: read them again.                                                                                                                                          |
| `{"type":"bye","reason"}`                                                                    | The connection is ending: `revoked` (the device was removed), `unauthorized`, `network-off`, `too-slow`, `not-allowed`.                                                                                                 |

| To Drashti                                 | Means                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `{"type":"hello","token"}`                 | First, always.                                                                                                                   |
| `{"type":"clock","t0":<this device's ms>}` | Clock sync: of a few round trips, the shortest says how far this device's clock is from the engine's (`server - (t0 + t1) / 2`). |
| `{"type":"resync"}`                        | A revision went missing (`baseRev` is not the one held): send the whole state again.                                             |

A `version` the client does not know (`ENGINE_STATE_VERSION` in `src/shared/engine/state.ts`, 13 since Session 52: only additions to 12, below; 12 since Session 48: a background of kind `window`, and Session 50's three additions and Session 51's below, which stayed 12 because no published release had read 12 yet; 11 since Session 44: the lower third's layer; 10 since Sessions 31–36: a slide's `darken`) means the state's shape changed: such a client should stop and say so. Output nodes (Session 13) will follow this same feed.

A background of kind `window` (Session 48) is another app's window live on Main's own screens (`layers.background`: `sourceId`, `name`, `startedAt`). It is there to be named ("A window: Zoom Meeting"), never drawn: it is only on Main's computer. `POST /api/v1/clear/background` takes it off as any background; nothing on the network can put one up.

**Session 50** added three parts to the state, within version 12:

- **A background of kind `input`**: a video input live on Main's own screens, a camera or capture input on that computer (the video mixer's program through its USB output, say) that the operator named in Drashti (`layers.background`: `inputId`, `name`, `device` as the computer names it, `fit` (`fit` or `fill`), `startedAt`, and `fade`: `at` and `durationMs`, the second it dissolves in over). Like a window, it is there to be named ("Video input: Input 1"), never drawn: `POST /api/v1/clear/background` takes it off as any background.
- **A timer shown alone** (the Timers panel's **Show on the screens**): `layers.slide.timer` (`timerId`, `name`) says the slide in the slide's place is Drashti's Timer only layout made for that timer. Its `presentationId` is `timer:` and the timer's id, which no presentation in the library has; `live` stays where the show was, so Next goes on from there. `POST /api/v1/clear/slide` takes it off.
- **The picture-in-picture box**: `layers.pip`, or null. `source` is what it holds: `{"kind":"slides"}` (the slide, made small, while the main picture shows the background), `{"kind":"media","mediaId","media"}` (`media`: `image` or `video`), `{"kind":"input","inputId","name","device"}` or `{"kind":"window","sourceId","name"}`. `place` is where it sits and how it looks: `corner` (`top-left`, `top-right`, `bottom-left` or `bottom-right`, or null once dragged elsewhere), `x` and `y` (its top left, as fractions of the screen's width and height), `size` (`small`, `medium` or `large`: a quarter, a third or two fifths of the screen's width, always 16:9), `border`, `rounded` and `motion` (`fade`, `scale` or `slide`). `swapped` is true when its picture and the main picture changed places, `shownAt` is when it came on, and `changed` (when there is one) is the last Swap or move: its `at`, and the `place` and `swapped` from before it. `pipOff` beside `layers` is the box just taken off and when (`layer`, `at`), so every screen plays its going out from the same moment: null once a box is up again, and after Clear all and Put it back. `POST /api/v1/clear/pip` takes the box off, as Clear all does too.

A phone or a script may clear a video input and take the box off, and since Session 51 put one up only through a playlist or a slide (an item, or a slide's background), never from Media: a playlist's video input item started as any item (`POST /api/v1/trigger/item`), or a slide whose background is one put up (`POST /api/v1/trigger/slide`, or Next onto it). It never chooses a video input itself, or sets up, swaps or moves a box: those are the operator's, in Drashti's own window.

**Audience and Stage** (Session 50): `GET /api/v1/hall` answers with `switches`, whether Main's own audience screens (key and fill too) and stage screens are on: `{"audience": true, "stage": false}`. The operator switches them off in Drashti (their displays then show the computer's desktop, while the show carries on) and on again; both are on at every start. No request on this API turns them. The feed's `{"type":"changed","what":"screens"}` says when to read them again.

**Session 51** added, within version 12:

- **A video input as a playlist item.** `GET /api/v1/playlists/{id}/items` gives one as `{"id", "kind": "input", "label", "name", "missing", "timers"}`. `name` is the input's own name ("Input 1"), by which each computer finds its own input of that name, in any letter case or Unicode form (an input belongs to one computer, while a library travels); `missing` is true while Main's computer has no input of that name: Drashti's window says so, Next goes on past it, and `POST /api/v1/trigger/item` on it is refused (409, "The video input “Input 1” is not on this computer"). Otherwise that request puts the input up as the background, as Next does, and takes the slide off. In the state, `next` can be `{"kind": "input", "itemId", "inputId", "name", "label"}`, and an item in `upcoming` can be of kind `input`.
- **A video input behind a slide.** A slide's background cue (in `GET /api/v1/presentations/{id}`) can name one: its `background` is `{"kind": "input", "name": "Input 1"}`, and its `missing` is always false, since whether Main's computer has that input is known only as the slide goes up. `next` for such a slide carries `input`, the name; and while a slide is up whose cue named an input Main's computer does not have, `layers.slide.inputMissing` names it (the background stays as it was).
- **The hall's picture for a stage display.** `GET /api/v1/stage` answers with `hall`: the hall as Drashti's own stage screens draw it in a layout's audience picture box, `{"groupId", "canvasWidth", "canvasHeight", "scaling"}` (the first audience group with a screen on Main that is on, else the first audience group; the canvas and scaling, `fit`, `fill` or `stretch`, of that screen, else of the group's first, or 1920 × 1080 `fit` while it has none), with `"off": true` while Main's Audience switch has closed that hall's screens (the box keeps the picture and says "Audience off" in its bottom left corner, since Session 52; never for a hall shown on a node alone); null with no audience group (since Session 52 the box is then black and says "No audience screens"). The feed's `{"type":"changed","what":"screens"}` says when to read it again. A Stage device draws the box's pictures and videos as the remote does, from `GET /api/v1/media/{id}/preview`; a video input or a window, which are on Main's computer, it never draws.

**Session 52** raised the version to 13, only adding to 12 (Drashti reads what alpha.11 saved as it is):

- **Start and end points on a slide's, a prop's and the logo's videos.** `layers.slide.clips`, `clips` on each of `layers.props` and on `logo`: by media id, `{"startMs", "endMs"}` (`endMs` null for the file's end), the points from the media library that each such video plays between, looping round between them when it loops, as a background video does with its own `clip`. Only the engine stamps them; a request's are dropped.
- **A missing file behind a slide.** A slide whose background cue's file is missing (not found at import, or deleted from the library) leaves the background as it was: `layers.slide.fileMissing` names the file while that slide is up, and `next` for such a slide has `background: null` and `fileMissing`.

## Companion (Stream Deck)

Bitfocus Companion's **Generic HTTP** connection drives Drashti with a Remote device's token:

1. Pair a Remote device for Companion (above) and keep its token.
2. Add a Generic HTTP connection. For each button, a **POST** action with the URL `http://192.168.1.20:8740/api/v1/trigger/next` (and so on, from the table above), the header `{"Authorization": "Bearer <token>"}`, and, where the request takes one, a JSON body such as `{"on": true}` with `Content-Type: application/json`.
3. Next, Back, Clear all, Black-out (`{}` turns it the other way), Logo and the timers fit on buttons as they are.

The generic module cannot show state on the buttons (which slide is up, whether black-out is on). **A dedicated Companion module** would: ask for the Phones panel's code and pair itself (`/api/v1/pair`), keeping its token; follow the state feed (keeping a copy from the snapshot and patches, asking for the whole state when a revision goes missing, connecting again by itself, and taking a snapshot from a new run of the engine whatever its `rev`, since Session 53); offer the actions above (Next with the `rev` and `session` it saw, as the phone remote sends them) with pickers filled from `/playlists`, `/playlists/{id}/items`, `/messages` and `/timers` (re-read when the feed says they changed); give feedbacks (black-out, logo, live slide or item, can put back, a timer running, a message up) and variables (the live slide's words, what is next, the time left on each timer, worked out from the feed's clock), and presets for the usual buttons; and stop with a message when the state's version is one it does not know.

## Events out (webhooks)

The other way round (Session 28): Drashti **sends** a signed `POST` to each address an admin adds under **File › Events Out…**, for the kinds ticked there. Nothing is on until then. An address must be on this computer or the local network, unless an admin allows one `https` address on the internet. A receiver needs nothing from the API above: no token, no pairing.

**The body** is JSON:

```json
{
  "type": "slide.changed",
  "timestamp": "2026-10-16T19:30:05.123Z",
  "data": {
    "presentationId": "…",
    "slideIndex": 2,
    "slideCount": 5,
    "playlistId": "…",
    "itemId": "…",
    "repeat": false
  }
}
```

| `type`                                                   | `data`                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slide.changed`                                          | `presentationId`, `slideIndex`, `slideCount`, `playlistId`, `itemId` (null when not from a playlist), `repeat` (true when a Repeat Slides playlist moved on by itself). A slide taken off: `presentationId` and `slideIndex` null. |
| `item.changed`                                           | `playlistId`, `itemId`.                                                                                                                                                                                                            |
| `blackout.changed`, `logo.changed`                       | `on`.                                                                                                                                                                                                                              |
| `stream.started`, `stream.reconnecting`                  | `places`: how many platforms it goes to.                                                                                                                                                                                           |
| `stream.ended`, `recording.started`, `recording.stopped` | Nothing.                                                                                                                                                                                                                           |
| `announcement.waiting`                                   | `announcementId`.                                                                                                                                                                                                                  |
| `screen.stopped`, `screen.showing`                       | `screenId`: a hall screen stopped, or came back.                                                                                                                                                                                   |
| `backup.finished`                                        | `outcome`: `done`, `skipped` or `failed`.                                                                                                                                                                                          |
| `drashti.test`                                           | Nothing: **Send a test**.                                                                                                                                                                                                          |

**Words** come only where the admin ticked **Include the words** for that kind at that address: `text` for `slide.changed` (the slide's lines, one to a line, 200 characters at most) and `announcement.waiting`, `name` for `screen.stopped` and `screen.showing`. Nothing else ever carries words, and keys, PINs, tokens, pairing codes, addresses and file paths never go.

**The headers:**

| Header                    | Holds                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook-id`              | The event's id (`msg_…`): the same on every try, so a receiver that sees it twice can drop the second.                                                                                                   |
| `webhook-timestamp`       | When this try was sent, in seconds since 1970.                                                                                                                                                           |
| `webhook-signature`       | `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body`, keyed by the secret's bytes ([Standard Webhooks](https://www.standardwebhooks.com)). For a day after **New secret**, two, separated by a space. |
| `X-Drashti-Signature-256` | `sha256=` and the hex HMAC-SHA256 of the body, keyed by the whole secret as shown (`whsec_…`), as GitHub signs its webhooks: for a receiver that can only make a plain HMAC.                             |
| `X-Drashti-Event`         | The `type`, again.                                                                                                                                                                                       |

**Checking one**, in Node (a Standard Webhooks library does the first for you):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** `body` exactly as it arrived, before any JSON parsing. */
function fromDrashti(secret, headers, body) {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // more than 5 minutes off
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
  return headers['webhook-signature'].split(' ').some((s) => same(s, want));
}

/** Or the plain one. */
const githubStyle = (secret, headers, body) =>
  same(
    headers['x-drashti-signature-256'],
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
  );
```

In n8n, the **Crypto** node's HMAC (SHA256, hex, the secret as shown) of the body as it arrived, with `sha256=` before it, should equal `X-Drashti-Signature-256`.

**Answering.** Answer `2xx` quickly (within 15 seconds; the body is not read). Anything else is tried again: at once, then after 5 s, 30 s, 2 min, 10 min and 30 min, and then the event is given up (the dialog counts those). Events to one address go one at a time, in order; slide changes within 250 ms of each other go as the last one. A `410` turns the address off until an admin turns it on again; a `404`, a redirect (never followed) or another `4xx` means the address is set up wrongly, and is tried only twice more. Events waiting when Drashti quits are not sent later.
