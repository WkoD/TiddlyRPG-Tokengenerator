# CLAUDE.md

Token generator for MapTool 1.18.7. The CLI (`bin/tokengen.mjs`) does the mechanical work; Claude
picks the basis, changes statblocks and asks the open questions. The workflow for a token request
is the skill `.claude/skills/token/SKILL.md`.

## Layout

| | |
|---|---|
| `bin/tokengen.mjs` | CLI |
| `lib/build.mjs` | workflow: `new`, `render`, `build`, `quick`, `rebuild` |
| `lib/bestiary.mjs` | search the mirror's raw bestiary, find token and artwork files |
| `lib/mirror.mjs`, `templates/statblock.html` | the mirror in headless Chrome: resolve monsters, render statblocks, look up spells |
| `lib/statblock.mjs` | renaming and `check` on monster data |
| `lib/cr.mjs` | challenge rating estimate on the mirror's `data/msbcr.json` |
| `lib/wiki.mjs` | read campaign wiki tiddlers and their images |
| `lib/rptok.mjs` | pack/unpack `.rptok`; never decodes images |
| `lib/workdir.mjs` | working folders `output/<slug>/` ⇄ `.rptok` |
| `lib/image.mjs` | image work in headless Chrome (Playwright, `config.browser.channel`) |
| `lib/token-render.js` | draws the ringed token; plain browser script shared by CLI and crop page |
| `lib/crop.mjs`, `lib/crop-ui/` | local crop page; saving writes `token.json` and renders `token.png` |
| `lib/gmnotes.mjs` | GM notes text |
| `lib/clipboard.mjs` | `--image clipboard` |
| `templates/content.xml` | token XML, derived from a token saved by MapTool 1.18.7 |
| `config.json` | defaults: output, browser, roles |
| `config.local.json` | gitignored: mirror paths per edition, campaigns; merged on top of `config.json` |
| `output/` | working folders and results, gitignored |
| `example/` | hand-made reference tokens, gitignored |

## Public repository

The repository is public. Keep it free of product names: no game or rulebook names, no names of
the data mirror or its site, no personal paths and no campaign names. Mirror paths and campaigns
belong in `config.local.json`; source codes in examples and tests are neutral (`SRC`). Inside the
mirror's data and code, everything keeps the names the mirror uses.

## The .rptok format

- **ZIP layout:** `content.xml` (XStream-serialised `net.rptools.maptool.model.Token`), `properties.xml`,
  `thumbnail` (50 px PNG), `thumbnail_large` (200 px PNG), and per image `assets/<md5>` (XML) plus
  `assets/<md5>.<ext>`.
- **Asset IDs:** an asset ID is the MD5 of the image file.
- **Where the images go:** `imageAssetMap` holds the token image, `portraitImage` the portrait and
  `charsheetImage` the statblock.
- **Size:** set through `sizeMap` with the fixed footprint GUIDs in `SQUARE_FOOTPRINTS`, taken from
  `net/rptools/maptool/model/squareGridFootprints.xml` in `MapTool.jar`.
- **Embedded data:** `tokengen/token.json` is the generator's own entry. MapTool ignores it, and it
  may be lost when MapTool saves the token again. The `Based on:` line in the GM notes is the
  fallback for `open`.
- **Do not change the template casually.** It is a token as MapTool 1.18.7 writes it, with
  placeholders. Any change needs an import test in MapTool.

## Token image

- **Same code everywhere:** `lib/token-render.js` draws both the crop page preview and the
  `token.png` written by the CLI, so the preview is the result. Change the ring look only there.
- **Size and crop:** 512 px PNG. `crop` gives the centre and diameter, in portrait pixels, of the
  circle shown inside the ring. A token without `crop` keeps its token image unchanged.
- **The user chooses the crop.** Run `crop <slug>` in the background and wait for it to exit. Set
  `crop` in `token.json` yourself only as a starting suggestion.

## Statblock

- **The mirror does the rendering, not this repo.** `templates/statblock.html` is served at the
  root of the mirror of the token's edition. It runs the mirror's own `DataLoader` (`_copy`
  resolved) and `RenderBestiary`. Only what a sheet does not need is removed: variants,
  environment, treasure, source, pronunciation, toggles. The token image goes top right.
- **`statblock.json` is a monster in the mirror's format.** Edit it as such, tags included
  (`{@hit 7}`, `{@damage 2d6 + 4}`, `{@dc 15}`). The legendary group is embedded as
  `_legendaryGroup`.
- **The image stays small enough for the screen.** Lair actions, regional effects and the mythic
  encounter go to the GM notes, not the image.
- **GM notes are for use at the table.** They hold a spell overview (one line per spell, by
  level), the lair texts and the spells in full (alphabetically). They do not hold the statblock as
  text. `open` falls back on the `Based on:` line.
- **GM notes are HTML** (`gmNotesType` `text/html`).
  - **Plain HTML only.** MapTool renders HTML with Swing's HTML 3.2: only headings, paragraphs,
    lists, `<b>`, `<i>`, `<br>`, `<hr>`, and no CSS.
  - **No Markdown.** Markdown notes were tried with MapTool 1.18.7 and did not render correctly.
  - **Foreign tokens keep their type.** Their notes are stored as `gmnotes.txt`, `.html` or `.md`
    in the working folder.
- **Layout:** one column, 420 CSS px wide. Taller than `MAX_SINGLE_COLUMN_HEIGHT` means two columns,
  split between rows.
- **Editions:** each mirror renders in its own style; the 2024 one shows initiative and a Mod/Save
  table. The 2024 mirror also contains the 2014 books. `new` leaves out entries that the mirror
  marks as reprinted (`reprintedAs`) as another hit, so a reprinted monster resolves to its newer
  entry. Real variants of a monster in several books still need `--source`.
- **Renaming:** `new` with a name sets `name`, `isNamedCreature` and `shortName`. In the text it
  replaces "the <short name>", "the <full name>" and "the <word of the name>" ("the bandit" for
  Bandit Captain), and reports what it replaced. A single word followed by another word of the name
  stays ("the blue dragon's lair"). Pronouns (it/its) stay; fix them where they read wrong.
- **Size:** with several sizes ("Small or Medium"), the token takes the largest.
- **`check` and 2024:** weapon attacks (`{@atk mw}`, `{@atk rw}`) must fit Str or Dex. Spell
  attacks and 2024 attack rolls (`{@atkr}`) may use any ability.
- **After every edit run `build`.** It runs `check` first. `check` compares attacks, DCs, hit points,
  saves, passive Perception and damage averages with abilities and CR, and only warns.

## Challenge rating

- **The calculation follows the mirror's CR calculator.** `lib/cr.mjs` computes the way
  `js/crcalculator.js` of the mirror does: effective HP and AC, ±1 CR per 2 points, average,
  rounding. `test/cr.test.mjs` holds cases with that calculator's results. Change the calculation
  only together with those cases.
- **Feature bonuses are a fixed table.** The values for HP, AC and attack come from the mirror's
  `data/monsterfeatures.json`. That file holds JavaScript expressions, which are never evaluated
  here. Features that add damage are left out: they belong in the damage per round.
- **The damage per round comes from Claude**, worked out over three rounds (see the skill). It is
  saved as `offense` in `token.json`.

## Rules

- **Never fill token properties.** MapTool shows them to every player; anything secret belongs in
  `gmNotes` or the statblock image.
- **`name` is public, `gmName` is GM only.** The split is meant for figures the players do not know
  yet.
- **Tokens are not versioned.** No images, `.rptok` or working folders in git.
- **Read the mirror, never write to it.** The same goes for the campaign wikis: read their
  tiddlers and images, never write to them, and never reference this repo from them.

## Conventions

- Code, docs and commit messages in English.
- Tests: `npm test` (Node's test runner). `lib/rptok.mjs` and `lib/statblock.mjs` are tested
  without a browser; `test/cr.test.mjs` needs the 2014 mirror.
