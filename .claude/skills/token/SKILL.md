---
name: token
description: Create, change or rebuild a MapTool token (.rptok) for a tabletop game with the token generator in this repo - "make me a medusa token", "a blue dragon named Herbert, based on an adult blue dragon, without wings", "quick token for a bandit captain", "give Philia CR 10", "rebuild my tokens". Use for any request about tokens, statblocks as token images, or MapTool tokens.
---

# Token

The CLI does the mechanical work; you decide with the user. Run everything from the repo root:
`node bin/tokengen.mjs <command>`. Read `CLAUDE.md` of this repo for the format and the rules.

## 1. Understand the request

Before you touch anything, settle these:

- **Campaign.** It decides the edition and which wiki to search (`campaigns` in
  `config.local.json`). If the user names none, use the default edition and no wiki.
- **Basis.** A monster from the mirror, a wiki tiddler (`--tiddler`, its `creature` field is the basis), or
  both.
- **Names.** `name` is what the players see. `gmName` is only for figures the players do not know
  yet ("Unknown man" / "Alvin"). A known NPC gets only `name`.
- **Role.** `npc` (also named enemies), `unique` (leader, spider queen), `mob` (spiderling,
  swordsman). It decides the ring colour.
- **Changes.** What differs from the basis.

**At the table** ("quick", "right now", "spontaneous"): run `quick` with whatever was given, ask
nothing, report the path. It can be refined after the session.

## 2. Find the basis and the picture

```sh
node bin/tokengen.mjs find "<text>" [--campaign c | --edition e]
```

- **One clear hit:** use it.
- **Several sources** (`new` refuses with "exists in several sources"): name them with a few
  words on the differences, and let the user choose. Do not pick yourself.
- **The picture, in this order:** a picture the user gives (file, or `--image clipboard`), the
  tiddler's image, the wiki images that `find` lists, the mirror's artwork. If several fit, ask.

## 3. Create

```sh
node bin/tokengen.mjs new <slug> --from "<monster>" [--source S] [--campaign c] [--tiddler T] \
  [--name N] [--gm-name G] [--role r] [--image file|clipboard]
```

Read the report:
- `Renamed in the text: …` lists the phrases that were replaced. "nothing found" means the text
  refers to the creature differently: fix it by hand in `statblock.json`.
- `Check:` warnings already in the basis come from the mirror's data. Leave them unless the user
  asks.

## 4. Change the statblock

Edit `output/<slug>/statblock.json` directly. It is a monster in the mirror's format, so keep its
tags (`{@hit 7}`, `{@damage 2d6 + 4}`, `{@dc 15}`, `{@spell fireball}`, `{@atk mw}` / `{@atkr m}`).

- **Change what follows from a change.** Abilities change modifiers, attack bonuses, damage
  bonuses, DCs, saves, skills and passive Perception. CR changes the proficiency bonus (PB) and
  with it every attack, DC, save and skill. Hit dice follow size and Con.
- **Take parts from other monsters.** For spellcasting, traits or actions from another creature,
  copy them from that monster (create it in a scratch slug, or read the mirror's bestiary file).
  Then recompute them for this creature: casting ability, DC (8 + PB + mod), attack (PB + mod),
  and the name in the text.
- **Removing a feature removes all of it.** For a dragon without wings: fly speed, Wing Attack,
  and every "can then fly" in the text.
- **Fix pronouns** after renaming where they read wrong ("Philia sees itself" → "herself").
- **Show the user a short list of what you changed** (old → new), before building.

### Challenge rating

Use this when the request names a CR ("CR 10 instead of 6") or changes the strength noticeably
("stronger than normal", spells from an archmage). The method is the standard one, computed as the
mirror's CR calculator does.

1. **Look up the target.** `node bin/tokengen.mjs cr --target 10` lists PB, AC, HP range, attack
   bonus, save DC and damage per round for that CR.
2. **Adjust toward it.**
   - Set `cr`; the new PB changes every attack, DC, save and skill.
   - Set AC.
   - Set HP through the number of hit dice. The die follows the size, the bonus follows Con.
   - Bring the damage near the target, through the dice or the multiattack.
   - Show the list of changes.
3. **Work out the damage per round yourself, over three rounds**, as the method says:
   - In each round take the most damaging option.
   - Count area effects against two targets. Respect spell slots and recharges, and add
     legendary actions.
   - Give effects without damage (petrify, paralyse, charm) a damage equivalent, and say which
     number you chose.
   - Note whether the best option uses an attack bonus or a save DC.
4. **Estimate.** Run `node bin/tokengen.mjs cr <slug> --dpr N [--dc N | --attack N]`. It shows
   the defensive, offensive and overall CR. `--dpr` is saved as `offense` in `token.json`, and
   `build` warns from then on when the estimate is two or more steps away from the statblock's
   CR. Run it again with a new `--dpr` whenever attacks or spells change.
5. **Report to the user and let them decide.** Give the estimate against the requested CR. If it
   is off, offer concrete options ("cut the spells to 9th level: CR 10", "keep it as CR 11").

## 5. Crop

The user chooses the crop. Run it in the background and wait for it to exit:

```sh
node bin/tokengen.mjs crop <slug>
```

The page opens in the user's browser. Saving writes `token.json` and renders `token.png`, then the
command ends. A token without `crop` (a ready-made token from the mirror) needs no crop.

## 6. Build and show

```sh
node bin/tokengen.mjs build <slug>
```

- **Warnings.** `build` runs `check`. Fix every warning your changes caused. Mention warnings that
  are intended ("+9 to hit is on purpose: magic weapon").
- **Look before showing.** Read `output/<slug>/statblock.png` yourself, then show it to the user.
- **Report.** Give the path of the `.rptok` and say what is in the GM notes: spells, lair.

## Changing a finished token

```sh
node bin/tokengen.mjs open <file.rptok> [--slug s]     # into output/<slug>/
# edit statblock.json / token.json, crop if needed
node bin/tokengen.mjs build <slug>
```

The new `.rptok` lands in `output/<slug>/`; the user moves it back. A token without embedded
generator data ("reconstructed from content.xml") has no `statblock.json`. Create the statblock
again from the `Based on:` line with `new … --force` into the same slug, and keep the images.

## Rebuilding many tokens

After a change to the ring or the statblock layout, the user may ask to rebuild existing tokens:

```sh
node bin/tokengen.mjs rebuild <file.rptok | folder>
```

It replaces each file and keeps `.rptok.bak`. Tell the user to check them in MapTool and delete
the `.bak` files themselves. A second run refuses while `.bak` files exist.

## Do not

- Fill MapTool properties. Every player sees them.
- Write into the mirror or the wikis. Never reference this repo from a wiki.
- Put product names, personal paths or campaign names into this repo; it is public (see
  `CLAUDE.md`).
- Commit tokens, images or `output/`.
