// GM notes of a token: plain text (MapTool 1.11 has no rich notes). Short enough to use at the
// table: who it is, a one-line overview per spell, lair actions and regional effects, then the
// spells in full, alphabetically. The statblock itself is the character sheet image.
// The "Based on" line is also the fallback for reopening a token whose generator data is lost.

const BASED_ON = /^Based on: (.+) \(([^,()]+), (\d{4})\)$/m;
const RULE = "=".repeat(40);

const ordinal = n => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const levelName = level => (level === 0 ? "Cantrips" : `${ordinal(level)} level`);

const header = token => [
	token.gmName ? `${token.gmName} (players see: ${token.name})` : token.name,
	...(token.basedOn ? [`Based on: ${token.basedOn.name} (${token.basedOn.source}, ${token.edition})`] : []),
];

function spellOverview (spells, spellcasting) {
	const lines = ["SPELLS", ...spellcasting];
	const byLevel = [...spells.filter(s => !s.missing)].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
	let level = null;
	for (const s of byLevel) {
		if (s.level !== level) {
			level = s.level;
			lines.push(`${levelName(level)}:`);
		}
		lines.push(`- ${s.summary}`);
	}
	const missing = spells.filter(s => s.missing);
	if (missing.length) lines.push(`Not found in the mirror: ${missing.map(s => `${s.name} (${s.source})`).join(", ")}`);
	return lines.join("\n");
}

/**
 * @param {object} token - token.json
 * @param {object} [sheet] - sheet.json, written by render
 * @param {Array<{name, level, summary, full, missing}>} [sheet.spells]
 * @param {string[]} [sheet.spellcasting] - e.g. "Spellcasting, DC 17, +9 to hit"
 * @param {string} [sheet.lair] - lair actions and regional effects as text
 */
export function gmNotes (token, {spells = [], spellcasting = [], lair = null} = {}) {
	const parts = [header(token).join("\n")];
	if (spells.length) parts.push(spellOverview(spells, spellcasting));
	if (lair) parts.push(lair);
	const full = spells.filter(s => !s.missing).sort((a, b) => a.name.localeCompare(b.name));
	if (full.length) parts.push(`SPELL DESCRIPTIONS\n\n${full.map(s => s.full).join(`\n\n${"-".repeat(20)}\n\n`)}`);
	return parts.join(`\n\n${RULE}\n\n`);
}

/** Reads the "Based on" line back: {basedOn: {name, source}, edition} or null. */
export function parseBasedOn (notes) {
	const m = String(notes ?? "").match(BASED_ON);
	return m ? {basedOn: {name: m[1], source: m[2]}, edition: m[3]} : null;
}
