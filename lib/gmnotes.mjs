// GM notes of a token as HTML (gmNotesType text/html, MapTool 1.13 or later). Short enough to
// use at the table: who it is, a one-line overview per spell, lair actions and regional effects,
// then the spells in full, alphabetically. The statblock itself is the character sheet image.
//
// The notes are built as a small document (headings, paragraphs, lists, rules) and then written
// as HTML. MapTool renders it with Swing's HTML 3.2, so only plain elements are used. (Markdown
// notes were tried with MapTool 1.18.7 and did not render correctly.)
// The "Based on" line is also the fallback for reopening a token whose generator data is lost.

const BASED_ON = /^Based on: (.+) \(([^,()]+), (\d{4})\)$/m;

const ordinal = n => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const levelName = level => (level === 0 ? "Cantrips" : `${ordinal(level)} level`);

// region Document: blocks of inline segments {t, b?, i?}
const h = (level, text) => ({type: "h", level, text});
const p = (...lines) => ({type: "p", lines: lines.map(l => (Array.isArray(l) ? l : [{t: l}]))});
const ul = items => ({type: "ul", items});
const hr = () => ({type: "hr"});

/** Plain text (paragraphs split by blank lines, "- " lines as lists) as blocks. */
function textBlocks (text) {
	const blocks = [];
	for (const chunk of String(text ?? "").trim().split(/\n\s*\n/)) {
		let para = [];
		let list = [];
		const flushPara = () => {
			if (para.length) blocks.push(p(...para));
			para = [];
		};
		const flushList = () => {
			if (list.length) blocks.push(ul(list.map(l => [{t: l}])));
			list = [];
		};
		for (const line of chunk.split("\n").map(l => l.trim()).filter(Boolean)) {
			if (line.startsWith("- ")) {
				flushPara();
				list.push(line.slice(2));
			} else {
				flushList();
				para.push(line);
			}
		}
		flushList();
		flushPara();
	}
	return blocks;
}

/** "Fire Bolt · 1 action · 120 feet — You hurl…" with the name in bold. */
function summarySegments (summary) {
	const s = String(summary);
	const cut = [s.indexOf(" · "), s.indexOf(" — ")].filter(i => i >= 0);
	const end = cut.length ? Math.min(...cut) : s.length;
	return [{t: s.slice(0, end), b: true}, {t: s.slice(end)}];
}

/** Full spell text: first line is "Name (level school)", then the casting lines, then the body. */
function spellBlocks (full) {
	const [title, ...rest] = String(full).split("\n");
	const m = title.match(/^(.*?) \((.*)\)$/);
	return [h(4, m ? m[1] : title), ...(m ? [p([{t: m[2], i: true}])] : []), ...textBlocks(rest.join("\n"))];
}

const lairSections = lair => {
	if (!lair) return [];
	if (Array.isArray(lair)) return lair;
	// sheet.json from before the sections: one text with upper-case headings
	return [{name: "Lair", text: lair}];
};

function document (token, {spells = [], spellcasting = [], lair = null}) {
	const doc = [h(2, token.gmName || token.name)];
	if (token.gmName) doc.push(p(`Players see: ${token.name}`));
	if (token.basedOn) doc.push(p(`Based on: ${token.basedOn.name} (${token.basedOn.source}, ${token.edition})`));

	const found = spells.filter(s => !s.missing);
	if (spells.length) {
		doc.push(h(3, "Spells"), ...spellcasting.map(s => p([{t: s, i: true}])));
		const byLevel = [...found].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
		for (const level of [...new Set(byLevel.map(s => s.level))]) {
			doc.push(p([{t: levelName(level), b: true}]), ul(byLevel.filter(s => s.level === level).map(s => summarySegments(s.summary))));
		}
		const missing = spells.filter(s => s.missing);
		if (missing.length) doc.push(p(`Not found in the mirror: ${missing.map(s => `${s.name} (${s.source})`).join(", ")}`));
	}
	for (const section of lairSections(lair)) doc.push(h(3, section.name), ...textBlocks(section.text));
	const full = [...found].sort((a, b) => a.name.localeCompare(b.name));
	if (full.length) {
		doc.push(h(3, "Spell Descriptions"));
		full.forEach((s, i) => doc.push(...(i ? [hr()] : []), ...spellBlocks(s.full)));
	}
	return doc;
}
// endregion

// region Writers
const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const segHtml = segs => segs.map(({t, b, i}) => {
	let s = escHtml(t);
	if (i) s = `<i>${s}</i>`;
	if (b) s = `<b>${s}</b>`;
	return s;
}).join("");

function toHtml (doc) {
	const out = doc.map(block => {
		switch (block.type) {
			case "h": return `<h${block.level}>${escHtml(block.text)}</h${block.level}>`;
			case "p": return `<p>${block.lines.map(segHtml).join("<br>")}</p>`;
			case "ul": return `<ul>${block.items.map(item => `<li>${segHtml(item)}</li>`).join("")}</ul>`;
			case "hr": return "<hr>";
		}
		throw new Error(`Unknown block ${block.type}`);
	});
	return `<html><body>\n${out.join("\n")}\n</body></html>`;
}
// endregion

/**
 * GM notes as HTML.
 * @param {object} token - token.json
 * @param {object} [sheet] - sheet.json, written by render
 * @param {Array<{name, level, summary, full, missing}>} [sheet.spells]
 * @param {string[]} [sheet.spellcasting] - e.g. "Spellcasting, DC 17, +9 to hit"
 * @param {Array<{name, text}>} [sheet.lair] - lair actions, regional effects, mythic encounter
 */
export const gmNotes = (token, sheet = {}) => toHtml(document(token, sheet));

const NAMED = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "};

/** Reads the "Based on" line back (HTML or plain notes): {basedOn: {name, source}, edition} or null. */
export function parseBasedOn (notes) {
	const text = String(notes ?? "")
		.replace(/<[^>]+>/g, "\n")
		.replace(/&(\w+);/g, (m, e) => NAMED[e] ?? m);
	const m = text.match(BASED_ON);
	return m ? {basedOn: {name: m[1].trim(), source: m[2]}, edition: m[3]} : null;
}
