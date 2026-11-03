// Interactive crop: a local page (lib/crop-ui/) in the default browser. Zoom and pan the portrait
// under the ring, pick the role, save. Saving writes token.json and renders token.png.

import {spawn} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {config, ROOT} from "./config.mjs";
import {MIME, TOKEN_RENDER_SCRIPT} from "./image.mjs";
import {imageExtension} from "./rptok.mjs";
import {backgroundOf, readWork, renderTokenImage, TOKEN_FILE, writeJson} from "./workdir.mjs";

const PAGE = path.join(ROOT, "lib/crop-ui/index.html");

const openInBrowser = url => spawn("cmd", ["/c", "start", "", url], {detached: true, stdio: "ignore"}).unref();

const readBody = req => new Promise((resolve, reject) => {
	let body = "";
	req.on("data", chunk => (body += chunk));
	req.on("end", () => resolve(body));
	req.on("error", reject);
});

const send = (res, status, type, body) => {
	res.writeHead(status, {"Content-Type": type, "Cache-Control": "no-store"});
	res.end(body);
};

const round = v => Math.round(v * 10) / 10;

function validCrop (crop) {
	return crop && ["x", "y", "diameter"].every(k => Number.isFinite(crop[k])) && crop.diameter > 0;
}

/**
 * Serves the crop page until the user saves or cancels.
 * @returns {Promise<{saved: boolean, crop?: object, role?: string}>}
 */
export function cropInteractive (dir, {open = true, onUrl = url => console.log(url)} = {}) {
	const {token} = readWork(dir);
	const portraitFile = path.join(dir, token.images.portrait);
	const portraitType = MIME[imageExtension(portraitFile)];

	return new Promise((resolve, reject) => {
		let finish;
		const server = http.createServer(async (req, res) => {
			try {
				if (req.method === "GET" && req.url === "/") return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(PAGE));
				if (req.method === "GET" && req.url === "/token-render.js") return send(res, 200, "text/javascript; charset=utf-8", fs.readFileSync(TOKEN_RENDER_SCRIPT));
				if (req.method === "GET" && req.url === "/favicon.ico") return send(res, 204, "image/x-icon", "");
				if (req.method === "GET" && req.url === "/portrait") return send(res, 200, portraitType, fs.readFileSync(portraitFile));
				if (req.method === "GET" && req.url === "/state") {
					const current = readWork(dir).token;
					return send(res, 200, "application/json", JSON.stringify({
						name: current.gmName || current.name,
						role: current.role,
						roles: Object.fromEntries(Object.entries(config.roles).map(([k, r]) => [k, {description: r.description, ring: r.ring}])),
						crop: current.crop ?? null,
						background: backgroundOf(current),
					}));
				}
				if (req.method === "POST" && req.url === "/save") {
					const {crop, role, background} = JSON.parse(await readBody(req));
					if (!validCrop(crop)) return send(res, 400, "text/plain", "invalid crop");
					if (!config.roles[role]) return send(res, 400, "text/plain", "unknown role");
					if (!/^#[0-9a-f]{6}$/i.test(background)) return send(res, 400, "text/plain", "invalid background");
					const current = readWork(dir).token;
					const rounded = {x: round(crop.x), y: round(crop.y), diameter: round(crop.diameter)};
					writeJson(path.join(dir, TOKEN_FILE), {...current, role, crop: rounded, background});
					const file = await renderTokenImage(dir);
					send(res, 200, "application/json", JSON.stringify({ok: true, file}));
					return finish({saved: true, crop: rounded, role, background});
				}
				if (req.method === "POST" && req.url === "/cancel") {
					send(res, 200, "application/json", JSON.stringify({ok: true}));
					return finish({saved: false});
				}
				send(res, 404, "text/plain", "not found");
			} catch (e) {
				send(res, 500, "text/plain", e.message);
				finish(null, e);
			}
		});
		finish = (result, error) => {
			server.close();
			server.closeAllConnections();
			if (error) reject(error);
			else resolve(result);
		};
		server.listen(0, "127.0.0.1", () => {
			const url = `http://127.0.0.1:${server.address().port}/`;
			onUrl(url);
			if (open) openInBrowser(url);
		});
	});
}
