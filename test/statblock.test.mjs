import assert from "node:assert/strict";
import {test} from "node:test";
import {gmNotes, parseBasedOn} from "../lib/gmnotes.mjs";
import {checkStatblock, diceAverage, proficiencyBonus, renameMonster} from "../lib/statblock.mjs";

// A medusa statblock, shortened
const medusa = () => ({
	name: "Medusa",
	size: ["M"],
	hp: {average: 127, formula: "17d8 + 51"},
	str: 10, dex: 15, con: 16, int: 12, wis: 13, cha: 15,
	skill: {perception: "+4"},
	passive: 14,
	cr: "6",
	trait: [{name: "Petrifying Gaze", entries: ["When a creature that can see the medusa's eyes starts its turn within 30 feet of the medusa, the medusa can force it to make a {@dc 14} Constitution saving throw."]}],
	action: [
		{name: "Snake Hair", entries: ["{@atk mw} {@hit 5} to hit, reach 5 ft., one creature. {@h}4 ({@damage 1d4 + 2}) piercing damage plus 14 ({@damage 4d6}) poison damage."]},
		{name: "Longbow", entries: ["{@atk rw} {@hit 5} to hit, range 150/600 ft., one target. {@h}6 ({@damage 1d8 + 2}) piercing damage."]},
	],
});

test("an unchanged medusa has no warnings", () => {
	assert.deepEqual(checkStatblock(medusa()), []);
});

test("raising Str without updating the attacks warns", () => {
	const m = medusa();
	m.str = 18;
	m.dex = 10;
	const w = checkStatblock(m);
	assert.ok(w.some(x => x.startsWith("Snake Hair: +5 to hit, expected +7 (Str) or +3 (Dex)")), w.join("\n"));
});

test("2024 attack rolls and spell attacks may use any ability", () => {
	const m = medusa();
	m.action.push(
		{name: "Poison Ray", entries: ["{@atkr r} {@hit 5}, range 150 ft. {@h}11 ({@damage 2d8 + 2}) Poison damage."]},
		{name: "Bad Ray", entries: ["{@atk rs} {@hit 9} to hit, range 60 ft."]},
	);
	const w = checkStatblock(m).join("\n");
	assert.doesNotMatch(w, /Poison Ray/);
	assert.match(w, /Bad Ray: \+9 to hit fits no ability/);
});

test("hit points, damage, DC and passive Perception are checked", () => {
	const m = medusa();
	m.hp = {average: 130, formula: "17d8 + 51"};
	m.con = 18;
	m.passive = 15;
	m.trait[0].entries[0] = m.trait[0].entries[0].replace("{@dc 14}", "{@dc 19}");
	m.action[0].entries[0] = m.action[0].entries[0].replace("14 ({@damage 4d6})", "15 ({@damage 4d6})");
	const w = checkStatblock(m).join("\n");
	assert.match(w, /17d8 \+ 51 averages 127, statblock says 130/);
	assert.match(w, /bonus \+51 does not match 17 × Con \+4 = \+68/);
	assert.match(w, /Passive Perception 15, expected 14/);
	assert.match(w, /Petrifying Gaze: DC 19 fits no ability/);
	assert.match(w, /Damage 15 \(4d6\): average is 14/);
});

test("spellcasting DC and attack follow the casting ability", () => {
	const m = medusa();
	m.int = 18;
	m.cr = "10";
	m.spellcasting = [{name: "Spellcasting", ability: "int", headerEntries: ["(spell save {@dc 17}, {@hit 9} to hit with spell attacks)"]}];
	const w = checkStatblock(m).join("\n");
	assert.match(w, /spell save DC 17, expected 16/);
	assert.match(w, /spell attack \+9, expected \+8/);
});

test("proficiency bonus and dice averages", () => {
	assert.equal(proficiencyBonus("1/4"), 2);
	assert.equal(proficiencyBonus("6"), 3);
	assert.equal(proficiencyBonus({cr: "10", lair: "11"}), 4);
	assert.equal(proficiencyBonus("30"), 9);
	assert.equal(diceAverage("2d10 + 7"), 18);
	assert.equal(diceAverage("1d4+1"), 3);
	assert.equal(diceAverage("1d6 × 10"), null);
});

test("renaming replaces the creature in the text, not entry names", () => {
	const m = medusa();
	const {count, phrases} = renameMonster(m, "Philia", "the medusa");
	assert.equal(count, 3);
	assert.deepEqual(phrases, ["the medusa (3×)"]);
	assert.equal(m.name, "Philia");
	assert.equal(m.isNamedCreature, true);
	assert.match(m.trait[0].entries[0], /can see Philia's eyes starts its turn within 30 feet of Philia, Philia can force/);
	assert.equal(m.trait[0].name, "Petrifying Gaze");
});

test("renaming also finds a word of the name (the bandit for Bandit Captain)", () => {
	const m = {name: "Bandit Captain", action: [{name: "Parry", entries: ["The bandit adds 2 to its AC. The bandit captain shouts."]}]};
	const {count, phrases} = renameMonster(m, "Rurik", "the bandit captain");
	assert.equal(count, 2);
	assert.deepEqual(phrases, ["the bandit captain (1×)", "the bandit (1×)"]);
	assert.equal(m.action[0].entries[0], "Rurik adds 2 to its AC. Rurik shouts.");

	const dragon = {name: "Adult Blue Dragon", trait: [{name: "x", entries: ["Near the blue dragon's lair the dragon waits."]}]};
	renameMonster(dragon, "Herbert", "the dragon");
	assert.equal(dragon.trait[0].entries[0], "Near the blue dragon's lair Herbert waits.");
});

test("GM notes as HTML: header, spells by level, lair, full texts alphabetically; Based on parses back", () => {
	const token = {name: "Unbekannter Mann", gmName: "Alvin <Archmage>", edition: "2014", basedOn: {name: "Archmage", source: "SRC"}};
	const notes = gmNotes(token, {
		spellcasting: ["Spellcasting, DC 17, +9 to hit"],
		lair: [{name: "Lair Actions", text: "Choose one:\n\n- The ceiling collapses.\n- Fog & rain."}],
		spells: [
			{name: "Shield", level: 1, summary: "Shield · 1 reaction — An invisible barrier.", full: "Shield (1st-level abjuration)\nCasting Time: 1 reaction\n\nAn invisible barrier."},
			{name: "Fire Bolt", level: 0, summary: "Fire Bolt · 1 action", full: "Fire Bolt (Evocation cantrip)"},
			{name: "Mage Hand", level: 0, summary: "Mage Hand · 1 action", full: "Mage Hand (Conjuration cantrip)"},
			{name: "Nonsense", source: "XYZ", missing: true},
		],
	});
	assert.match(notes, /^<html><body>\n<h2>Alvin &lt;Archmage&gt;<\/h2>/);
	assert.match(notes, /Players see: Unbekannter Mann/);
	assert.match(notes, /<p><b>Cantrips<\/b><\/p>\n<ul><li><b>Fire Bolt<\/b> · 1 action<\/li><li><b>Mage Hand<\/b> · 1 action<\/li><\/ul>\n<p><b>1st level<\/b><\/p>\n<ul><li><b>Shield<\/b> · 1 reaction — An invisible barrier.<\/li><\/ul>/);
	assert.match(notes, /<h3>Lair Actions<\/h3>\n<p>Choose one:<\/p>\n<ul><li>The ceiling collapses.<\/li><li>Fog &amp; rain.<\/li><\/ul>/);
	assert.match(notes, /<h4>Shield<\/h4>\n<p><i>1st-level abjuration<\/i><\/p>\n<p>Casting Time: 1 reaction<\/p>\n<p>An invisible barrier.<\/p>/);
	const at = s => notes.indexOf(s);
	assert.ok(at("<h3>Spells</h3>") < at("<h3>Lair Actions</h3>") && at("<h3>Lair Actions</h3>") < at("<h3>Spell Descriptions</h3>"));
	const full = notes.slice(at("<h3>Spell Descriptions</h3>"));
	assert.ok(full.indexOf("<h4>Fire Bolt") < full.indexOf("<h4>Mage Hand") && full.indexOf("<h4>Mage Hand") < full.indexOf("<h4>Shield"), "alphabetical");
	assert.match(notes, /Not found in the mirror: Nonsense \(XYZ\)/);
	assert.deepEqual(parseBasedOn(notes), {basedOn: {name: "Archmage", source: "SRC"}, edition: "2014"});
});

test("Based on is read from plain notes too", () => {
	assert.deepEqual(parseBasedOn("Philia\nBased on: Medusa (SRC, 2014)"), {basedOn: {name: "Medusa", source: "SRC"}, edition: "2014"});
	assert.equal(parseBasedOn("<p>nothing here</p>"), null);
});
