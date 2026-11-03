#!/usr/bin/env node
// Command line of the token generator.

import fs from "node:fs";
import path from "node:path";
import {parseArgs} from "node:util";
import {searchMonsters} from "../lib/bestiary.mjs";
import {buildWork, checkWork, createToken, editionFor, quickToken, rebuildFile, rebuildFolder, renderWork} from "../lib/build.mjs";
import {cropInteractive} from "../lib/crop.mjs";
import {crTarget, estimateCr} from "../lib/cr.mjs";
import {closeBrowser} from "../lib/image.mjs";
import {searchWikiImages} from "../lib/wiki.mjs";
import {packWork, readWork, rptokFileName, slugify, TOKEN_FILE, unpackToDir, validateToken, workDirOf, writeJson} from "../lib/workdir.mjs";

const USAGE = `Usage: tokengen <command> [options]

Create
  find <text> [--edition e | --campaign c]
                    Search the mirror's monsters (with their images) and the wikis' images
  new [<slug>] --from <monster> [--source s] [--tiddler t] [--edition e | --campaign c]
      [--name n] [--gm-name g] [--role r] [--image file|clipboard] [--force]
                    Create output/<slug>/ from the mirror (and a wiki tiddler)
  quick <monster> [same options as new]
                    new + build in one go; uses the mirror's ready-made token if there is one

Edit and build
  crop <slug> [--no-open]
                    Choose the crop in the browser; saving renders token.png
  check <slug>      Check statblock numbers (attacks, DCs, hit points, damage; CR when known)
  cr --target <cr> [--edition e | --campaign c]
                    Target values of a CR (CR table)
  cr <slug> [--dpr n [--attack n | --dc n]] [--expected cr]
                    Estimate the CR; --dpr (damage per round) is saved in token.json
  render <slug>     Render token.png, statblock.png and the GM notes
  pack <slug>       Pack output/<slug>/ into a .rptok
  build <slug>      check + render + pack

Tokens
  open <file.rptok> [--slug s] [--force]
                    Unpack a .rptok into output/<slug>/ for editing
  rebuild <file.rptok | folder>
                    Rebuild tokens in place from their embedded data, a folder with its
                    subfolders (keeps .rptok.bak)
`;

class UsageError extends Error {}

const need = (value, message) => {
	if (!value) throw new UsageError(message);
	return value;
};

const printWarnings = warnings => {
	if (!warnings?.length) return void console.log("Check: no warnings.");
	console.log(`Check: ${warnings.length} warning(s)`);
	for (const w of warnings) console.log(`  - ${w}`);
};

const printBuilt = r => {
	if (r.columns) console.log(`Statblock: ${r.columns} column(s)${r.spells ? `, ${r.spells} spell(s) in the GM notes` : ""}`);
	if (r.missingSpells?.length) console.log(`Spells not found in the mirror: ${r.missingSpells.join(", ")}`);
	console.log(`Token: ${r.file}`);
};

const createOptions = (v, from) => ({
	from,
	source: v.source,
	edition: v.edition,
	campaign: v.campaign,
	tiddler: v.tiddler,
	name: v.name,
	gmName: v["gm-name"],
	role: v.role,
	image: v.image,
	force: v.force,
});

const printCreated = r => {
	console.log(`Created ${r.dir}`);
	console.log(`Basis: ${r.base.name} (${r.base.source}, ${r.token.edition}), CR ${r.base.cr ?? "?"}`);
	console.log(`Name: ${r.token.name}${r.token.gmName ? `, GM name: ${r.token.gmName}` : ""}, role ${r.token.role}`);
	console.log(`Image: ${r.imageSource}`);
	if (r.replaced) console.log(`Renamed in the text: ${r.replaced.count ? r.replaced.phrases.join(", ") : "nothing found, check the text"}`);
};

const commands = {
	async find ([text], v) {
		need(text, "find needs a search text");
		const edition = editionFor(v);
		const monsters = searchMonsters(text, edition);
		console.log(`Mirror ${edition}: ${monsters.length} monster(s)`);
		for (const m of monsters.slice(0, 40)) {
			const facts = [m.cr != null ? `CR ${m.cr}` : null, m.size, m.type, m.copyOf ? `copy of ${m.copyOf}` : null].filter(Boolean).join(", ");
			const images = [m.token ? "token" : null, m.artwork ? "artwork" : null].filter(Boolean).join("+") || "no image";
			console.log(`  ${m.name} (${m.source})${facts ? ` – ${facts}` : ""} [${images}]`);
		}
		if (monsters.length > 40) console.log(`  … ${monsters.length - 40} more`);
		const images = searchWikiImages(text).filter(i => !v.campaign || i.campaign === v.campaign);
		console.log(`Wiki images: ${images.length}`);
		for (const i of images.slice(0, 40)) console.log(`  ${i.file}`);
	},

	async new ([slug], v) {
		const r = await createToken({...createOptions(v, v.from), slug});
		printCreated(r);
		printWarnings(r.warnings);
		console.log(r.token.crop ? `Next: crop ${r.slug}, then build ${r.slug}` : `Next: build ${r.slug}`);
	},

	async quick ([monster], v) {
		const r = await quickToken({...createOptions(v, need(monster ?? v.from, "quick needs a monster name")), slug: v.slug});
		printCreated(r);
		printWarnings(r.warnings);
		printBuilt(r);
	},

	async crop ([slug], v) {
		need(slug, "crop needs a slug");
		const result = await cropInteractive(workDirOf(slug), {open: !v["no-open"], onUrl: url => console.log(`Crop page: ${url}`)});
		if (!result.saved) return void console.log("Cancelled, nothing changed.");
		const {x, y, diameter} = result.crop;
		console.log(`Saved crop x ${x}, y ${y}, diameter ${diameter}, role ${result.role}; token.png rendered.`);
	},

	async cr ([slug], v) {
		const signed = n => (n >= 0 ? `+${n}` : `${n}`);
		const targetLine = (edition, cr) => {
			const t = crTarget(edition, cr);
			return t ? `CR ${t._cr}: PB +${t.pb}, AC ${t.ac}, HP ${t.hpMin}–${t.hpMax}, attack ${signed(t.attackBonus)}, save DC ${t.saveDc}, damage per round ${t.dprMin}–${t.dprMax}` : `CR ${cr}: not in the table`;
		};
		if (v.target) return void console.log(targetLine(editionFor(v), v.target));

		const dir = workDirOf(need(slug, "cr needs a slug or --target"));
		const {token, statblock} = readWork(dir);
		if (!statblock) throw new Error("No statblock.json");
		const num = x => (x === undefined ? undefined : Number(x));
		let offense = token.offense;
		if (v.dpr !== undefined) {
			offense = {dpr: num(v.dpr), ...(v.attack !== undefined ? {attack: num(v.attack)} : {}), ...(v.dc !== undefined ? {dc: num(v.dc)} : {})};
			const updated = {...token, offense};
			validateToken(updated);
			writeJson(path.join(dir, TOKEN_FILE), updated);
		}
		const r = estimateCr(statblock, token.edition, {...offense, expectedCr: v.expected});
		console.log(`Statblock: CR ${r.stated}`);
		console.log(`Defensive: CR ${r.defensive.cr} (effective HP ${r.defensive.hp}, AC ${r.defensive.ac})`);
		for (const n of r.defensive.notes) console.log(`  - ${n}`);
		if (r.offensive) {
			const by = r.offensive.dc != null ? `save DC ${r.offensive.dc}` : `attack ${signed(r.offensive.attack)}`;
			console.log(`Offensive: CR ${r.offensive.cr} (${r.offensive.dpr} damage per round, ${by})`);
			for (const n of r.offensive.notes) console.log(`  - ${n}`);
			console.log(`Estimate: CR ${r.cr}`);
			if (v.dpr !== undefined) console.log("Saved as offense in token.json; check compares it from now on.");
		} else {
			console.log("Offensive: needs --dpr (damage per round over three rounds)");
		}
		console.log(`Target ${targetLine(token.edition, r.stated)}`);
	},

	async check ([slug]) {
		printWarnings(checkWork(workDirOf(need(slug, "check needs a slug"))));
	},

	async render ([slug]) {
		const dir = workDirOf(need(slug, "render needs a slug"));
		const r = await renderWork(dir);
		if (r.columns) console.log(`Statblock: ${r.columns} column(s)${r.spells ? `, ${r.spells} spell(s)` : ""}`);
		if (r.missingSpells?.length) console.log(`Spells not found in the mirror: ${r.missingSpells.join(", ")}`);
		console.log(`Rendered into ${dir}`);
	},

	async pack ([slug]) {
		const file = await packWork(workDirOf(need(slug, "pack needs a slug")));
		console.log(`Packed ${file}`);
	},

	async build ([slug]) {
		const r = await buildWork(workDirOf(need(slug, "build needs a slug")));
		printWarnings(r.warnings);
		printBuilt(r);
	},

	async open ([file], v) {
		need(file, "open needs a .rptok file");
		const dir = workDirOf(v.slug ?? slugify(path.basename(file, path.extname(file))));
		const {token, reconstructed, missing} = unpackToDir(file, dir, {force: v.force});
		console.log(`Opened ${rptokFileName(token)} into ${dir}`);
		if (reconstructed) console.log("No generator data in the token: token.json was reconstructed from content.xml (role npc); check it.");
		if (missing.length) console.log(`Images missing in the token: ${missing.join(", ")}`);
	},

	async rebuild ([target]) {
		need(target, "rebuild needs a .rptok file or a folder");
		const report = (file, r) => console.log(r.error ? `Failed ${file}: ${r.error}` : r.skipped ? `Skipped ${file}: ${r.skipped}` : `Rebuilt ${file}`);
		if (!fs.statSync(target).isDirectory()) {
			const r = await rebuildFile(target);
			report(target, r);
			if (r.bak) console.log(`Old version kept as ${r.bak}`);
			return;
		}
		const results = await rebuildFolder(target, report);
		const count = key => results.filter(r => r[key]).length;
		console.log(`${results.length} token(s): ${count("bak")} rebuilt, ${count("skipped")} skipped, ${count("error")} failed. Old versions kept as .rptok.bak.`);
		if (count("error")) process.exitCode = 1;
	},
};

async function main () {
	const {positionals, values} = parseArgs({
		allowPositionals: true,
		options: {
			"from": {type: "string"},
			"source": {type: "string"},
			"edition": {type: "string"},
			"campaign": {type: "string"},
			"tiddler": {type: "string"},
			"name": {type: "string"},
			"gm-name": {type: "string"},
			"role": {type: "string"},
			"image": {type: "string"},
			"slug": {type: "string"},
			"target": {type: "string"},
			"dpr": {type: "string"},
			"attack": {type: "string"},
			"dc": {type: "string"},
			"expected": {type: "string"},
			"force": {type: "boolean", default: false},
			"no-open": {type: "boolean", default: false},
			"help": {type: "boolean", short: "h", default: false},
		},
	});
	const [command, ...args] = positionals;
	if (values.help || !command) return void console.log(USAGE);
	const run = commands[command];
	if (!run) throw new UsageError(`Unknown command "${command}"`);
	await run(args, values);
}

try {
	await main();
} catch (e) {
	console.error(e instanceof UsageError ? `${e.message}\n\n${USAGE}` : `Error: ${e.message}`);
	process.exitCode = 1;
} finally {
	await closeBrowser();
}
