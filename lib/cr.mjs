// Challenge rating by the standard method, computed the way the mirror's CR calculator does
// (js/crcalculator.js): effective HP and AC give the defensive CR, damage per round and attack
// bonus (or save DC) the offensive CR, the result is their average. The table is the mirror's
// data/msbcr.json.

import fs from "node:fs";
import path from "node:path";
import {mirrorOf} from "./config.mjs";

const tables = new Map();

/** Rows of the table: {_cr, pb, ac, hpMin, hpMax, attackBonus, dprMin, dprMax, saveDc}. */
export function crTable (edition) {
	if (!tables.has(edition)) {
		const roots = mirrorOf(edition);
		tables.set(edition, JSON.parse(fs.readFileSync(path.join(roots.src, "data/msbcr.json"), "utf-8")).cr);
	}
	return tables.get(edition);
}

const crString = cr => String(typeof cr === "object" && cr ? cr.cr : cr ?? "");
const crValue = cr => {
	const s = crString(cr);
	if (s.includes("/")) {
		const [a, b] = s.split("/").map(Number);
		return a / b;
	}
	return Number(s);
};

/** Index of a CR in the table, or -1. */
const indexOf = (table, cr) => table.findIndex(r => r._cr === crString(cr));

/** The row of the table for a CR (target values), or null. */
export function crTarget (edition, cr) {
	const table = crTable(edition);
	const i = indexOf(table, cr);
	return i < 0 ? null : table[i];
}

// Features from the mirror's data/monsterfeatures.json that change effective HP, AC or attack bonus.
// Features that add damage per round are left out: they belong into the dpr given by the caller.
// trait: the number of the feature (uses of Legendary Resistance, HP of Regeneration).
const byCr = (expectedCr, low, mid, high, top = high) => (expectedCr <= 4 ? low : expectedCr <= 10 ? mid : expectedCr <= 16 ? high : top);
const FEATURES = [
	{name: "Ambusher", attackBonus: 1},
	{name: "Avoidance", ac: 1},
	{name: "Blood Frenzy", attackBonus: 4},
	{name: "Constrict", ac: 1},
	{name: "Damage Transfer", hp: ({hp}) => hp},
	{name: "Frightful Presence", hp: ({hp, expectedCr}) => (expectedCr <= 10 ? Math.floor(hp * 0.25) : 0)},
	{name: "Horrifying Visage", hp: ({hp, expectedCr}) => (expectedCr <= 10 ? Math.floor(hp * 0.25) : 0)},
	{name: "Legendary Resistance", hp: ({expectedCr, trait}) => byCr(expectedCr, 10, 20, 30) * trait, trait: text => Number(text.match(/\((\d+)\/Day\)/i)?.[1] ?? 0)},
	{name: "Magic Resistance", ac: 2},
	{name: "Nimble Escape", ac: 4, attackBonus: 4},
	{name: "Pack Tactics", attackBonus: 1},
	{name: "Parry", ac: 1},
	{name: "Possession", hp: ({hp}) => hp},
	{name: "Regeneration", hp: ({trait}) => trait * 3, trait: text => Number(text.match(/regains (\d+) hit points/i)?.[1] ?? 0)},
	{name: "Relentless", hp: ({expectedCr}) => byCr(expectedCr, 7, 14, 21, 28)},
	{name: "Shadow Stealth", ac: 4},
	{name: "Stench", ac: 1},
	{name: "Superior Invisibility", ac: 2},
	{name: "Undead Fortitude", hp: ({expectedCr}) => byCr(expectedCr, 7, 14, 21, 28)},
	{name: "Web", ac: 1},
];

const stripTags = s => String(s).replace(/\{@\w+ ([^|}]*)[^}]*\}/g, "$1");
const strings = v => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
const ENTRY_PROPS = ["trait", "action", "bonus", "reaction", "legendary", "mythic"];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];

/** Damage types of resist/immune, including conditional ones ("from nonmagical attacks"). */
const damageTypes = list => (list ?? []).flatMap(x => (typeof x === "string" ? [x] : damageTypes(x.resist ?? x.immune ?? x.vulnerable ?? [])));

const acOf = mon => {
	const first = (mon.ac ?? [])[0];
	return typeof first === "number" ? first : first?.ac ?? 10;
};

function features (mon) {
	const found = [];
	for (const prop of ENTRY_PROPS) {
		for (const e of mon[prop] ?? []) {
			const name = stripTags(e.name ?? "");
			const f = FEATURES.find(x => name.toLowerCase().startsWith(x.name.toLowerCase()));
			if (f) found.push({f, text: `${name} ${strings(e.entries).join(" ")}`});
		}
	}
	return found;
}

/** Highest {@hit} and {@dc} in the entries. */
function bestAttack (mon) {
	const text = ENTRY_PROPS.flatMap(p => strings(mon[p] ?? [])).join(" ");
	const hits = [...text.matchAll(/\{@hit (-?\d+)\}/g)].map(m => Number(m[1]));
	const dcs = [...text.matchAll(/\{@dc (\d+)\}/g)].map(m => Number(m[1]));
	return {attack: hits.length ? Math.max(...hits) : null, dc: dcs.length ? Math.max(...dcs) : null};
}

const hasRangedDamage = mon => /\{@atk [^}]*r[ws]|\{@atkr [^}]*r|range \d+/i.test(ENTRY_PROPS.flatMap(p => strings(mon[p] ?? [])).join(" "));

/** Averages below 1 that the calculator maps to table fractions; any other non-integer is rounded. */
const FRACTIONS = {"0.5625": "1/2", "0.5": "1/2", "0.375": "1/4", "0.3125": "1/4", "0.25": "1/4", "0.1875": "1/8", "0.125": "1/8", "0.0625": "1/8"};

/** Steps a table index by half the difference to the expected value, like the mirror's calculator. */
const adjust = (i, expected, actual, length) => {
	let diff = expected - actual;
	diff = diff > 0 ? Math.floor(diff / 2) : Math.ceil(diff / 2);
	return Math.min(length - 1, Math.max(0, i - diff));
};

/**
 * Estimates the challenge rating of a statblock.
 * @param {object} mon - monster in the mirror's format
 * @param {string} edition
 * @param {object} [o]
 * @param {number} [o.dpr] - damage per round (average over three rounds); without it no offensive CR
 * @param {number} [o.attack] - attack bonus to use; default the highest {@hit}
 * @param {number} [o.dc] - save DC to use instead of an attack bonus
 * @param {string} [o.expectedCr] - default the statblock's CR
 * @returns {{stated, expectedCr, defensive: {cr, hp, ac, notes}, offensive: {cr, dpr, attack, dc, notes} | null, cr: string | null}}
 */
export function estimateCr (mon, edition, o = {}) {
	const table = crTable(edition);
	const expectedCr = crValue(o.expectedCr ?? mon.cr ?? "0");
	const defNotes = [];
	const offNotes = [];

	// Defense: effective hit points
	const hpActual = mon.hp?.average ?? 0;
	let hp = hpActual;
	if ((mon.vulnerable ?? []).length) {
		hp *= 0.5;
		defNotes.push("vulnerabilities: HP × 0.5");
	}
	const immune = damageTypes(mon.immune);
	const resist = damageTypes(mon.resist);
	const counts = types => types.some(t => PHYSICAL.includes(t)) || types.length >= 3;
	if (counts(immune)) {
		const factor = byCr(expectedCr, 2, 2, 1.5, 1.25);
		hp *= factor;
		defNotes.push(`immunities (${immune.join(", ")}): HP × ${factor}`);
	} else if (counts(resist)) {
		const factor = byCr(expectedCr, 2, 1.5, 1.25, 1);
		hp *= factor;
		defNotes.push(`resistances (${resist.join(", ")}): HP × ${factor}`);
	}

	// Defense: effective armor class
	let ac = acOf(mon);
	const saves = Object.keys(mon.save ?? {}).length;
	const saveBonus = saves >= 5 ? 4 : saves >= 3 ? 2 : 0;
	if (saveBonus) {
		ac += saveBonus;
		defNotes.push(`${saves} saving throw proficiencies: AC +${saveBonus}`);
	}
	if (mon.speed?.fly && expectedCr <= 10 && hasRangedDamage(mon)) {
		ac += 2;
		defNotes.push("flies and deals damage at range: AC +2");
	}

	let attack = o.attack ?? null;
	let dc = o.dc ?? null;
	if (attack == null && dc == null) ({attack, dc} = bestAttack(mon));
	const useDc = o.dc != null || attack == null;

	for (const {f, text} of features(mon)) {
		const trait = f.trait ? f.trait(text) : 0;
		if (f.hp) {
			const add = f.hp({hp, hpActual, expectedCr, trait});
			if (add) {
				hp += add;
				defNotes.push(`${f.name}: HP +${add}`);
			}
		}
		if (f.ac) {
			ac += f.ac;
			defNotes.push(`${f.name}: AC +${f.ac}`);
		}
		if (f.attackBonus && !useDc && attack != null) {
			attack += f.attackBonus;
			offNotes.push(`${f.name}: attack +${f.attackBonus}`);
		}
	}
	hp = Math.floor(hp);

	const hpRow = table.findIndex(r => Math.min(hp, 850) >= r.hpMin && Math.min(hp, 850) <= r.hpMax);
	const defIndex = adjust(Math.max(0, hpRow), table[Math.max(0, hpRow)].ac, ac, table.length);
	const defensive = {cr: table[defIndex]._cr, hp, ac, notes: defNotes};

	let offensive = null;
	if (o.dpr != null) {
		const dpr = Math.floor(o.dpr);
		const row = table.findIndex(r => Math.min(dpr, 320) >= r.dprMin && Math.min(dpr, 320) <= r.dprMax);
		const base = Math.max(0, row);
		const offIndex = useDc
			? adjust(base, table[base].saveDc, dc ?? table[base].saveDc, table.length)
			: adjust(base, table[base].attackBonus, attack, table.length);
		offensive = {cr: table[offIndex]._cr, dpr, attack: useDc ? null : attack, dc: useDc ? dc : null, notes: offNotes};
	}

	let cr = null;
	if (offensive) {
		const avg = String((crValue(defensive.cr) + crValue(offensive.cr)) / 2);
		cr = FRACTIONS[avg] ?? (avg.includes(".") ? String(Math.round(Number(avg))) : avg);
	}
	return {stated: crString(mon.cr), expectedCr: String(o.expectedCr ?? crString(mon.cr)), defensive, offensive, cr};
}

/** Steps between two CRs in the table (absolute). */
export function crDistance (edition, a, b) {
	const table = crTable(edition);
	const i = indexOf(table, a);
	const j = indexOf(table, b);
	return i < 0 || j < 0 ? null : Math.abs(i - j);
}
