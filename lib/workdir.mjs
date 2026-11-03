// A token's working folder: token.json (what the token is), statblock.json (monster in the
// mirror's format, optional until statblocks are rendered) and the image files named in token.json.
// This module moves tokens between working folders and .rptok files.

import fs from "node:fs";
import path from "node:path";
import {config} from "./config.mjs";
import {gmNotes, parseBasedOn} from "./gmnotes.mjs";
import {renderToken, thumbnails} from "./image.mjs";
import {EMBEDDED_FORMAT, IMAGE_ROLES, imageExtension, packRptok, readRptok, SQUARE_FOOTPRINTS} from "./rptok.mjs";

export const TOKEN_FILE = "token.json";
export const STATBLOCK_FILE = "statblock.json";
export const TOKEN_FORMAT = 1;

const GERMAN = {ä: "ae", ö: "oe", ü: "ue", Ä: "ae", Ö: "oe", Ü: "ue", ß: "ss"};

export const slugify = s => String(s)
	.replace(/[äöüÄÖÜß]/g, c => GERMAN[c])
	.normalize("NFKD").replace(/[̀-ͯ]/g, "")
	.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** File name of the token for the GM, safe on Windows. */
export const rptokFileName = token => `${(token.gmName || token.name).replace(/[<>:"/\\|?*]/g, "").trim()}.rptok`;

export const workDirOf = slug => path.join(config.output, slug);

const readJson = file => JSON.parse(fs.readFileSync(file, "utf-8"));
export const writeJson = (file, obj) => fs.writeFileSync(file, `${JSON.stringify(obj, null, "\t")}\n`);

export function validateToken (token) {
	const errors = [];
	if (token.format !== TOKEN_FORMAT) errors.push(`format must be ${TOKEN_FORMAT}`);
	if (!token.name) errors.push("name missing");
	if (!config.roles[token.role]) errors.push(`role "${token.role}" unknown, expected one of ${Object.keys(config.roles).join(", ")}`);
	if (!config.mirror[token.edition]) errors.push(`edition "${token.edition}" unknown`);
	if (token.campaign && !config.campaigns[token.campaign]) errors.push(`campaign "${token.campaign}" unknown`);
	if (token.size && !SQUARE_FOOTPRINTS[token.size]) errors.push(`size "${token.size}" unknown`);
	if (token.background !== undefined && !/^#[0-9a-f]{6}$/i.test(token.background)) errors.push("background must be a colour like #c9bfa5");
	if (token.offense) {
		const {dpr, attack, dc} = token.offense;
		const ok = Number.isFinite(dpr) && dpr >= 0 && (attack === undefined || Number.isFinite(attack)) && (dc === undefined || Number.isFinite(dc));
		if (!ok) errors.push("offense must be {dpr, attack?, dc?} with numbers");
	}
	if (token.crop) {
		const valid = ["x", "y", "diameter"].every(k => Number.isFinite(token.crop[k])) && token.crop.diameter > 0;
		if (!valid) errors.push("crop must be {x, y, diameter} in pixels of the portrait");
	}
	for (const role of IMAGE_ROLES) if (!token.images?.[role.key]) errors.push(`images.${role.key} missing`);
	if (errors.length) throw new Error(`Invalid ${TOKEN_FILE}: ${errors.join("; ")}`);
}

export function readWork (dir) {
	const tokenFile = path.join(dir, TOKEN_FILE);
	if (!fs.existsSync(tokenFile)) throw new Error(`No ${TOKEN_FILE} in ${dir}`);
	const token = readJson(tokenFile);
	validateToken(token);
	const statblockFile = path.join(dir, STATBLOCK_FILE);
	const statblock = fs.existsSync(statblockFile) ? readJson(statblockFile) : null;
	return {token, statblock};
}

const SIZE_ORDER = Object.keys(SQUARE_FOOTPRINTS);

/** Size letter for MapTool: the largest of the statblock ("Small or Medium" -> M), else token.json, else Medium. */
export const sizeOf = (token, statblock) => {
	const sizes = (statblock?.size ?? []).filter(s => SIZE_ORDER.includes(s));
	if (sizes.length) return sizes.reduce((a, b) => (SIZE_ORDER.indexOf(b) > SIZE_ORDER.indexOf(a) ? b : a));
	return token.size ?? "M";
};

export const TOKEN_IMAGE_FILE = "token.png";
export const STATBLOCK_IMAGE_FILE = "statblock.png";
/** What render learned for the GM notes: {statblock (text), spells, spellcasting}. */
export const SHEET_FILE = "sheet.json";
/** GM notes of a foreign token (made without the generator), kept as they are. */
export const GMNOTES_FILE = "gmnotes.txt";

/** Colour behind the picture: token.json, else config.tokenBackground. */
export const backgroundOf = token => token.background ?? config.tokenBackground;

export const loadImage = (dir, name) => {
	const file = path.join(dir, name);
	return {data: fs.readFileSync(file), ext: imageExtension(file)};
};

/**
 * Renders token.png from the portrait, the crop and the ring of the role. A token without crop
 * keeps its token image as it is (e.g. a ready-made token from the mirror).
 * @returns {string | null} the written file, null when nothing was rendered
 */
export async function renderTokenImage (dir) {
	const {token} = readWork(dir);
	if (!token.crop) return null;
	const {png} = await renderToken(loadImage(dir, token.images.portrait), token.crop, config.roles[token.role].ring, backgroundOf(token));
	const file = path.join(dir, TOKEN_IMAGE_FILE);
	fs.writeFileSync(file, png);
	if (token.images.token !== TOKEN_IMAGE_FILE) {
		token.images.token = TOKEN_IMAGE_FILE;
		writeJson(path.join(dir, TOKEN_FILE), token);
	}
	return file;
}

/** Packs a working folder into <gmName or name>.rptok inside it and returns the file path. */
export async function packWork (dir) {
	const {token, statblock} = readWork(dir);
	const images = Object.fromEntries(IMAGE_ROLES.map(role => [role.key, loadImage(dir, token.images[role.key])]));
	const thumbs = await thumbnails(images.token);
	const sheetFile = path.join(dir, SHEET_FILE);
	const notesFile = path.join(dir, GMNOTES_FILE);
	const sheet = fs.existsSync(sheetFile) ? readJson(sheetFile) : null;
	const notes = sheet ? gmNotes(token, sheet) : fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf-8") : gmNotes(token);
	const data = packRptok({
		name: token.name,
		gmName: token.gmName,
		size: sizeOf(token, statblock),
		gmNotes: notes,
		images,
		tokenSize: {width: thumbs.width, height: thumbs.height},
		thumbnails: thumbs,
		embedded: {format: EMBEDDED_FORMAT, token, statblock, sheet},
		maptoolVersion: config.maptoolVersion,
	});
	const file = path.join(dir, rptokFileName(token));
	fs.writeFileSync(file, data);
	return file;
}

/**
 * Unpacks a .rptok into a working folder. Tokens without generator data (made by hand in
 * MapTool, or saved again by MapTool) get a token.json reconstructed from content.xml.
 * @returns {{token, reconstructed: boolean, missing: string[]}}
 */
export function unpackToDir (file, dir, {force = false} = {}) {
	const t = readRptok(fs.readFileSync(file));
	if (fs.existsSync(dir) && fs.readdirSync(dir).length && !force) throw new Error(`${dir} is not empty (use --force to overwrite)`);
	fs.mkdirSync(dir, {recursive: true});

	let token;
	let statblock = null;
	let sheet = null;
	const reconstructed = !t.embedded;
	if (t.embedded) {
		({token, statblock = null, sheet = null} = t.embedded);
	} else {
		const based = parseBasedOn(t.gmNotes);
		token = {
			format: TOKEN_FORMAT,
			name: t.name,
			...(t.gmName ? {gmName: t.gmName} : {}),
			role: "npc",
			edition: based?.edition ?? config.defaultEdition,
			size: t.size ?? "M",
			...(based ? {basedOn: based.basedOn} : {}),
			images: {},
		};
	}

	const missing = [];
	for (const role of IMAGE_ROLES) {
		const img = t.images[role.key];
		if (!img) {
			missing.push(role.key);
			continue;
		}
		const name = reconstructed ? `${role.key}.${img.ext}` : token.images[role.key];
		token.images[role.key] = name;
		fs.writeFileSync(path.join(dir, name), img.data);
	}
	writeJson(path.join(dir, TOKEN_FILE), token);
	if (statblock) writeJson(path.join(dir, STATBLOCK_FILE), statblock);
	if (sheet) writeJson(path.join(dir, SHEET_FILE), sheet);
	if (reconstructed && t.gmNotes) fs.writeFileSync(path.join(dir, GMNOTES_FILE), t.gmNotes);
	return {token, reconstructed, missing};
}
