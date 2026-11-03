// Image work in the installed browser (Playwright with config.browser.channel): it decodes PNG,
// JPEG and WebP and scales with good quality, so no native image library is needed.

import fs from "node:fs";
import path from "node:path";
import {chromium} from "playwright-core";
import {config, ROOT} from "./config.mjs";

export const MIME = {png: "image/png", jpeg: "image/jpeg", webp: "image/webp"};
export const TOKEN_RENDER_SCRIPT = path.join(ROOT, "lib/token-render.js");
export const TOKEN_SIZE = 512;

let browserPromise = null;

export const getBrowser = () => (browserPromise ??= chromium.launch({channel: config.browser.channel}));

export async function closeBrowser () {
	if (!browserPromise) return;
	const browser = await browserPromise;
	browserPromise = null;
	await browser.close();
}

const toDataUrl = img => `data:${MIME[img.ext]};base64,${Buffer.from(img.data).toString("base64")}`;
const fromDataUrl = url => new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));

/** Runs fn(page) on a fresh page and closes it afterwards. */
async function withPage (fn) {
	const page = await (await getBrowser()).newPage();
	try {
		return await fn(page);
	} finally {
		await page.close();
	}
}

/**
 * Renders the round token image (PNG, TOKEN_SIZE square) with lib/token-render.js.
 * @param {{data: Uint8Array, ext: string}} img - source picture
 * @param {{x: number, y: number, diameter: number} | null} crop - null: TokenRender.defaultCrop
 * @param {string[]} ring - [light, mid, dark]
 * @param {string} background - CSS colour behind the picture
 */
export const renderToken = (img, crop, ring, background) => withPage(async page => {
	await page.addScriptTag({content: fs.readFileSync(TOKEN_RENDER_SCRIPT, "utf-8")});
	const out = await page.evaluate(async ({src, crop, ring, background, size}) => {
		const image = new Image();
		image.src = src;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = size;
		const used = crop ?? TokenRender.defaultCrop(image.naturalWidth, image.naturalHeight);
		TokenRender.drawToken(canvas.getContext("2d"), size, image, used, ring, background);
		return {png: canvas.toDataURL("image/png"), crop: used};
	}, {src: toDataUrl(img), crop, ring, background, size: TOKEN_SIZE});
	return {png: fromDataUrl(out.png), crop: out.crop};
});

/**
 * Thumbnails for the token file (PNG, 50 and 200 px squares) and the pixel size of the image.
 * @param {{data: Uint8Array, ext: string}} img
 */
export const thumbnails = img => withPage(async page => {
	const out = await page.evaluate(async ({src, sizes}) => {
		const image = new Image();
		image.src = src;
		await image.decode();
		const scaled = sizes.map(size => {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			const ctx = canvas.getContext("2d");
			ctx.imageSmoothingQuality = "high";
			const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
			const w = image.naturalWidth * scale;
			const h = image.naturalHeight * scale;
			ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
			return canvas.toDataURL("image/png");
		});
		return {scaled, width: image.naturalWidth, height: image.naturalHeight};
	}, {src: toDataUrl(img), sizes: [50, 200]});
	return {small: fromDataUrl(out.scaled[0]), large: fromDataUrl(out.scaled[1]), width: out.width, height: out.height};
});
