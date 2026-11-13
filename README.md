# COURTSIDE

A 3D street basketball game for desktop browsers. Make a player, run 1v1 / 2v2 / 3v3 with friends or the computer, and build rivalries.

## How to run it

You need **Node.js 20 or newer**. Check with `node -v` in Terminal. If you don't have it, get the LTS version from https://nodejs.org.

```bash
cd ~/Documents/Courtside
npm install        # first time only
npm run dev        # starts the game server and the game
```

Then open **http://localhost:5173** in Chrome, Edge, Firefox or Safari.

`npm run dev` runs two things together:
- the **game server** on port 2567 (matches, accounts, friends, saving)
- the **game client** on port 5173 (what you open in the browser)

Stop both with `Ctrl + C`.

## Play with a friend

**Same computer (for testing):** open a second window in a different browser (or a private window), or add `?profile=2` to the address: `http://localhost:5173/?profile=2`. Each one is a separate player.

**Same Wi-Fi:** your friend opens `http://YOUR-MAC-IP:5173` (Vite prints the "Network" address when it starts). macOS may ask to allow incoming connections — say yes.

**Over the internet:** you need to host the server online (see "Hosting" below).

Then: one player goes to **PLAY → OPEN PRIVATE COURT**, and the other uses **JOIN WITH CODE** (or gets an invite from the FRIENDS screen). Both press **READY UP**.

## Controls

| Key | Action |
|---|---|
| W A S D | Move (relative to the camera) |
| Mouse | Look around (click the court to lock the mouse) |
| Shift | Sprint |
| Hold Left Mouse | Shoot. Release when the meter reaches the green line |
| Right Mouse | Defensive stance and contest |
| Space | Jump: block and rebound |
| Q | Pass |
| C | Dribble move (side = crossover, forward = hesitation, back = between the legs, still = behind the back) |
| R | Step-back (with the ball) / Steal (on defense) |
| E | Check the ball |
| Tab | Box score |
| V | Camera: free / follow hoop |
| 1–8 | Quick messages |
| Esc | Pause |

All keys can be changed in **SETTINGS → CONTROLS**.

## Rules (street rules)

- 1 point inside the arc, 2 points beyond it.
- First to 11, win by 2, game ends at 15. (Host can change to 7, 15 or 21.)
- After a steal or defensive rebound you must **clear it** (take it behind the arc) before you shoot.
- 12 second shot clock in 1v1, 14 in team games.
- Losers' ball after a score (host can switch to "make it, take it").

## What's in the game

- **4 courts made in Blender:** THE BLOCK (dusk neighborhood court), SKYLINE (rooftop at night), COASTLINE (beach), THE LAB (indoor gym).
- **Modes:** 1V1 Showdown, 2V2 Duos, 3V3 Park, Shootout, Dunk Contest, plus Shootaround in lobbies.
- **Real multiplayer:** the server runs every match. It decides scores, wins and rewards. Players can't fake them.
- **Friends and rivalries:** friend codes, requests, invites, challenges, head-to-head records with streaks, recent opponents, block and report.
- **Progression:** REP and ranks (Rookie → Legend), coins, cosmetics. No pay-to-win: every play style has the same total stats.
- **My Player:** skin tone, height, 6 hair styles, jersey colors and number, shorts, socks, 6 shoes, gear, celebrations, nameplates.
- **Offline practice:** works with no server (nothing is saved).

## Where things are saved

Player accounts, stats, matches and friends are saved by the game server in `server/data/db.json`. Your browser keeps a private key that proves which player you are. If you clear your browser data, you lose access to that player.

## Project layout

```
blender/      Blender scripts, textures and .blend files for every 3D asset
public/assets GLB files the game loads (exported from Blender)
shared/       Game rules and physics (used by both server and browser)
server/       Colyseus game server + REST API + data storage
src/game/     3D engine: rendering, characters, animation, camera, audio
src/ui/       Menus, HUD, lobby, results (React)
src/net/      Talking to the server
tests/        Automated tests
supabase/     Database schema for hosting with Supabase later
```

## Rebuilding the 3D assets in Blender

The courts and character are built by Python scripts, so they can be rebuilt any time. With Blender 4.2+ installed:

```bash
cd blender
python3 make_textures.py textures          # textures are already included; needs: pip3 install numpy pillow
/Applications/Blender.app/Contents/MacOS/Blender --background --python build_the_block.py -- textures out/the_block.blend out/the_block.glb
# same for build_skyline.py, build_coastline.py, build_lab.py, build_character.py
cp out/*.glb ../public/assets/
```

You can also just open the `.blend` files in `blender/out/` and edit them by hand. Re-export as glTF Binary (.glb) into `public/assets/`.

## Tests

```bash
npm test                      # physics, shooting, all modes, rules (36 checks)
npx tsx tests/server.ts       # two real clients on the real server (23 checks)
```

## Hosting (optional, later)

- Run `npm run build`, then `npm start`. This serves the game and the server together on port 2567.
- Put that on any Node host that supports WebSockets (Render, Railway, Fly.io, a VPS).
- Vercel can host the built client only. If you split them, set `VITE_SERVER_URL` to your server's address before building.
- Supabase: the tables and security rules are ready in `supabase/schema.sql`. Switching the server from the JSON file to Supabase still needs a Supabase version of `server/db.ts`, plus your project URL and service key. Those are not included — nothing here uses made-up keys.

## Credits

All 3D models, textures, graffiti art, and sounds are original and made by code for this project. Font: Poppins (SIL Open Font License).
