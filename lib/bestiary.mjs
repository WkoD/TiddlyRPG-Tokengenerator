// Searches the raw bestiary of the mirror (no mirror code needed) and finds the images
// that belong to a monster: the ready-made token and the artwork from the fluff files.

import fs from "node:fs";
import path from "node:path";
import {mirrorOf} from "./config.mjs";

const cache = new Map();
const readJson = file => JSON.parse(fs.readFileSync(file, "utf-8"));

/** Lower case, no accents, single spaces: for comparing names. */
export const normName = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Parser.nameToTokenName of the mirror: ASCII, no double quotes. */
const tokenName = name => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Æ/g, "AE").replace(/æ/g, "ae").replace(/"/g, "");

function load (edition) {
	if (cache.has(edition)) return cache.get(edition);
	const roots = mirrorOf(edition);
	const dir = path.join(roots.src, "data/bestiary");
	const monsters = [];
	for (const file of Object.values(readJson(path.join(dir, "index.json")))) {
		for (const m of readJson(path.join(dir, file)).monster ?? []) monsters.push(m);
	}
	const fluff = new Map();
	for (const file of Object.values(readJson(path.join(dir, "fluff-index.json")))) {
		for (const f of readJson(path.join(dir, file)).monsterFluff ?? []) fluff.set(`${normName(f.name)}|${f.source.toLowerCase()}`, f);
	}
	const data = {roots, monsters, fluff};
	cache.set(edition, data);
	return data;
}

const crText = m => (m.cr == null ? null : typeof m.cr === "object" ? m.cr.cr : m.cr);

function artworkOf (data, name, source, depth = 0) {
	const f = data.fluff.get(`${normName(name)}|${source.toLowerCase()}`);
	if (!f || depth > 3) return null;
	const href = f.images?.find(i => i.href?.type === "internal")?.href;
	if (href) {
		const file = path.join(data.roots.img, href.path);
		return fs.existsSync(file) ? file : null;
	}
	if (f._copy) return artworkOf(data, f._copy.name, f._copy.source, depth + 1);
	return null;
}

function imagesOf (data, m) {
	const tokenFile = path.join(data.roots.img, "bestiary/tokens", m.source, `${tokenName(m.name)}.webp`);
	return {
		token: fs.existsSync(tokenFile) ? tokenFile : null,
		artwork: artworkOf(data, m.name, m.source),
	};
}

const summary = (data, m) => ({
	name: m.name,
	source: m.source,
	cr: crText(m),
	size: m.size?.join("/") ?? null,
	type: typeof m.type === "object" ? m.type.type?.choose?.join("/") ?? m.type.type : m.type ?? null,
	copyOf: m._copy ? `${m._copy.name} (${m._copy.source})` : null,
	...imagesOf(data, m),
});

/** Monsters whose name contains text; exact matches first. */
export function searchMonsters (text, edition) {
	const data = load(edition);
	const q = normName(text);
	const hits = data.monsters.filter(m => normName(m.name).includes(q));
	hits.sort((a, b) => (normName(a.name) === q ? 0 : 1) - (normName(b.name) === q ? 0 : 1) || a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
	return hits.map(m => summary(data, m));
}

const uid = (name, source) => `${normName(name)}|${source.toLowerCase()}`;
const reprints = m => (m.reprintedAs ?? []).map(r => (typeof r === "string" ? r : r.uid ?? "")).map(r => {
	const [name, source = ""] = r.split("|");
	return uid(name, source);
});

/**
 * Monsters with exactly this name (any case), optionally from one source. Entries reprinted as
 * another hit are left out (an older book's entry when a newer book reprints it under the same name).
 */
export function exactMonsters (name, edition, source) {
	const data = load(edition);
	const q = normName(name);
	const hits = data.monsters.filter(m => normName(m.name) === q && (!source || m.source.toLowerCase() === source.toLowerCase()));
	const ids = new Set(hits.map(m => uid(m.name, m.source)));
	const current = hits.filter(m => !reprints(m).some(r => ids.has(r)));
	return (current.length ? current : hits).map(m => summary(data, m));
}
