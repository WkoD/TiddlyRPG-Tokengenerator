// Loads config.json and, on top of it, the untracked config.local.json (mirror paths, campaigns).
// Objects of the local file are merged entry by entry, everything else replaces. Every path is
// relative to the repository root.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf-8"));
const isObject = v => v && typeof v === "object" && !Array.isArray(v);

const base = readJson(path.join(ROOT, "config.json"));
const localFile = path.join(ROOT, "config.local.json");
const local = fs.existsSync(localFile) ? readJson(localFile) : {};
const raw = {...base};
for (const [key, value] of Object.entries(local)) raw[key] = isObject(value) && isObject(base[key]) ? {...base[key], ...value} : value;

const abs = p => path.resolve(ROOT, p);
const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, fn(v)]));

export const config = {
	...raw,
	output: abs(raw.output),
	mirror: mapValues(raw.mirror, v => ({...v, src: abs(v.src), img: abs(v.img)})),
	campaigns: mapValues(raw.campaigns, v => ({...v, wiki: abs(v.wiki)})),
};

/** Mirror roots of an edition; throws with a hint when config.local.json lacks it. */
export function mirrorOf (edition) {
	const m = config.mirror[edition];
	if (!m) throw new Error(`No mirror for edition "${edition}": add mirror.${edition} {src, img, spellSource} to config.local.json`);
	return m;
}
