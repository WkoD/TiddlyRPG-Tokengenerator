// Reads the campaign wikis (TiddlyWiki folders, see config.campaigns): tiddler fields and the
// images they name. Read only.

import fs from "node:fs";
import path from "node:path";
import {config} from "./config.mjs";
import {normName} from "./bestiary.mjs";

const cache = new Map();

/** Header fields of a .tid file. */
function readFields (file) {
	const fields = {};
	for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
		if (!line.trim()) break;
		const i = line.indexOf(":");
		if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return fields;
}

/** TiddlyWiki list syntax: words and [[multi word]] entries. */
export const parseList = s => [...String(s ?? "").matchAll(/\[\[([^\]]+)\]\]|(\S+)/g)].map(m => m[1] ?? m[2]);

function wikiOf (campaign) {
	const c = config.campaigns[campaign];
	if (!c) throw new Error(`Unknown campaign "${campaign}", expected one of ${Object.keys(config.campaigns).join(", ")}`);
	if (cache.has(campaign)) return cache.get(campaign);
	const dir = path.join(c.wiki, "tiddlers");
	const tiddlers = new Map();
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith(".tid")) continue;
		const file = path.join(dir, name);
		const fields = readFields(file);
		if (fields.title) tiddlers.set(fields.title, {file, fields});
	}
	const wiki = {root: c.wiki, tiddlers};
	cache.set(campaign, wiki);
	return wiki;
}

/** {title, fields, file} of a tiddler, by exact title, else case-insensitive; null if none. */
export function findTiddler (campaign, title) {
	const {tiddlers} = wikiOf(campaign);
	let hit = tiddlers.get(title);
	if (!hit) {
		const q = normName(title);
		const key = [...tiddlers.keys()].find(t => normName(t) === q);
		hit = key ? tiddlers.get(key) : null;
	}
	return hit ? {title: hit.fields.title, fields: hit.fields, file: hit.file} : null;
}

/** Image files of a tiddler: field image, resolved through its type tag to images/<tag>/. */
export function tiddlerImages (campaign, tiddler) {
	const {root} = wikiOf(campaign);
	const names = String(tiddler.fields.image ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const folders = parseList(tiddler.fields.tags).map(tag => path.join(root, "images", tag.toLowerCase()));
	const out = [];
	for (const name of names) {
		const file = folders.map(f => path.join(f, name)).find(f => fs.existsSync(f));
		if (file) out.push(file);
	}
	return out;
}

/** Image files in the wikis' image folders whose file name contains text. */
export function searchWikiImages (text) {
	const q = normName(text);
	const out = [];
	for (const [campaign, c] of Object.entries(config.campaigns)) {
		const images = path.join(c.wiki, "images");
		if (!fs.existsSync(images)) continue;
		for (const folder of fs.readdirSync(images)) {
			const dir = path.join(images, folder);
			if (!fs.statSync(dir).isDirectory()) continue;
			for (const name of fs.readdirSync(dir)) {
				if (normName(name).includes(q) && /\.(png|jpe?g|webp)$/i.test(name)) out.push({campaign, folder, file: path.join(dir, name)});
			}
		}
	}
	return out;
}
