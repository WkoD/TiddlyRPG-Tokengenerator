// Work on statblocks in the mirror's monster format: renaming and consistency checks. Pure data,
// no mirror code.

const TEXT_PROPS = ["trait", "action", "bonus", "reaction", "legendary", "mythic", "spellcasting", "legendaryHeader", "mythicHeader", "_legendaryGroup"];
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_NAMES = {str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha"};
const HIT_DIE = {T: 4, S: 6, M: 8, L: 10, H: 12, G: 20};

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces strings in all text of the statblock (names of entries stay). Returns the number of replacements. */
function replaceInText (mon, regex, replacement) {
	let count = 0;
	const walk = v => {
		if (typeof v === "string") {
			return v.replace(regex, (...args) => {
				count++;
				return typeof replacement === "function" ? replacement(...args) : replacement;
			});
		}
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "name" ? x : walk(x)]));
		return v;
	};
	for (const prop of TEXT_PROPS) if (mon[prop] !== undefined) mon[prop] = walk(mon[prop]);
	return count;
}

/**
 * Gives the creature its own name: statblock title, how the mirror refers to it, and the text
 * ("the medusa" -> "Philia", "the medusa's" -> "Philia's"). The text refers to the creature by
 * its short name ("the dragon") or by a word of its name ("the bandit" for Bandit Captain), so
 * all of them are tried, longest first.
 * @param {object} mon - changed in place
 * @param {string} name
 * @param {string} shortName - how the mirror refers to the creature, e.g. "the medusa"
 * @returns {{count: number, phrases: string[]}} replacements and the phrases that were replaced
 */
export function renameMonster (mon, name, shortName) {
	const words = String(mon.name).toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);
	const candidates = [...new Set([shortName.replace(/^the\s+/i, "").toLowerCase(), String(mon.name).toLowerCase(), ...words])]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);
	mon.name = name;
	mon.isNamedCreature = true;
	mon.shortName = name;
	let count = 0;
	const phrases = [];
	// A single word must not be followed by another word of the name: "the blue dragon's lair" is
	// not "Herbert dragon's lair".
	const others = words.length ? `(?!\\s+(?:${words.map(escapeRegex).join("|")})\\b)` : "";
	for (const c of candidates) {
		const guard = words.includes(c) ? others : "";
		const n = replaceInText(mon, new RegExp(`\\b(?:the|The)\\s+${escapeRegex(c)}\\b${guard}`, "gi"), name);
		if (n) phrases.push(`the ${c} (${n}×)`);
		count += n;
	}
	return {count, phrases};
}

// region Checks
const mod = score => Math.floor((score - 10) / 2);
const signed = n => (n >= 0 ? `+${n}` : `${n}`);

const crNumber = cr => {
	const v = typeof cr === "object" && cr ? cr.cr : cr;
	if (v == null) return null;
	if (String(v).includes("/")) {
		const [a, b] = String(v).split("/").map(Number);
		return a / b;
	}
	return Number(v);
};

/** Proficiency bonus by challenge rating (CR table). */
export const proficiencyBonus = cr => {
	const n = crNumber(cr);
	if (n == null || Number.isNaN(n)) return null;
	return n < 5 ? 2 : Math.min(9, Math.floor((n - 1) / 4) + 2);
};

/** Average of a dice expression such as "2d10 + 7"; null if it is not one. */
export function diceAverage (expr) {
	const clean = String(expr).replace(/\s+/g, "");
	if (!/^[+-]?(\d+d\d+|\d+)([+-](\d+d\d+|\d+))*$/.test(clean)) return null;
	let total = 0;
	for (const [, sign, term] of clean.matchAll(/([+-]?)(\d+d\d+|\d+)/g)) {
		const [n, d] = term.includes("d") ? term.split("d").map(Number) : [null, null];
		const value = n ? (n * (d + 1)) / 2 : Number(term);
		total += sign === "-" ? -value : value;
	}
	return Math.floor(total);
}

const stripTags = s => String(s).replace(/\{@\w+ ([^|}]*)[^}]*\}/g, "$1");

/** All strings below a value. */
const strings = v => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

/**
 * Checks that derived numbers fit the abilities and the challenge rating. Warns, changes nothing.
 * @returns {string[]} warnings
 */
export function checkStatblock (mon) {
	const warnings = [];
	const m = Object.fromEntries(ABILITIES.map(a => [a, mod(mon[a] ?? 10)]));
	const pb = proficiencyBonus(mon.cr);
	if (pb == null) warnings.push("No challenge rating: proficiency bonus unknown, attack and DC checks skipped.");

	// Hit points
	const formula = mon.hp?.formula?.match(/^(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?$/);
	if (formula) {
		const [, n, d, sign, bonus] = formula;
		const b = bonus ? (sign === "-" ? -1 : 1) * Number(bonus) : 0;
		const avg = Math.floor((Number(n) * (Number(d) + 1)) / 2) + b;
		if (avg !== mon.hp.average) warnings.push(`Hit points: ${mon.hp.formula} averages ${avg}, statblock says ${mon.hp.average}.`);
		if (b !== Number(n) * m.con) warnings.push(`Hit points: bonus ${signed(b)} does not match ${n} × Con ${signed(m.con)} = ${signed(Number(n) * m.con)}.`);
		const dice = (mon.size ?? []).map(s => HIT_DIE[s]).filter(Boolean);
		if (dice.length && !dice.includes(Number(d))) warnings.push(`Hit points: d${d}, but size ${mon.size.join("/")} uses d${dice.join("/d")}.`);
	}

	// Passive Perception
	if (mon.passive != null && typeof mon.passive === "number") {
		const perception = mon.skill?.perception != null ? parseInt(mon.skill.perception, 10) : m.wis;
		if (mon.passive !== 10 + perception) warnings.push(`Passive Perception ${mon.passive}, expected ${10 + perception}.`);
	}

	if (pb != null) {
		// Saving throws and skills: proficiency or expertise
		for (const [ability, value] of Object.entries(mon.save ?? {})) {
			const v = parseInt(value, 10);
			if (v !== m[ability] + pb) warnings.push(`Saving throw ${ABILITY_NAMES[ability] ?? ability} ${value}, expected ${signed(m[ability] + pb)}.`);
		}

		// Spellcasting: DC and attack from the casting ability
		for (const sc of mon.spellcasting ?? []) {
			const ability = sc.ability;
			if (!ability) continue;
			const text = strings(sc.headerEntries ?? []).join(" ");
			for (const [, dc] of text.matchAll(/\{@dc (\d+)\}/g)) {
				if (Number(dc) !== 8 + pb + m[ability]) warnings.push(`${stripTags(sc.name)}: spell save DC ${dc}, expected ${8 + pb + m[ability]} (8 + PB ${pb} + ${ABILITY_NAMES[ability]} ${signed(m[ability])}).`);
			}
			for (const [, hit] of text.matchAll(/\{@hit (-?\d+)\}/g)) {
				if (Number(hit) !== pb + m[ability]) warnings.push(`${stripTags(sc.name)}: spell attack ${signed(Number(hit))}, expected ${signed(pb + m[ability])}.`);
			}
		}

		// Attacks and DCs in the other entries. Weapon attacks (2014: {@atk mw}, {@atk rw}) use Str
		// or Dex; spell attacks and 2024 attack rolls ({@atkr m}) may use any ability.
		const anyDc = new Set(ABILITIES.map(a => 8 + pb + m[a]));
		const anyHit = new Set(ABILITIES.map(a => pb + m[a]));
		for (const prop of ["trait", "action", "bonus", "reaction", "legendary", "mythic"]) {
			for (const entry of mon[prop] ?? []) {
				const text = strings(entry.entries ?? []).join(" ");
				const name = stripTags(entry.name ?? prop);
				for (const [, kind, args, hit] of text.matchAll(/(?:\{@(atkr?) ([^}]*)\}\s*)?\{@hit (-?\d+)\}/g)) {
					const weapon = kind === "atk" && args.split(",").every(a => a.trim().endsWith("w"));
					if (weapon) {
						if (![m.str + pb, m.dex + pb].includes(Number(hit))) warnings.push(`${name}: ${signed(Number(hit))} to hit, expected ${signed(m.str + pb)} (Str) or ${signed(m.dex + pb)} (Dex).`);
					} else if (!anyHit.has(Number(hit))) {
						warnings.push(`${name}: ${signed(Number(hit))} to hit fits no ability (PB ${pb} + modifier).`);
					}
				}
				for (const [, dc] of text.matchAll(/\{@dc (\d+)\}/g)) {
					if (!anyDc.has(Number(dc))) warnings.push(`${name}: DC ${dc} fits no ability (8 + PB ${pb} + modifier).`);
				}
			}
		}
	}

	// Damage: the number before a dice expression is its average
	for (const prop of TEXT_PROPS) {
		for (const s of strings(mon[prop] ?? [])) {
			for (const [, shown, expr] of s.matchAll(/(\d+) \(\{@damage ([^}|]+)[^}]*\}\)/g)) {
				const avg = diceAverage(expr);
				if (avg != null && avg !== Number(shown)) warnings.push(`Damage ${shown} (${expr}): average is ${avg}.`);
			}
		}
	}
	return warnings;
}
// endregion
