// Needs the browser from config.browser.channel.
import assert from "node:assert/strict";
import {after, test} from "node:test";
import {closeBrowser, renderToken, thumbnails, TOKEN_SIZE} from "../lib/image.mjs";

// 4 × 2 px red PNG
const PNG = {
	data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHx0zUF8QAKIzO9XfYa3oAAAAAElFTkSuQmCC", "base64"),
	ext: "png",
};
const RING = ["#ffffff", "#888888", "#222222"];

after(closeBrowser);

test("token image is a square PNG of TOKEN_SIZE", async () => {
	const {png, crop} = await renderToken(PNG, null, RING, "#c9bfa5");
	const info = await thumbnails({data: png, ext: "png"});
	assert.equal(info.width, TOKEN_SIZE);
	assert.equal(info.height, TOKEN_SIZE);
	assert.deepEqual(crop, {x: 2, y: 1, diameter: 2}, "default crop: centred square of a wide image");
});

test("given crop is used as it is", async () => {
	const {crop} = await renderToken(PNG, {x: 1, y: 1, diameter: 3}, RING, "#000000");
	assert.deepEqual(crop, {x: 1, y: 1, diameter: 3});
});

test("thumbnails are 50 and 200 px", async () => {
	const t = await thumbnails(PNG);
	assert.equal((await thumbnails({data: t.small, ext: "png"})).width, 50);
	assert.equal((await thumbnails({data: t.large, ext: "png"})).width, 200);
	assert.equal(t.width, 4);
	assert.equal(t.height, 2);
});
