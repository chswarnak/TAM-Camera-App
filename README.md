# 🪔 Diwali Party Hub

Diwali Party Hub is a party app that runs on one computer at your home party. Guests scan a QR code and their phone becomes a photo booth and a game controller. There's no app to install, no account and no cloud service. A TV in the room shows a slideshow of everyone's photos, live quiz questions, poll results, a leaderboard, music games with a STOP buzzer, and a "Who's here" screen that puts every guest on a glowing diya. The host runs the whole evening from a PIN-protected dashboard on their phone. Everything runs locally over your home Wi-Fi, with optional AI touches (fun party titles, photo captions, quiz commentary) from the Claude Code CLI if you have it.

## Features

- **Phone photo editor**
  - Take or pick a photo, then add Diwali frames, drag-pinch-rotate props (diya, sparkler, crown, garland, sunglasses…), filters and a caption you can move anywhere.
  - ✨ AI caption suggestions.
  - Save the photo to the phone, or share it to the TV.
- **Slideshow and photo wall**
  - A Ken Burns slideshow that never loses its place, plus a mosaic of the most-loved photos.
  - Guests give photos ❤️ hearts, and the host awards **Best Photo**.
- **Team quiz**: four teams, assigned automatically on join. Each question has a 20-second countdown on the TV and 10 points per correct answer.
- **Polls** and **Most Likely To** (guests vote for another guest).
- **Guess Who**: clues come from guests' "About Me" cards, AI riddles and the host's own clues.
- **Couples Quiz**: both partners answer "Who is more likely to…?" on their own phones. The answers are revealed one by one, and matches score for their teams.
- **Shout-outs**: guests send each other stickers ("You light up the room", "MVP"…), which scroll along the bottom of the TV.
- **Music floor games**
  - Hat Game, Musical Cups and Hug Your Partner.
  - The music stops at a random moment, the TV buzzes and flashes STOP, and the dashboard counts who's left.
  - Music comes from MP3s or from **Spotify mode**, which pauses Spotify on the host Mac.
- **Who's here**: every guest is a glowing node on a giant diya, linked to their partner and to the guests they exchanged shout-outs with. New arrivals fly in with a chime.
- **Leaderboard and trophies**: team scores, confetti, and trophies such as Best Photo and Most In Sync Couple.
- **Host dashboard** (PIN protected): a one-tap Run Party strip, plus tabs for Guests, Photos, Questions, Rounds, Couples, Floor Games, TV and Setup.
- **TV auto-cycle**: Slideshow (60 s) → Leaderboard (15 s) → Who's here (20 s), on repeat until you launch a game. A "Scan to join" QR code is always in the corner.
- **After the party**: one command makes a highlights video and a zip of all photos.

## Requirements

| What | Notes |
| --- | --- |
| **macOS or Linux** computer | It stays on for the whole party and runs the server. |
| **Node.js 18+** | Check with `node -v`. Get it from [nodejs.org](https://nodejs.org). |
| **Google Chrome** for the TV page | Connect the computer to the TV with HDMI or AirPlay. Another computer or smart-TV browser on the same Wi-Fi also works. |
| A Wi-Fi network that every phone and the computer share | Read [Networking](#networking-read-this-before-the-party) before the party. |
| *Optional:* [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | Logged in (`claude` works in a terminal). It powers the AI touches. No API key is needed. |
| *Optional:* `ffmpeg` and `zip` | Only for the highlights video after the party. |

**What works without the Claude Code CLI:** everything. Party titles, photo captions and commentator lines fall back to hand-written presets from `data/seed.json`, and the AI question generator stays empty, so you write questions yourself. Set `AI_ENABLED=false` to skip the CLI completely.

**Platform notes:** Spotify mode uses AppleScript, so it is **macOS only**. On Linux, use the MP3 playlist. On Linux the highlights script also needs `CHROME_PATH=/usr/bin/google-chrome` (or wherever Chrome is).

## Setup

```sh
git clone <this repo> diwali-party-hub
cd diwali-party-hub
npm install                 # needs internet once; the party itself only needs Wi-Fi
cp .env.example .env
```

Edit `.env`:

```ini
HOST_PIN=4821                          # your dashboard PIN (4–32 characters, no spaces)
HOST_NAMES="Asha, Ravi & Tara"         # shown on the TV header, the join page and the video
PARTY_NAME="Diwali Night 2026"
BACKDROP_ENABLED=false                 # white-wall background swap in the editor (experimental)
AI_ENABLED=true                        # false = presets only, never call the Claude CLI
```

`HOST_NAMES` and `PARTY_NAME` are read at every start and win over anything saved. You can still change them for the current run in the dashboard's **Setup** tab. To change them for good, edit `.env` and restart.

Start the server:

```sh
npm start
```

The terminal prints the addresses, the PIN and a QR code:

```
🪔  Diwali Party Hub is running
────────────────────────────────────────────────────────
  Guests join at:   http://192.168.x.x:3000
  TV screen:        http://localhost:3000/tv
  Host dashboard:   http://localhost:3000/host
  Host PIN:         4821   (from .env)
────────────────────────────────────────────────────────
  <QR code>
```

1. **Guests** scan that QR code (it's on the TV too) or type the `http://192.168.x.x:3000` address. The QR points at the computer's most likely LAN address, usually the Wi-Fi one. Any others are printed as "also reachable".
2. **TV:** open `http://localhost:3000/tv` in Chrome on the computer.
   - Press **F** (or ⌃⌘F on a Mac) for fullscreen.
   - **Click "🔊 Tap to enable sound" once.** Browsers block audio until you click a page. This one click unlocks the music, buzzer and chimes for the whole evening, and the dashboard warns you if it hasn't been done.
   - Send it to the TV with HDMI or AirPlay, and set the sound output to the TV.
   - Stop the screen from sleeping: on macOS run `caffeinate -d` in a spare terminal tab.
3. **Host:** open `/host` on your phone, using the same LAN address as the guests (`http://192.168.x.x:3000/host`), and enter the PIN. Each device stays logged in. After 20 wrong PINs, a device is locked out for five minutes.

If `HOST_PIN` is missing, a random 6-digit PIN is generated on first start and saved to `.env`. If it is still `changeme`, the server warns you at start-up.

## Networking (read this before the party)

Almost every "it doesn't work" at a party turns out to be the network, not the app. These lessons were learned the hard way.

- **Every phone must be on the same Wi-Fi network as the computer.** The app is served from your computer, not the internet, so a phone on mobile data or on another network can't reach it.
- **Guest networks and "client isolation" block it.** Many routers' guest Wi-Fi, and some mesh systems, stop devices from talking to each other (it may be called AP isolation, client isolation or "allow guests to see each other"). Put guests on the main network, or turn isolation off.
- **Home routers often cap the number of devices.** Many ISP routers top out at about **20–50 connected devices or DHCP leases**. Your house already uses a dozen (TVs, speakers, laptops, the doorbell), and 30 guests can push it over. New phones then connect to Wi-Fi but get no address, or older ones get dropped. **For 25+ guests**, use a dedicated travel router or spare home router:
  - Connect the computer to it with an **Ethernet cable**, so the server never fights for airtime.
  - Name the network something obvious ("Diwali Party") and put the name and password on a card by the door.
  - Raise its DHCP pool to 100+ addresses if the setting exists.
  - The router doesn't need internet for the party to work.
- **Mac Internet Sharing** (sharing the Mac's connection as a Wi-Fi hotspot) works in a pinch, but it handles only about **10–15 phones** before connections get flaky.
- **The firewall must allow `node`.**
  - **macOS:** the first `npm start` may ask "Do you want the application node to accept incoming network connections?" Click **Allow**. If you missed it, go to **System Settings → Network → Firewall → Options** and set `node` to *Allow incoming connections* (`which node` shows its path).
  - **Linux:** for example, `sudo ufw allow 3000/tcp`.
  - **Sign of a firewall block:** `localhost` works on the computer, but phones time out.
- **Turn off VPNs** on the computer. A VPN can make the QR point at the wrong address.
- **Keep the computer awake and on power.** If it sleeps, every phone drops off.

**Test with several phones the day before:**

1. Run `npm start` on the same network, in the same room, with the same router you'll use on the night.
2. Get 3–5 phones (family, old phones), including at least one iPhone and one Android. Each one scans the QR, joins, takes and shares a photo, and answers a quiz question.
3. Open `http://localhost:3000/health` on the computer. It shows how many phones are connected live (`sse.guest`).
4. If any phone can't open the page, check that phone's Wi-Fi network name first.

## Running the party

### Runbook

1. **An hour before**
   - Run `npm start`, open `/tv` in Chrome, click *Tap to enable sound*, go fullscreen and send it to the TV.
   - In the dashboard's **TV** tab, pin **Welcome**.
   - Scan the QR with your own phone to prove the Wi-Fi works.
2. **On the dashboard**
   - Check the team names and colours (**Guests** tab).
   - Make sure music is ready (**Floor Games** tab; see below).
   - Optionally turn on **Approval Mode** (**Setup**) so photos wait for your OK before the TV shows them.
3. **Guests arrive**
   - Set the TV back to **Auto-cycle**.
   - Shared photos appear within about two seconds, and new arrivals fly onto Who's here.
   - Tap **Hide** on any photo you don't want on the TV (**Photos** tab).
4. **Games**
   - Once most guests have joined, tap **✨ Generate Party Questions** (**Questions** tab) and approve the ones you like.
   - Then pick the question type in the Run Party strip and press **Next Question** → **Reveal**, again and again.
5. **Floor games**: run them from the **Floor Games** tab (see below).
6. **Couples Quiz**: run it from the **Couples** tab (see below).
7. **Wrap up**: press **Award Best Photo**, then pin **Leaderboard** on the TV for the final standings.

### What each dashboard control does

**Run Party strip** (always at the top):

| Control | What it does |
| --- | --- |
| **Photos** | Jumps to the Photos tab. The badge counts photos waiting for approval. |
| **Next question:** type picker + **Next Question** | Launches the next unused question of that type (Quiz, Poll, Most Likely To, Guess Who) on every phone and on the TV. Quiz questions start their countdown automatically. |
| **Reveal** | Closes answers, shows the results on the TV and awards points. During a Couples Quiz it reveals the next couple's answer. |
| **Start Physical Game** | Opens the Floor Games tab. |
| **Award Best Photo** | Asks you to confirm, then shows the most-hearted photo as a trophy with confetti. |

**Tabs:**

| Tab | What you do there |
| --- | --- |
| **Guests** | See everyone who joined. Move a guest to another team, remove a guest, rename or recolour teams, and **+ Add team**. |
| **Photos** | Every shared photo. **Hide** or show any of them, and approve pending ones when Approval Mode is on. |
| **Questions** | Add, **Edit** or **Delete** questions for Quiz, Poll, Guess Who and Couples. **Approve** or delete the AI-generated ones. |
| **Rounds** | The live round: answer counts, **Close answers**, restart the timer, and round history. |
| **Couples** | Pair couples, pick up to five questions, and run the Couples Quiz. |
| **Floor Games** | Choose the music source, the game and the starting count. **Start Round**, **Stop Now**, **Random Stop**, **Next Track**, Eliminate −1 / Remove a Cup, **Show trophy**, **End game**. |
| **TV** | **Auto-cycle**, or pin a screen: Welcome, Slideshow, Photo Wall, Leaderboard, Who's here. Shows whether the TV's sound is unlocked. |
| **Setup** | Guest join address and PIN. Party name and host names (for this run). **Approval Mode** and the **Commentator** toggle. AI status, music track count, **Reset Event**, and log out. |

### Pairing couples

Couples have to join as guests first. Then go to **Couples**:

1. Pick *Partner 1* and *Partner 2* from the drop-downs and press **Add couple**. Repeat for each couple. Each guest can only be in one couple.
2. Tick up to five questions (edit their wording under **Questions → Couples**).
3. Press **Start Couples**. Each partner's phone asks "Who…?" with both names as buttons.
4. Press **Reveal** (in the strip) or **Reveal next** once per question.
   - When both partners pick the same person, it's a match: each partner's team gets 10 points, or 10 points once if they're on the same team.
   - The most in-sync couple wins a trophy at the end.

Couples also get a line linking them on the Who's here screen. The music games (Hat Game, Hug Your Partner) count couples, so you don't need to pair them in the app for those.

### Music: MP3 playlist or Spotify mode

In **Floor Games → Music source**, choose one:

- **🎵 MP3 playlist** (the default and works everywhere)
  - Drop `.mp3`, `.m4a`, `.aac`, `.wav` or `.ogg` files into `data/music/`; no restart is needed. They play in filename order, so prefix them `01-`, `02-` to set the order.
  - The TV page plays them through the TV speakers, and the volume slider and **Next Track** control them.
  - This repo ships no music. To get a royalty-free 10-second placeholder loop for testing, run `npm run assets`, which also regenerates the bundled artwork.
- **🎧 System audio / Spotify mode** (macOS only)
  - Open Spotify on the host Mac with your playlist queued.
  - **Start Round** presses play. The random stop pauses Spotify, or mutes the Mac if Spotify doesn't answer within 1 second, so the music never runs on past the STOP flash.
  - **Next Track** skips the song, and **End game** undoes any mute the app applied.
  - The first time, macOS asks whether Terminal may control Spotify. Click **OK**. To change it later, go to **System Settings → Privacy & Security → Automation**.

With **Random Stop** on, the music stops 8–25 s into each round, then the TV buzzes and flashes STOP. **Stop Now** always works. The setting is saved, and you can't switch the music source in the middle of a round.

### Resetting test data

You'll want a clean slate after testing and before the real party. Do one of these:

- **From the dashboard:** go to **Setup → Reset Event**, type `RESET`, and press **Reset everything**. This deletes guests, photos, scores and rounds, and restores the starter questions.
- **From the terminal:** stop the server (Ctrl-C) and run:
  ```sh
  rm -f data/state.json data/photos/*.jpg
  npm start
  ```

Prefer the dashboard reset while the test phones are still connected: it also signs those phones out. A phone that still shows the old party after a terminal reset needs its site data cleared in the browser (or use a private tab for testing).

**Developer trick:** run a throwaway instance with 30 fake guests, couples and shout-outs, to see a full Who's here screen:

```sh
DATA_DIR=/tmp/diwali-demo PORT=3400 AI_ENABLED=false HOST_PIN=demo1234 npm start
HOST_PIN=demo1234 node scripts/seed-demo.js --url http://localhost:3400
```

## Customising

### Questions

- **Before the party:** edit `data/seed.json`. It holds quiz questions (`answer` is the 0-based index of the correct option), polls (`"mostLikely": true` makes guests vote for a guest), Guess Who clues, couples questions, party titles, caption presets, commentator lines, shout-out stickers and the floor-game rules. Then reset the event (above) so the new seed loads. `data/seed.json` is only read when the state is fresh or reset.
  - `scripts/make-seed.js` generates `seed.json` and shuffles the quiz options. You can edit either file. If you edit the script, run `node scripts/make-seed.js`.
- **During the party:** use the **Questions** tab. Changes are saved straight away and survive restarts, but a reset puts the seed back.

### Frames, props and backdrops

Drop PNG files into these folders. They show up in the photo editor the next time a phone opens it, with no restart.

| Folder | What goes there |
| --- | --- |
| `public/frames/` | Square transparent PNGs (2000×2000 works well). Frames are drawn **9-slice**: the outer 25 % corners stay intact and the edges stretch to fit any photo shape, so keep the ornaments in the corners and along the edges. |
| `public/props/` | Transparent PNGs, about 512×512, trimmed close to the artwork. |
| `public/backdrops/` | JPG/PNG/WebP landscapes, about 2400×1600. Only used when `BACKDROP_ENABLED=true`, which needs a plain, evenly lit white wall behind people. |

File names become the labels ("marigold-garland.png" → "Marigold Garland").

### Teams and colours

- **Live:** **Guests** tab → change a team's name or colour, or **+ Add team** (up to six colours are pre-picked). New guests join the smallest team.
- **Default:** edit the `teams` array in `data/seed.json` (name plus hex `color`), then reset.

The theme colours (gold, burgundy, cream) are CSS variables at the top of `public/css/theme.css`.

## After the party: highlights video and photo zip

```sh
brew install ffmpeg          # macOS, once (Linux: sudo apt install ffmpeg zip)
npm run highlights           # about 10 minutes for ~60 photos
```

This writes three files to `exports/` (git-ignored):

| File | What it is |
| --- | --- |
| `diwali-night-2026.mp4` | 1080p, 30 fps |
| `diwali-night-2026-whatsapp.mp4` | 720p, under 64 MB, ready to share |
| `diwali-photos.zip` | Every visible photo, full size, in share order |

The video has:
- a title card with the party name and hosts, from `.env`;
- every visible photo with a slow zoom, crossfades and its caption and author in a strip below;
- then "Thank you for coming", the final leaderboard and Best Photo.

The music is the first file in `data/music/`. With none, a gentle synthesized loop is used. Hidden photos are left out. Useful options:
- `CHROME_PATH=…` if Chrome isn't in the default macOS location;
- `DATA_DIR=…` to render another party's data;
- `KEEP_WORK=1` to keep the intermediate files.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| **A phone can't open the link** | 1. Is the phone on the **same Wi-Fi** as the computer, not the guest network and not mobile data?<br>2. Does the computer's firewall allow `node`?<br>3. Did the phone get an IP address at all? If not, the router's device cap is full; see [Networking](#networking-read-this-before-the-party).<br>4. Try the other "also reachable" addresses printed at start.<br>5. If **every** phone spins forever, check that the server wasn't suspended with Ctrl-Z: `ps -o stat -p $(lsof -ti tcp:3000 -sTCP:LISTEN)` shows `T`. Run `fg` in that terminal. |
| **No sound on the TV** | Click *Tap to enable sound* on the TV page; the TV tab on the dashboard says whether it's unlocked.<br>Check the computer's sound output is the TV (HDMI/AirPlay).<br>Check the volume slider in Floor Games.<br>For the MP3 playlist, make sure `data/music/` has files (Setup shows the track count). |
| **Spotify mode doesn't pause** | Allow Terminal to control Spotify in **System Settings → Privacy & Security → Automation**. Floor Games shows the last result ("Spotify pause ✓" or the error). |
| **Photos don't appear on the TV** | Is **Approval Mode** on? Pending photos wait in the Photos tab.<br>Is the photo hidden?<br>Is the TV pinned to a screen other than Slideshow or Photo Wall? Set it back to Auto-cycle.<br>Does the TV say "reconnecting…"? The server stopped or the computer slept. |
| **AI captions/titles are always the presets** | Run `claude -p "say hi"` in a terminal; if it asks you to log in, run `claude` once.<br>Check `AI_ENABLED` isn't `false`.<br>The **Setup** tab shows the last AI status.<br>AI calls time out after 20 s and fall back silently, so the party never waits for them. |
| **The IP address changed** (router reboot, new network) | Restart `npm start`. The new address and QR are printed, and the TV's corner QR updates.<br>Phones that already joined need to open the new address, but they keep their identity when they do.<br>To stop it happening, give the computer a fixed DHCP reservation in the router. |
| **`Port 3000 is busy`** | The hub is already running in another terminal. Use that one, or run `PORT=3001 npm start`. |
| **iPhone won't save the photo** | Press and hold the picture on the Saved screen → *Save to Photos*. iOS doesn't allow automatic downloads over plain `http`. |
| **Mac stays muted after the games** | Press **End game** (it undoes any mute the app applied) or the mute key. |

`GET /health` (for example `curl localhost:3000/health`) shows uptime, guest and photo counts, live connections by role and memory. It's the first thing to check when phones misbehave.

## Privacy

- **Everything runs on your computer.** Guests' nicknames, About Me cards, answers and photos are stored in `data/state.json` and `data/photos/` on your machine and nowhere else. There are no accounts, analytics, CDNs or cloud database, and every font and script is bundled.
- **The only data that leaves the machine** goes to the Claude Code CLI, and only when `AI_ENABLED` is on:
  - a 600 px **photo preview** for AI caption suggestions (deleted from the computer afterwards);
  - short text guests typed themselves (About Me answers, for party titles and Guess Who riddles);
  - team scores, for the commentator line.
  - With `AI_ENABLED=false`, nothing leaves the machine.
- The model is told never to guess names, ages or appearance.
- Guest and TV endpoints never expose quiz answers before the reveal, Guess Who authors, other guests' About Me cards, hidden or pending photos, or the host PIN (covered by tests).
- `.env`, `data/state.json`, `data/photos/`, `data/music/` and `exports/` are git-ignored, so a `git push` never publishes your party.

## Development

```sh
npm test                    # unit, HTTP end-to-end and AI-fallback tests; no network needed
npm run assets              # regenerate frames, props, backdrops, sample photos, placeholder music
node scripts/make-seed.js   # regenerate data/seed.json
```

There's no build step and no framework: plain HTML, CSS and JS in `public/`, and Node with Express on the server. `docs/API.md` is the contract between the server and the three pages.

```
server.js            Express server, routes, start-up banner + terminal QR
lib/party.js         All party rules (teams, photos, rounds, scoring, couples, floor games)
lib/party-config.js  PARTY_NAME / HOST_NAMES from .env
lib/views.js         What each role may see (the privacy boundary)
lib/ai.js            Claude CLI wrapper: queue, timeout, cache, fallbacks
lib/system-audio.js  Spotify / Mac mute control for Spotify mode
lib/sse.js           Server-Sent Events hub
lib/slideshow.js     Server-side slideshow order
lib/store.js         data/state.json with atomic writes
public/              index.html (guests), tv.html, host.html, js/, css/, vendor/, fonts/, frames/, props/, backdrops/
data/seed.json       Starter questions, titles, captions, stickers, teams
scripts/             make-seed, build-assets, seed-demo, highlights
test/                node:test suites
```

## License

MIT. Use it, change it and throw your own party.

```
Copyright (c) 2026 Diwali Party Hub contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Credits

Bundled in `public/`:

| Component | License |
| --- | --- |
| [Fabric.js](http://fabricjs.com) 5.3.0 (`public/vendor/fabric-5.3.0.min.js`), the canvas editor | MIT |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (`public/vendor/qrcode-generator.js`), for the QR codes on the TV and dashboard | MIT |
| [Yatra One](https://fonts.google.com/specimen/Yatra+One), [Playfair Display](https://fonts.google.com/specimen/Playfair+Display) and [Nunito](https://fonts.google.com/specimen/Nunito) fonts, via Fontsource | SIL Open Font License 1.1 |

Runtime npm dependencies:

| Package | License |
| --- | --- |
| [Express](https://expressjs.com) | MIT |
| [dotenv](https://github.com/motdotla/dotenv) | BSD-2-Clause |
| [qrcode-terminal](https://github.com/gtanner/qrcode-terminal) | Apache-2.0 |

Development-only npm dependencies, used by `npm run assets`: [sharp](https://sharp.pixelplumbing.com) (Apache-2.0) and [lamejs](https://github.com/zhuker/lamejs) (LGPL-3.0, used only to encode the placeholder loop; not shipped to browsers).

The frames, props, backdrops and placeholder music were generated for this project and are covered by this repository's MIT license. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
