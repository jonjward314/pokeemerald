# Playing Emerald in a phone browser

This branch compiles the game's C source straight to WebAssembly (based on
[tripplyons/pokeemerald-wasm](https://github.com/tripplyons/pokeemerald-wasm)).
There is no emulator: the browser runs the game's own code, and a small layer
in `src/wasm_display.c`, `include/wasm/` and `web/` stands in for the Game Boy
hardware.

## Build

On Ubuntu 24.04 (other systems: same tools, different install command):

```sh
sudo apt-get install -y build-essential libpng-dev clang-20 lld-20 binutils-arm-none-eabi nodejs
curl -LsSf https://astral.sh/uv/install.sh | sh   # Python runner used by the asset scripts
make -j4 tools
make -j4 wasm            # writes build/wasm/pokeemerald.wasm
make serve-wasm          # play at http://localhost:8000
make wrangler-site       # copies the playable site into dist/cloudflare
```

Use clang 20 or newer. Ubuntu's default clang 18 builds a file that runs but
shows only a black screen. The Makefile picks `clang-20` automatically when
it is installed.

The normal GBA build (`make`) still works and still matches the original ROM.

## Host it

There are two ways. Both are free on Cloudflare, and neither needs a server
of your own.

### Option A: quick, saves stay on each phone

`dist/cloudflare` is a plain folder of files (about 12 MB), so any static
host works.

1. Create a free Cloudflare account.
2. **Workers & Pages → Create → Pages → Upload assets**: name the project, drag
   in the contents of `dist/cloudflare`, deploy.
3. In the project, **Custom domains → Set up a custom domain**. Then add the
   family login as in step 6 below (only the Access application and policy;
   the `[vars]` part is for Option B).

Saves live only in each phone's browser (see Saves below).

### Option B: family site with account saves (recommended)

The game is served by a small Cloudflare Worker (`worker/index.js`) that also
keeps every player's save in a Cloudflare D1 database, keyed by the email
they sign in with. A cleared browser or a new phone continues the same game,
and the last 20 saves per player are kept for rolling back. GitHub rebuilds
and republishes the site every time the `web` branch changes.

1. **Cloudflare account.** Create one, and add your domain to it (or plan to
   use a subdomain such as `emerald.example.com`).
2. **Database.** **Storage & Databases → D1 → Create**, name it
   `emerald-saves`. Open its **Console** tab, paste the contents of
   `worker/schema.sql`, and run it. Copy the database's **ID** into
   `database_id` in `wrangler.toml`.
3. **Deploy key for GitHub.** In Cloudflare, **My Profile → API Tokens → Create
   Token → "Edit Cloudflare Workers" template → Create**. Copy the token. Also
   copy your **Account ID** (shown on the Workers & Pages overview page).
   Put the Account ID in `account_id` in `wrangler.toml`. In GitHub, open the
   repository's **Settings → Secrets and variables → Actions → New repository
   secret** and add `CLOUDFLARE_API_TOKEN`.
4. **First deploy.** Push any change to `web`. From then on every change to
   `web` deploys by itself. (**Actions → Run workflow** only appears once the
   workflow is on the default branch.)
5. **Your address.** The Worker is served at
   `emerald.<your-account>.workers.dev`. If your domain's DNS is on Cloudflare,
   you can instead add it under **Workers & Pages → emerald → Settings →
   Domains & Routes → Custom domain**. If your DNS stays elsewhere (for
   example IONOS), add a plain HTTP redirect there from your subdomain to the
   workers.dev address. Don't use "masked" or framed forwarding: the sign-in
   page and Add to Home Screen don't work inside a frame.
6. **Family login.** On a workers.dev address, open **Workers & Pages →
   emerald → Settings → Domains & Routes**, and turn on **Cloudflare Access**
   for the workers.dev route. On a custom domain, use **Zero Trust → Access →
   Applications → Add → Self-hosted** with that address. Either way, and add a policy that allows your family's email
   addresses (one-time code by email, free for up to 50 people). Then copy two
   values into `wrangler.toml` under `[vars]`:
   - `ACCESS_TEAM_DOMAIN`: your team domain, like `yourfamily.cloudflareaccess.com`
     (Zero Trust → Settings → Custom pages).
   - `ACCESS_AUD`: the application's **Application Audience (AUD) Tag**
     (on the application's Overview tab).
   The Worker checks Access's signed sign-in token, so saves are only read or
   written for the person actually signed in.
7. **Phones.** Open the address, sign in, then **Share → Add to Home Screen**
   (iPhone) or **⋮ → Add to Home screen** (Android).

To try the Worker locally: put `DEV_PLAYER_EMAIL=you@example.com` in a
`.dev.vars` file (it skips the sign-in check, so never deploy it), run
`npx wrangler d1 execute emerald-saves --local --file worker/schema.sql`, then
`npx wrangler dev`.

The built game contains Nintendo's graphics, music and text. Keep it behind
the family login; do not publish it openly.

## Admin page and house rules

`/admin` (for example `https://emerald.wardtechnet.com/admin`) is for the
game admin only. The Worker lets a signed-in family member through only if
the SHA-256 of their email is in `ADMIN_EMAIL_SHA256` in `wrangler.toml`
(hashes keep the address out of this public repository). Make one with
`printf '%s' you@example.com | sha256sum`.

The **Game rules** section sets, for everyone or for one player:

- EXP from battles, prize money from trainers and the wild encounter rate,
  each as a percent of normal (0% encounters turns wild battles off).
- The game clock: the device's real time, shifted by some hours, or locked
  to one hour of the day (the day still changes at midnight). Berries,
  tides and daily events follow it.
- A day and night look: outdoor maps get an evening or night tint.

Rules live in the `rules` table of the D1 database (the Worker creates it).
The game reads them at start-up, every 5 minutes and whenever it comes back
to the front; `web/app.js` writes them into `gWasmRules`
(`include/wasm_rules.h`), and small `#if WASM` hooks apply them. The browser
also feeds the game's real-time clock, which had no real time behind it in
the web build before. Replays (`?automate=1`) skip rules and the clock so
they stay deterministic; add `&rules=1` to test with them.

## Saves

Saving in the game writes the save into that browser. On the Option B site it
is also sent to your account a moment later, and when the game opens it uses
whichever copy is newer. **More** shows whether the account copy is up to
date. **More → Back up save** downloads a copy; **Restore save** loads one,
including a `.sav` from a real cartridge or an emulator.

## Sound

The game's own sound engine runs in the browser: music, sound effects and
Pokémon cries are mixed in C (a portable rewrite of the GBA engine, from the
pokeemerald-multiplatform project) and played through Web Audio. The song and
instrument data are assembled into `build/wasm/sound.bin` (which is why the
build needs `binutils-arm-none-eabi`), and the page loads it into the game's
memory at start. Sound starts on the first tap or key press, because browsers
don't allow pages to make noise before that. **More → Sound** turns it off.
It is muted at faster speeds.

## Known gaps

- Link features (trading, link battles, Union Room) have no browser connection yet.
