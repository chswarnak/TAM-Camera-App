# Diwali Party Hub — API contract

Source of truth: `server.js` (routes), `lib/views.js` (snapshot shapes), `lib/party.js` (rules).
All JSON. Errors are `{ "error": "<friendly message>" }` with a 4xx status; show the message in a toast.
Browser helpers in `public/js/common.js` (`Party.api`, `Party.connect`, `Party.toast`, `Party.now`, `Party.qrSvg`, `Party.escapeHtml`, `Party.pressFeedback`).

## Live updates (SSE)

`GET /api/events?role=guest&guestId=<id>` · `?role=tv` · `?role=host&pin=<pin>`

The server drops a stream when its request or response closes or errors, and on the next 15 s heartbeat if the socket died silently. It logs one `[sse]` warning each time open streams climb past 150. There is no cap on guests or streams.

Events:
- `state` — full snapshot for that role, sent on connect and after every change (coalesced ~150 ms).
- `fx` — one-off effects, `data.type` is one of:
  - `newPhoto {photoId, nickname}` (tv, host) — "Just shared by …" burst in the ticker strip; the server has queued the photo to jump the slideshow once, so the TV asks `/api/tv/slideshow/next`
  - `shoutout {from, to, emoji, text}` (tv, host)
  - `roundOpen {roundType}` (guest, tv) — `quiz|poll|guessWho|couples`
  - `reveal {roundType, confetti}` (guest, tv)
  - `trophy {confetti:true}` (tv, guest)
  - `music {action:'play'|'stop'|'next'|'volume', volume?, game?, reason?, playing?, silent?, audioMode?}` (tv; `stop` also host+guest).
    With `audioMode:'system'` the TV plays no MP3 on `play` (the Mac/Spotify does) but still buzzes and flashes on `stop`.
    TV: `play` → resume current track at `volume`; `stop` → pause (keep position), unless `silent` play a 1 s buzzer + red STOP flash
    (and for game `hug` a 5-second hug countdown); `next` → advance track, keep playing if `playing`; `volume` → set volume.
  - `title {title}` (one guest) — AI party title landed
  - `captions {requestId, captions:[...], source:'ai'|'preset'}` (one guest) — AI caption suggestions; empty list = keep presets
  - `reset` — event was reset; guests should clear localStorage identity and show the join form

## Public snapshot (guest + TV)

```
serverNow, joinUrl,
party: { name, hosts[], welcomeLine },
teams: [{ id, name, color, score, members, top:[{id,nickname,title,points}] }]   // sorted by score desc
guests: [{ id, nickname, teamId, title, joinedAt }]                              // sorted by name
connections: [{ a, b, kind:'couple'|'shoutout' }]                                // who's-here graph edges (guest ids)
photos: [{ id, url, caption, autoCaption, guestId, nickname, title, teamId, hearts, createdAt }]  // live only, newest first
round: null | { id, type:'quiz'|'poll'|'guessWho', number, status:'open'|'closed'|'revealed', text, category,
                options: string[] | null, optionsFrom:'list'|'guests', seconds, endsAt|null, openedAt, revealedAt,
                submissions, results: null | { options:[{id,label,votes,teamId?}], correct, teamCorrect:{teamId:n}, author|null, total } }
   // optionsFrom 'guests' → answer is a guest id, pick from `guests` (searchable list, team colour shown)
   // optionsFrom 'list'   → answer is the option index (integer)
   // results.correct: quiz → option index; guessWho → author guest id (or null for host clues without an author)
couples: null | { id, status:'answering'|'revealing'|'done', revealIndex, questions:[{id,text}],
                  pairs:[{id,a,b,teamId,matches,answered}],
                  revealed:[{id,text,pairs:[{pairId,a,b,aSays,bSays,match,awards:[{teamId,team,points}]}]}],
                  me?: null | { pairId, choices:[{id,nickname},{id,nickname}], answers:{questionId: guestId} } }
physical: { game:null|'hat'|'cups'|'hug', status:'idle'|'ready'|'playing'|'stopped', round, remaining, randomStop, volume, trackIndex, stoppedAt, audioMode:'playlist'|'system',
            info: null | { name, rule, unit } }
tv: { pinned: null|'welcome'|'slideshow'|'wall'|'leaderboard'|'whoshere', paused: bool }
trophy: null | { id, kind:'bestPhoto'|'game'|'couples', title, name, subtitle, teamId, guestTitle?, photoUrl, line, at }
commentary: null | { text, at, source }
shoutouts: [{ id, from, to, emoji, text, at }]   // newest first, max 15
banner: string        // "what is happening on TV right now" line for guest home screen
content: { stickers:[{id,emoji,text}], captions:[...], aboutOptions:{sweet[],superpower[],arrival[]}, physicalGames:{hat|cups|hug:{name,rule,unit}}, features:{backdrop} }
me (guest only): null | { id, nickname, teamId, title, about:{company,funFact,talent,sweet,superpower,arrival},
                          hearted:[photoId], myPhotos:[{id,status}], round: null|{id, answer, canVote}, shoutoutsLeft }
```

Host snapshot = public snapshot + `host: { settings, guests (full, with about), photos (all, with status), questions (with answers),
pendingAiQuestions, round (raw), roundHistory, couples (raw), physical (raw), tvStatus:{lastSeen,audioUnlocked,connected},
pin, lanUrls, ai:{ok,detail,...}, tracks, tvClients, guestClients, systemAudioStatus:null|{ok,action,detail,at} }`.

## Guest + TV routes

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/state?guestId=` | | public snapshot |
| POST | `/api/join` | `{id?, nickname, about:{company,funFact,talent,sweet,superpower,arrival}}` | `{me, team:{id,name,color}}` (same call edits the card) |
| POST | `/api/photos` | raw JPEG; headers `x-guest-id`, `x-caption` (encodeURIComponent) | `{id,url,status:'live'|'pending'}` |
| POST | `/api/photos/:id/heart` | `{guestId}` | `{hearted, hearts}` |
| POST | `/api/photos/:id/caption` | `{guestId, caption}` | owner only |
| POST | `/api/caption` | raw 600 px JPEG; headers `x-guest-id`, `x-frame`, `x-props` (comma list, each encodeURIComponent'd as a whole) | `{requestId, presets[]}`; AI result arrives as `fx captions` |
| POST | `/api/rounds/:roundId/answer` | `{guestId, answer}` | `{ok}` |
| POST | `/api/couples/answer` | `{guestId, questionId, choice:<guestId>}` | `{ok}` |
| POST | `/api/shoutouts` | `{guestId, to, sticker}` | entry (429 after 10/hour) |
| GET | `/api/assets` | | `{frames:[{id,name,url}], props:[...], backdrops:[...]}` (any PNG the host drops in shows up) |
| GET | `/api/music` | | `{tracks:[{name,url}]}` |
| POST | `/api/tv/hello` | `{audioUnlocked}` | TV calls every 10 s |
| POST | `/api/tv/slideshow/next` | `{from: photoId \| null}` | `{photoId}`: the next slideshow photo from the server's cursor (`lib/slideshow.js`). `from` is the photo the TV is showing; if it is stale (another TV already moved on) the current photo comes back unchanged, and `null` (fresh page) resumes the current photo. Not broadcast. |
| GET | `/photos/<file>` | | live photos only (host: `?pin=`) |
| GET | `/health` | | `{ok, uptimeSeconds, guests, photos, sse:{total,guest,tv,host}, memoryMb:{rss,heapUsed,heapTotal}}`. Public: counts only, no names, PIN or answers. |

## Host routes (`/api/host/*`, header `x-host-pin` on every call)

`POST /login` · `GET /state` · `POST /settings {partyName,hosts[],approvalMode,commentator}` ·
`POST /teams {name}` · `PATCH /teams/:id {name,color}` · `DELETE /teams/:id` ·
`POST /guests/:id/move {teamId}` · `DELETE /guests/:id` ·
`POST /photos/:id/status {status:'live'|'hidden'|'pending'}` · `DELETE /photos/:id` · `POST /award-best-photo` ·
`POST /score {teamId, points}` (± adjustment) ·
`POST /questions/:type` · `PUT /questions/:type/:id` · `DELETE /questions/:type/:id` · `POST /questions/:type/:id/move {delta:-1|1}`
  (types `quiz {text,category,options[],answer,seconds}`, `poll {text,mostLikely,options[]}`, `guessWho {text,authorId}`, `couples {text}`) ·
`POST /generate-questions` → `{added, usedFallback}` · `POST /ai-questions/:id/approve` · `DELETE /ai-questions/:id` ·
`POST /round/launch {type,questionId}` · `POST /round/next {type?}` · `POST /round/timer {seconds}` · `POST /round/close` · `POST /round/reveal` · `POST /round/end` ·
`POST /couples/pairs {a,b}` · `DELETE /couples/pairs/:id` · `POST /couples/start {questionIds?}` · `POST /couples/reveal-next` · `POST /couples/finish` · `POST /couples/end` ·
`POST /physical/start {game,remaining}` · `POST /physical/round` · `POST /physical/stop` · `POST /physical/options {randomStop,volume,audioMode:'playlist'|'system'}` ·
`POST /physical/next-track` · `POST /physical/eliminate {delta}` · `POST /physical/winner {name,teamId,points}` · `POST /physical/end` ·
`POST /tv {pinned,paused}` · `POST /trophy/clear` · `POST /reset {confirm:'RESET'}`

Quiz rounds start their 20 s timer automatically on launch; the server closes the round when it expires.
