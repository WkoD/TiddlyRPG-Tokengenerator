// The data mirror in headless Chrome. A local server delivers one edition of the mirror (src at
// /, img at /img/) plus templates/statblock.html; that page runs the mirror's own code to resolve
// monsters (including _copy), render statblocks and look up spells. Nothing here reimplements it.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {mirrorOf, ROOT} from "./config.mjs";
import {getBrowser, MIME} from "./image.mjs";

const PAGE_FILE = path.join(ROOT, "templates/statblock.html");
const PAGE_PATH = "/__tokengen.html";
const TOKEN_PATH = "/__tokengen/token";
const TYPES = {...Object.fromEntries(Object.entries(MIME).map(([ext, type]) => [`.${ext}`, type])),
	".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2",
	".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".html": "text/html"};

/** Column width of the sheet in CSS px; rendered at twice the resolution. */
export const COLUMN_WIDTH = 420;
/** A single column taller than this (CSS px) is set in two columns. */
export const MAX_SINGLE_COLUMN_HEIGHT = 1250;
const SCALE = 2;

function startServer (roots, state) {
	const inside = (root, file) => file === root || file.startsWith(root + path.sep);
	const server = http.createServer((req, res) => {
		const url = decodeURIComponent(req.url.split("?")[0]);
		if (url === PAGE_PATH) {
			res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
			return res.end(fs.readFileSync(PAGE_FILE));
		}
		if (url === TOKEN_PATH) {
			if (!state.token) {
				res.writeHead(404);
				return res.end();
			}
			res.writeHead(200, {"Content-Type": MIME[state.token.ext], "Cache-Control": "no-store"});
			return res.end(state.token.data);
		}
		const [root, rel] = url.startsWith("/img/") ? [roots.img, url.slice(5)] : [roots.src, url];
		const file = path.join(root, rel);
		if (!inside(root, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, {"Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream"});
		fs.createReadStream(file).pipe(res);
	});
	return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/**
 * Opens the mirror of one edition, runs fn(session) and closes everything afterwards.
 * @template T
 * @param {string} edition
 * @param {(session: MirrorSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withMirror (edition, fn) {
	const roots = mirrorOf(edition);
	for (const p of [roots.src, roots.img]) if (!fs.existsSync(p)) throw new Error(`Mirror folder missing: ${p}`);

	const state = {token: null};
	const server = await startServer({src: path.resolve(roots.src), img: path.resolve(roots.img)}, state);
	const context = await (await getBrowser()).newContext({deviceScaleFactor: SCALE, locale: "en-US"});
	try {
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", e => errors.push(String(e)));
		await page.goto(`http://127.0.0.1:${server.address().port}${PAGE_PATH}`);
		try {
			await page.waitForFunction(() => window.TG_READY && window.Renderer && window.Parser && window.DataLoader, null, {timeout: 30000});
		} catch (e) {
			throw new Error(`Mirror page did not load: ${errors.join("; ") || e.message}`);
		}
		return await fn(new MirrorSession(page, state, roots));
	} finally {
		await context.close();
		server.close();
		server.closeAllConnections();
	}
}

export class MirrorSession {
	#page;
	#state;
	#roots;
	#version = 0;

	constructor (page, state, roots) {
		this.#page = page;
		this.#state = state;
		this.#roots = roots;
	}

	/** Resolved monster (copies applied, legendary group embedded as _legendaryGroup) or null. */
	monster (name, source) {
		return this.#page.evaluate(([n, s]) => window.TG.monster(n, s), [name, source]);
	}

	/** "the dragon", "Philia": how the mirror refers to the creature in generated text. */
	shortName (mon) {
		return this.#page.evaluate(m => window.TG.shortName(m), mon);
	}

	/**
	 * Renders the statblock with the token image top right.
	 * @param {object} mon - monster in the mirror's format
	 * @param {{data: Uint8Array, ext: string}} token
	 * @returns {Promise<{png: Buffer, columns: number}>}
	 */
	async statblock (mon, token) {
		this.#state.token = token;
		const tokenVersion = ++this.#version;
		const draw = columns => this.#page.evaluate(
			([m, opts]) => window.TG.render(m, opts),
			[mon, {width: COLUMN_WIDTH, columns, tokenVersion}],
		);
		let columns = 1;
		const single = await draw(1);
		if (single.height > MAX_SINGLE_COLUMN_HEIGHT) {
			columns = 2;
			await draw(2);
		}
		await this.#page.waitForFunction(() => [...document.images].every(img => img.complete), null, {timeout: 10000});
		await this.#page.evaluate(() => document.fonts.ready);
		const png = await this.#page.locator("#sheet").screenshot({type: "png"});
		return {png, columns};
	}

	/** Lair actions, regional effects and mythic encounter as text, or null. */
	lair (mon) {
		return this.#page.evaluate(m => window.TG.lairText(m), mon);
	}

	/**
	 * Spells referenced by the monster's spellcasting, sorted by level: [{name, level, summary, full}].
	 * A spell without source is looked up in the edition's spellSource (config.local.json).
	 */
	spells (mon) {
		return this.#page.evaluate(([m, s]) => window.TG.spells(m, s), [mon, this.#roots.spellSource ?? ""]);
	}

	/** ["Spellcasting, DC 17, +9 to hit", ...] */
	spellcastingStats (mon) {
		return this.#page.evaluate(m => window.TG.spellcastingStats(m), mon);
	}
}
