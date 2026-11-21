# Playing Emerald in a phone browser

This branch compiles the game's C source straight to WebAssembly (based on
[tripplyons/pokeemerald-wasm](https://github.com/tripplyons/pokeemerald-wasm)).
There is no emulator: the browser runs the game's own code, and a small layer
in `src/wasm_display.c`, `include/wasm/` and `web/` stands in for the Game Boy
hardware.

## Build

On Ubuntu 24.04 (other systems: same tools, different install command):

```sh
sudo apt-get install -y build-essential libpng-dev clang-20 lld-20 nodejs
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

`dist/cloudflare` is a plain folder of files (about 12 MB), so any static host
works. Cloudflare Pages is free and lets you lock the site to your family:

1. Create a free Cloudflare account. Add your domain to it, or keep the domain
   where it is and plan to use a subdomain such as `emerald.example.com`.
2. In the dashboard: **Workers & Pages → Create → Pages → Upload assets**. Name
   the project, drag in the contents of `dist/cloudflare`, and deploy. You get a
   `*.pages.dev` address to test with.
3. In the project: **Custom domains → Set up a custom domain**, and enter the
   address you want. Cloudflare tells you the one DNS record to add if your
   domain lives elsewhere.
4. Lock it down: **Zero Trust → Access → Applications → Add → Self-hosted**, use
   the same address, and add a policy that allows your family's email
   addresses. Visitors get a one-time code by email. Free for up to 50 people.
5. On each phone, open the address, then **Share → Add to Home Screen**
   (iPhone) or **⋮ → Add to Home screen** (Android). It then opens full screen
   like an app.

The built game contains Nintendo's graphics, music and text. Keep it behind
the login in step 4; do not publish it openly.

## Saves

Saving in the game writes the save into that browser on that phone. Clearing
the browser's site data deletes it, so use **More → Back up save** now and
then. **Restore save** loads a backup, including a `.sav` from a real cartridge
or an emulator.

## Known gaps

- No sound yet. The port tracks music and sound effects so timing is right,
  but nothing is played through the speaker.
- Link features (trading, link battles, Union Room) have no browser connection yet.
