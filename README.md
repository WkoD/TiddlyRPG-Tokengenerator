# TiddlyRPG Tokengenerator

Builds tokens for [MapTool](https://www.rptools.net/toolbox/maptool/) (`.rptok`) for tabletop
role-playing games. A token carries three images:

- **Token**: the round image with a ring that sits on the map
- **Portrait**: the original picture
- **Statblock**: the creature's statblock as an image (MapTool's character sheet), with the token
  top right

The GM notes of the token hold, in this order:

1. who it is, with a `Based on: Medusa (SRC, 2014)` line
2. an overview of its spells, one line each, by level
3. lair actions, regional effects and mythic encounter, if it has them
4. the spells in full, alphabetically

The statblock image leaves the lair parts out, so that it stays small enough for the screen.

Each `.rptok` also embeds the generator's own data (`tokengen/token.json`). It holds the names,
role, edition, basis and crop, and the full statblock. A token can therefore be opened, changed and
rebuilt at any time.

## Requirements

- Node.js 22 or later
- Google Chrome (used headless through Playwright). Set `browser.channel` in `config.json` to
  `msedge` to use Edge instead.
- A local data mirror per rules edition (2014 and/or 2024), with:
  - a source folder: `data/` (bestiary, spells, `msbcr.json`, `monsterfeatures.json`) plus the JS
    and CSS that render statblocks
  - an image folder (`bestiary/…`, `bestiary/tokens/…`)
- MapTool 1.11.5 (the format the tokens are written in)

```sh
npm install
```

### Local configuration

`config.json` holds the defaults. Paths and campaigns go into `config.local.json` next to it; that
file is not versioned and is merged on top:

```json
{
  "mirror": {
    "2014": {"src": "../mirror/2014-src", "img": "../mirror/2014-img", "spellSource": "SRC"}
  },
  "campaigns": {
    "mycampaign": {"edition": "2014", "wiki": "../MyCampaignWiki"}
  }
}
```

- `spellSource` is the source used for spells named without one.
- A campaign's `wiki` is a TiddlyWiki folder (`tiddlers/`, `images/<type>/`).

## Usage

```sh
node bin/tokengen.mjs find <text>                          # monsters (with images) and wiki images
node bin/tokengen.mjs new [<slug>] --from <monster> [...]  # create output/<slug>/
node bin/tokengen.mjs crop <slug>                          # choose the crop in the browser
node bin/tokengen.mjs build <slug>                         # check + render + pack
node bin/tokengen.mjs quick <monster> [...]                # new + build, for tokens needed right now
```

More commands:

```sh
node bin/tokengen.mjs check <slug>           # statblock numbers: attacks, DCs, hit points, damage
node bin/tokengen.mjs cr --target <cr>       # target values for a challenge rating
node bin/tokengen.mjs cr <slug> --dpr <n>    # estimate the challenge rating
node bin/tokengen.mjs render <slug>          # token.png, statblock.png, GM notes
node bin/tokengen.mjs pack <slug>            # output/<slug>/ -> output/<slug>/<name>.rptok
node bin/tokengen.mjs open <file.rptok>      # .rptok -> output/<slug>/ for editing
node bin/tokengen.mjs rebuild <file|folder>  # rebuild in place (folders with subfolders), keeps .rptok.bak
```

Options of `new` and `quick`:

| Option | |
|---|---|
| `--from <monster>`, `--source <src>` | basis from the mirror; `--source` when the name exists in several sources |
| `--campaign <c>` | campaign from `config.local.json`; sets the edition |
| `--edition 2014\|2024` | otherwise from the campaign, otherwise `defaultEdition` |
| `--tiddler <title>` | wiki tiddler of the campaign: name, basis (`creature`) and picture (`image`) |
| `--name <n>`, `--gm-name <g>` | name for everyone, name for the GM only |
| `--role npc\|unique\|mob` | ring colour; default `npc` for named tokens, `mob` otherwise |
| `--image <file>\|clipboard` | picture; otherwise the mirror's artwork, otherwise its ready-made token |
| `--force` | overwrite an existing working folder |

With a name, the statblock is renamed: title, legendary texts, and "the medusa" → "Philia" in the
text. `quick` uses the mirror's ready-made token as token image when there is one.

Everything is written below `output/`, which is not versioned.

### Working folder

`output/<slug>/token.json` describes the token:

```json
{
	"format": 1,
	"name": "Veiled Woman",
	"gmName": "Philia",
	"role": "npc",
	"campaign": "mycampaign",
	"edition": "2014",
	"basedOn": {"name": "Medusa", "source": "SRC"},
	"images": {"token": "token.png", "portrait": "portrait.jpg", "statblock": "statblock.png"},
	"crop": {"x": 540.7, "y": 444.4, "diameter": 543.4},
	"background": "#c9bfa5"
}
```

- `name` is shown to everyone. `gmName` is optional and shown to the GM only.
- `role` is one of the roles in `config.json` (`npc`, `unique`, `mob`). It decides the ring colour.
- `crop` is the circle of the portrait shown inside the ring, in portrait pixels (centre and
  diameter). Without `crop`, the token image is used as it is, for example a ready-made token.
- `background` is the colour behind transparent pictures. The default is `tokenBackground` in
  `config.json`.
- `offense` (`{"dpr": 72, "dc": 16}`) is written by `cr --dpr`. From then on, `check` compares the
  estimated challenge rating with the statblock's.
- `size` (`T`, `S`, `M`, `L`, `H`, `G`) is only needed without a statblock. Otherwise the size
  comes from `statblock.json`.

`statblock.json` is a monster in the mirror's JSON format, edited freely. `render` writes
`sheet.json`, which holds the spells and lair texts for the GM notes.

### Crop page

`crop` starts a local page in the default browser. It shows the portrait under the ring together
with live previews at token and map size.

- Mouse wheel zooms, dragging moves the picture.
- The arrow keys move it in small steps; hold Shift for larger steps.
- Role and background can be changed on the page.

**Save** writes `token.json`, renders `token.png` and ends the command.

## Tests

```sh
npm test
```

The tests for the challenge rating need the 2014 mirror.

## License

[MIT](LICENSE)
