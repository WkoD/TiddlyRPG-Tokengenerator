// Needs the 2014 mirror (data/msbcr.json). Expected values: the CR calculator of
// the same mirror (crcalculator.html) with the same inputs.
import assert from "node:assert/strict";
import {test} from "node:test";
import {crDistance, crTarget, estimateCr} from "../lib/cr.mjs";

const SAVES = ["str", "dex", "con", "int", "wis", "cha"];
const monster = ({cr, ac, hp, vulnerable, resist, immune, saves = 0, fly}) => ({
	cr,
	ac: [ac],
	hp: {average: hp},
	...(vulnerable ? {vulnerable: ["fire"]} : {}),
	...(resist ? {resist: ["bludgeoning", "piercing", "slashing"]} : {}),
	...(immune ? {immune: ["poison", "fire", "cold"]} : {}),
	save: Object.fromEntries(SAVES.slice(0, saves).map(s => [s, "+1"])),
	...(fly ? {speed: {fly: 60}, action: [{name: "Spit", entries: ["{@atk rw} {@hit 6} to hit, range 30/60 ft."]}]} : {}),
});

const CASES = [
	// [monster, offense, calculator: CR, defensive, offensive, effective HP, effective AC]
	[{cr: "6", ac: 15, hp: 127}, {dpr: 28, attack: 5}, ["4", "4", "4", 127, 15]],
	[{cr: "8", ac: 14, hp: 150, resist: true, saves: 3}, {dpr: 50, dc: 15}, ["9", "11", "7", 225, 16]],
	[{cr: "3", ac: 12, hp: 45, vulnerable: true, immune: true, saves: 5, fly: true}, {dpr: 20, attack: 6}, ["2", "1", "3", 45, 18]],
	[{cr: "20", ac: 22, hp: 555, immune: true}, {dpr: 200, attack: 14}, ["27", "28", "25", 693, 22]],
	[{cr: "1/4", ac: 11, hp: 7}, {dpr: 3, attack: 2}, ["1/8", "0", "1/8", 7, 11]],
];

test("estimates match the mirror's CR calculator", () => {
	for (const [m, offense, [cr, def, off, hp, ac]] of CASES) {
		const r = estimateCr(monster(m), "2014", offense);
		assert.deepEqual([r.cr, r.defensive.cr, r.offensive.cr, r.defensive.hp, r.defensive.ac], [cr, def, off, hp, ac], JSON.stringify(m));
	}
});

test("features: Legendary Resistance and Magic Resistance", () => {
	const mon = {...monster({cr: "16", ac: 19, hp: 225, saves: 4}), trait: [
		{name: "Legendary Resistance (3/Day)", entries: ["If it fails a saving throw, it can choose to succeed instead."]},
		{name: "Magic Resistance", entries: ["It has advantage on saving throws against spells."]},
	]};
	const r = estimateCr(mon, "2014", {dpr: 85, attack: 12});
	assert.equal(r.defensive.hp, 225 + 90);
	assert.equal(r.defensive.ac, 19 + 2 + 2);
	assert.ok(r.defensive.notes.some(n => n.startsWith("Legendary Resistance")));
});

test("without dpr only the defensive CR", () => {
	const r = estimateCr(monster({cr: "6", ac: 15, hp: 127}), "2014");
	assert.equal(r.offensive, null);
	assert.equal(r.cr, null);
	assert.equal(r.defensive.cr, "4");
});

test("target values and distance", () => {
	assert.deepEqual(crTarget("2014", "10"), {_cr: "10", pb: 4, ac: 17, hpMin: 206, hpMax: 220, attackBonus: 7, dprMin: 63, dprMax: 68, saveDc: 16});
	assert.equal(crDistance("2014", "1/2", "2"), 2);
	assert.equal(crDistance("2014", "6", "4"), 2);
});
