import assert from "node:assert/strict";
import crypto from "node:crypto";
import {test} from "node:test";
import {strFromU8, unzipSync} from "fflate";
import {EMBEDDED_PATH, packRptok, readRptok, SQUARE_FOOTPRINTS} from "../lib/rptok.mjs";

// packRptok never decodes images, so any bytes do.
const bytes = s => new TextEncoder().encode(s);
const sample = (overrides = {}) => ({
	name: "Unbekannte Frau <verhüllt> & still",
	gmName: "Philia",
	size: "L",
	gmNotes: "Philia\nBased on: Medusa (SRC, 2014)",
	images: {
		token: {data: bytes("token"), ext: "png"},
		portrait: {data: bytes("portrait"), ext: "jpeg"},
		statblock: {data: bytes("statblock"), ext: "png"},
	},
	tokenSize: {width: 512, height: 512},
	thumbnails: {small: bytes("small"), large: bytes("large")},
	embedded: {format: 1, token: {name: "x"}, statblock: null},
	maptoolVersion: "1.11.5",
	...overrides,
});
const md5 = s => crypto.createHash("md5").update(s).digest("hex");

test("assets are named by the MD5 of their data and referenced from content.xml", () => {
	const files = unzipSync(packRptok(sample()));
	const xml = strFromU8(files["content.xml"]);
	for (const [name, ext] of [["token", "png"], ["portrait", "jpeg"], ["statblock", "png"]]) {
		const id = md5(name);
		assert.equal(strFromU8(files[`assets/${id}.${ext}`]), name);
		assert.match(strFromU8(files[`assets/${id}`]), new RegExp(`<extension>${ext}</extension>`));
		assert.ok(xml.includes(`<id>${id}</id>`), `${name} referenced`);
	}
	assert.ok(!/\{\{/.test(xml), "no placeholder left");
	assert.ok(files.thumbnail && files.thumbnail_large && files["properties.xml"]);
});

test("round trip keeps names, notes, size, images and embedded data", () => {
	const t = readRptok(packRptok(sample()));
	assert.equal(t.name, "Unbekannte Frau <verhüllt> & still");
	assert.equal(t.gmName, "Philia");
	assert.equal(t.gmNotes, "Philia\nBased on: Medusa (SRC, 2014)");
	assert.equal(t.size, "L");
	assert.equal(strFromU8(t.images.portrait.data), "portrait");
	assert.equal(t.images.portrait.ext, "jpeg");
	assert.deepEqual(t.embedded, {format: 1, token: {name: "x"}, statblock: null});
});

test("every size maps to its footprint", () => {
	for (const [size, guid] of Object.entries(SQUARE_FOOTPRINTS)) {
		const xml = strFromU8(unzipSync(packRptok(sample({size})))["content.xml"]);
		assert.ok(xml.includes(`<baGUID>${guid}</baGUID>`), size);
		assert.equal(readRptok(packRptok(sample({size}))).size, size);
	}
	assert.throws(() => packRptok(sample({size: "X"})), /Unknown size/);
});

test("gmName, gmNotes and embedded data are optional", () => {
	const data = packRptok(sample({gmName: undefined, gmNotes: undefined, embedded: undefined}));
	const files = unzipSync(data);
	const xml = strFromU8(files["content.xml"]);
	assert.ok(!xml.includes("<gmName>") && !xml.includes("<gmNotes>"));
	assert.equal(files[EMBEDDED_PATH], undefined);
	const t = readRptok(data);
	assert.equal(t.gmName, null);
	assert.equal(t.embedded, null);
});

test("each token gets new GUIDs", () => {
	const guid = data => strFromU8(unzipSync(data)["content.xml"]).match(/<baGUID>([^<]+)<\/baGUID>/)[1];
	assert.notEqual(guid(packRptok(sample())), guid(packRptok(sample())));
});
