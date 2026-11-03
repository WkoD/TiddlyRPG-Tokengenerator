// The token workflow: create a working folder from the mirror (and a wiki tiddler), render its
// images and GM notes, pack it, rebuild tokens.

import fs from "node:fs";
import path from "node:path";
import {exactMonsters, searchMonsters} from "./bestiary.mjs";
import {saveClipboardImage} from "./clipboard.mjs";
import {config} from "./config.mjs";
import {crDistance, estimateCr} from "./cr.mjs";
import {withMirror} from "./mirror.mjs";
import {thumbnails} from "./image.mjs";
import {readRptok} from "./rptok.mjs";
import {checkStatblock, renameMonster} from "./statblock.mjs";
import {findTiddler, tiddlerImages} from "./wiki.mjs";
import {
	loadImage, packWork, readWork, renderTokenImage, SHEET_FILE, slugify, STATBLOCK_FILE, STATBLOCK_IMAGE_FILE,
	TOKEN_FILE, TOKEN_FORMAT, TOKEN_IMAGE_FILE, unpackToDir, validateToken, workDirOf, writeJson,
} from "./workdir.mjs";

/** Edition: given, else the campaign's, else the default. */
export function editionFor ({edition, campaign}) {
	if (campaign && !config.campaigns[campaign]) throw new Error(`Unknown campaign "${campaign}", expected one of ${Object.keys(config.campaigns).join(", ")}`);
	return edition ?? (campaign ? config.campaigns[campaign].edition : null) ?? config.defaultEdition;
}

/** Same as TokenRender.defaultCrop (lib/token-render.js). */
const defaultCrop = (width, height) => {
	const diameter = Math.min(width, height);
	return {x: width / 2, y: height > width ? diameter / 2 : height / 2, diameter};
};

const imageFileName = (base, file) => `${base}${path.extname(file).toLowerCase()}`;

/**
 * Creates output/<slug>/ with token.json, statblock.json and the picture.
 * @param {object} o
 * @param {string} [o.from] - monster name in the mirror (from the tiddler's creature field if missing)
 * @param {string} [o.source]
 * @param {string} [o.edition]
 * @param {string} [o.campaign]
 * @param {string} [o.tiddler] - wiki tiddler for name, creature and image (needs campaign)
 * @param {string} [o.name] - shown to everyone
 * @param {string} [o.gmName] - shown to the GM only
 * @param {string} [o.role] - default npc for named tokens, mob otherwise
 * @param {string} [o.image] - picture file or "clipboard"
 * @param {string} [o.slug]
 * @param {boolean} [o.force] - overwrite a non-empty working folder
 * @param {boolean} [o.quick] - prefer the mirror's ready-made token
 */
export async function createToken (o) {
	const edition = editionFor(o);
	let {from, name, image} = o;
	const {gmName} = o;

	if (o.tiddler) {
		if (!o.campaign) throw new Error("--tiddler needs --campaign");
		const tiddler = findTiddler(o.campaign, o.tiddler);
		if (!tiddler) throw new Error(`No tiddler "${o.tiddler}" in the ${o.campaign} wiki`);
		from ??= tiddler.fields.creature;
		name ??= tiddler.title;
		image ??= tiddlerImages(o.campaign, tiddler)[0];
		if (!from) throw new Error(`Tiddler "${tiddler.title}" has no creature field; give --from`);
	}
	if (!from) throw new Error("No basis: give --from (or --tiddler with a creature field)");

	const matches = exactMonsters(from, edition, o.source);
	if (!matches.length) {
		const similar = searchMonsters(from, edition).slice(0, 8).map(m => `${m.name} (${m.source})`);
		throw new Error(`No monster "${from}"${o.source ? ` in ${o.source}` : ""} in the ${edition} mirror.${similar.length ? ` Similar: ${similar.join(", ")}` : ""}`);
	}
	if (matches.length > 1) throw new Error(`"${from}" exists in several sources: ${matches.map(m => m.source).join(", ")}; give --source`);
	const base = matches[0];

	const title = gmName || name; // statblock title: the GM's name for the creature
	const slug = o.slug ?? slugify(title || base.name);
	const dir = workDirOf(slug);
	if (fs.existsSync(dir) && fs.readdirSync(dir).length && !o.force) throw new Error(`${dir} is not empty (use --force to overwrite)`);
	fs.rmSync(dir, {recursive: true, force: true});
	fs.mkdirSync(dir, {recursive: true});

	// Picture: given > ready-made token (quick) > artwork > ready-made token
	let portrait;
	let tokenImage = null;
	let imageSource;
	const copy = (from, to) => fs.copyFileSync(from, path.join(dir, to));
	if (image === "clipboard") {
		portrait = "portrait.png";
		saveClipboardImage(path.join(dir, portrait));
		imageSource = "clipboard";
	} else if (image) {
		if (!fs.existsSync(image)) throw new Error(`Image not found: ${image}`);
		portrait = imageFileName("portrait", image);
		copy(image, portrait);
		imageSource = image;
	} else if (o.quick && base.token) {
		tokenImage = "token.webp";
		copy(base.token, tokenImage);
		portrait = base.artwork ? imageFileName("portrait", base.artwork) : "portrait.webp";
		copy(base.artwork ?? base.token, portrait);
		imageSource = `ready-made token${base.artwork ? " (portrait: artwork)" : ""}`;
	} else if (base.artwork) {
		portrait = imageFileName("portrait", base.artwork);
		copy(base.artwork, portrait);
		imageSource = "artwork from the mirror";
	} else if (base.token) {
		tokenImage = "token.webp";
		portrait = "portrait.webp";
		copy(base.token, tokenImage);
		copy(base.token, portrait);
		imageSource = "ready-made token (no artwork)";
	} else {
		throw new Error(`No image for ${base.name} (${base.source}) in the mirror: give --image`);
	}
	let crop = null;
	if (!tokenImage) {
		const {width, height} = await thumbnails(loadImage(dir, portrait));
		crop = defaultCrop(width, height);
	}

	const {statblock, replaced} = await withMirror(edition, async s => {
		const mon = await s.monster(base.name, base.source);
		if (!mon) throw new Error(`The mirror could not resolve ${base.name} (${base.source})`);
		const renamed = title && title !== mon.name ? renameMonster(mon, title, await s.shortName(mon)) : null;
		return {statblock: mon, replaced: renamed};
	});

	const token = {
		format: TOKEN_FORMAT,
		name: name || base.name,
		...(gmName ? {gmName} : {}),
		role: o.role ?? (name || gmName ? "npc" : "mob"),
		...(o.campaign ? {campaign: o.campaign} : {}),
		edition,
		basedOn: {name: base.name, source: base.source},
		images: {token: tokenImage ?? TOKEN_IMAGE_FILE, portrait, statblock: STATBLOCK_IMAGE_FILE},
		...(crop ? {crop} : {}),
	};
	validateToken(token);
	writeJson(path.join(dir, TOKEN_FILE), token);
	writeJson(path.join(dir, STATBLOCK_FILE), statblock);
	return {slug, dir, token, base, replaced, imageSource, warnings: checkStatblock(statblock)};
}

/**
 * Renders token.png (when the token has a crop), statblock.png and sheet.json (GM notes parts).
 * @returns {{columns?: number, spells?: number, missingSpells?: string[]}}
 */
export async function renderWork (dir) {
	await renderTokenImage(dir);
	const {token, statblock} = readWork(dir);
	if (!statblock) return {};
	const result = await withMirror(token.edition, async s => ({
		...(await s.statblock(statblock, loadImage(dir, token.images.token))),
		spells: await s.spells(statblock),
		spellcasting: await s.spellcastingStats(statblock),
		lair: await s.lair(statblock),
	}));
	fs.writeFileSync(path.join(dir, STATBLOCK_IMAGE_FILE), result.png);
	if (token.images.statblock !== STATBLOCK_IMAGE_FILE) {
		token.images.statblock = STATBLOCK_IMAGE_FILE;
		writeJson(path.join(dir, TOKEN_FILE), token);
	}
	writeJson(path.join(dir, SHEET_FILE), {spells: result.spells, spellcasting: result.spellcasting, lair: result.lair});
	return {
		columns: result.columns,
		spells: result.spells.length,
		missingSpells: result.spells.filter(sp => sp.missing).map(sp => `${sp.name} (${sp.source})`),
	};
}

/** checkStatblock, plus the CR estimate when token.json knows the damage per round (offense). */
export function checkWork (dir) {
	const {token, statblock} = readWork(dir);
	if (!statblock) return [];
	const warnings = checkStatblock(statblock);
	if (token.offense) {
		const r = estimateCr(statblock, token.edition, token.offense);
		const distance = crDistance(token.edition, r.cr, r.stated);
		if (distance >= 2) {
			warnings.push(`CR: estimate ${r.cr} (defensive ${r.defensive.cr}, offensive ${r.offensive.cr}) is ${distance} steps from the statblock's CR ${r.stated}; run cr for details.`);
		}
	}
	return warnings;
}

/** check + render + pack. */
export async function buildWork (dir) {
	const warnings = checkWork(dir);
	const rendered = await renderWork(dir);
	const file = await packWork(dir);
	return {file, warnings, ...rendered};
}

/** Creates and builds in one go, for tokens needed at the table. */
export async function quickToken (o) {
	const created = await createToken({...o, quick: true});
	const built = await buildWork(created.dir);
	return {...created, ...built};
}

/** All .rptok files below a folder (subfolders included), sorted. */
export function findTokenFiles (dir) {
	const out = [];
	const walk = d => {
		for (const entry of fs.readdirSync(d, {withFileTypes: true})) {
			const p = path.join(d, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.isFile() && entry.name.toLowerCase().endsWith(".rptok")) out.push(p);
		}
	};
	walk(dir);
	return out.sort();
}

/**
 * Rebuilds every .rptok below a folder. Goes on after a failure.
 * @param {(file, result) => void} [onEach] - result is {bak}, {skipped} or {error}
 * @returns {Promise<Array<{file, bak?, skipped?, error?}>>}
 */
export async function rebuildFolder (dir, onEach = () => {}) {
	const results = [];
	for (const file of findTokenFiles(dir)) {
		let result;
		try {
			result = await rebuildFile(file);
		} catch (e) {
			result = {error: e.message};
		}
		results.push({file, ...result});
		onEach(file, result);
	}
	return results;
}

/**
 * Rebuilds a .rptok in place from its embedded data (images and GM notes rendered again) and
 * keeps the old file as .rptok.bak.
 * @returns {Promise<{skipped: string} | {bak: string}>}
 */
export async function rebuildFile (file) {
	const t = readRptok(fs.readFileSync(file));
	if (!t.embedded) return {skipped: "no generator data"};
	const bak = `${file}.bak`;
	if (fs.existsSync(bak)) throw new Error(`${bak} exists; check it and delete it first`);

	fs.mkdirSync(config.output, {recursive: true});
	const tmp = fs.mkdtempSync(path.join(config.output, ".rebuild-"));
	try {
		unpackToDir(file, tmp, {force: true});
		await renderWork(tmp);
		const built = await packWork(tmp);
		fs.copyFileSync(file, bak);
		fs.copyFileSync(built, file);
	} finally {
		fs.rmSync(tmp, {recursive: true, force: true});
	}
	return {bak};
}
