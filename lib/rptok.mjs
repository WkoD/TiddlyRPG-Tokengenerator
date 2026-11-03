// MapTool token files (.rptok): a ZIP with content.xml (XStream-serialised Token), properties.xml,
// two thumbnails and one asset pair per image. This module only packs and unpacks; it never
// decodes or renders images.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {strFromU8, strToU8, unzipSync, zipSync} from "fflate";
import {ROOT} from "./config.mjs";
import {escapeXml, unescapeXml} from "./xml.mjs";

/** Path of the generator's own data inside the ZIP; MapTool does not know it. */
export const EMBEDDED_PATH = "tokengen/token.json";
export const EMBEDDED_FORMAT = 1;

/** Footprints of MapTool's square grid, from net/rptools/maptool/model/squareGridFootprints.xml in MapTool.jar. */
export const SQUARE_FOOTPRINTS = {
	T: "fwABAc5lFSoDAAAAKgABAA==",
	S: "fwABAc5lFSoEAAAAKgABAA==",
	M: "fwABAc9lFSoFAAAAKgABAQ==",
	L: "fwABAdBlFSoGAAAAKgABAA==",
	H: "fwABAdBlFSoHAAAAKgABAA==",
	G: "fwABAdFlFSoIAAAAKgABAQ==",
};

/** The three images of a token: where content.xml points to them and how their asset is labelled. */
export const IMAGE_ROLES = [
	{key: "token", label: "Token", placeholder: "TOKEN_IMAGE", xml: /<imageAssetMap>[\s\S]*?<id>(\w+)<\/id>/},
	{key: "portrait", label: "Portrait", placeholder: "PORTRAIT_IMAGE", xml: /<portraitImage>\s*<id>(\w+)<\/id>/},
	{key: "statblock", label: "Statblock", placeholder: "STATBLOCK_IMAGE", xml: /<charsheetImage>\s*<id>(\w+)<\/id>/},
];

const TEMPLATE = fs.readFileSync(path.join(ROOT, "templates/content.xml"), "utf-8").replace(/\r\n/g, "\n");

const md5 = data => crypto.createHash("md5").update(data).digest("hex");
const newGuid = () => crypto.randomBytes(16).toString("base64");

/** MapTool extension for an image file name; MapTool itself writes "jpeg" for JPEG files. */
export function imageExtension (fileName) {
	const ext = path.extname(fileName).slice(1).toLowerCase();
	if (ext === "jpg" || ext === "jpeg") return "jpeg";
	if (ext === "png" || ext === "webp") return ext;
	throw new Error(`Unsupported image type: ${fileName}`);
}

const assetXml = (id, name, ext) => `<net.rptools.maptool.model.Asset>
  <id>
    <id>${id}</id>
  </id>
  <name>${escapeXml(name)}</name>
  <extension>${ext}</extension>
  <type>IMAGE</type>
</net.rptools.maptool.model.Asset>`;

const propertiesXml = version => `<map>
  <entry>
    <string>version</string>
    <string>${escapeXml(version)}</string>
  </entry>
  <entry>
    <string>herolab</string>
    <boolean>false</boolean>
  </entry>
</map>`;

const fillTemplate = values => TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, key) => {
	if (!(key in values)) throw new Error(`Template placeholder without value: ${key}`);
	return values[key];
});

/**
 * Packs a token.
 * @param {object} t
 * @param {string} t.name - shown to everyone
 * @param {string} [t.gmName] - shown to the GM only; left out when empty
 * @param {string} t.size - T, S, M, L, H or G
 * @param {string} [t.gmNotes]
 * @param {{token, portrait, statblock}} t.images - each {data: Uint8Array, ext}
 * @param {{width: number, height: number}} t.tokenSize - pixel size of the token image
 * @param {{small: Uint8Array, large: Uint8Array}} t.thumbnails - PNG, 50 and 200 px
 * @param {object} [t.embedded] - generator data, stored under EMBEDDED_PATH
 * @param {string} t.maptoolVersion
 * @returns {Uint8Array} the .rptok file
 */
export function packRptok ({name, gmName, size, gmNotes, images, tokenSize, thumbnails, embedded, maptoolVersion}) {
	if (!name) throw new Error("Token needs a name");
	const footprint = SQUARE_FOOTPRINTS[size];
	if (!footprint) throw new Error(`Unknown size "${size}", expected one of ${Object.keys(SQUARE_FOOTPRINTS).join(", ")}`);

	const assets = {};
	const values = {
		TOKEN_GUID: newGuid(),
		EXPOSED_AREA_GUID: newGuid(),
		FOOTPRINT: footprint,
		WIDTH: String(tokenSize.width),
		HEIGHT: String(tokenSize.height),
		NAME: escapeXml(name),
		GM_NAME: gmName ? `  <gmName>${escapeXml(gmName)}</gmName>\n` : "",
		GM_NOTES: gmNotes ? `  <gmNotes>${escapeXml(gmNotes)}</gmNotes>\n` : "",
	};
	for (const role of IMAGE_ROLES) {
		const img = images[role.key];
		if (!img) throw new Error(`Missing ${role.key} image`);
		const id = md5(img.data);
		values[role.placeholder] = id;
		assets[`assets/${id}`] = strToU8(assetXml(id, `${gmName || name} ${role.label}`, img.ext));
		assets[`assets/${id}.${img.ext}`] = img.data;
	}

	const files = {
		"content.xml": strToU8(fillTemplate(values)),
		"properties.xml": strToU8(propertiesXml(maptoolVersion)),
		"thumbnail": thumbnails.small,
		"thumbnail_large": thumbnails.large,
		...assets,
	};
	if (embedded) files[EMBEDDED_PATH] = strToU8(JSON.stringify(embedded, null, "\t"));
	return zipSync(files, {level: 6});
}

/** Text of a direct child element of the token (XStream indents those by two spaces). */
const tokenField = (xml, tag) => {
	const m = xml.match(new RegExp(`\\n  <${tag}>([\\s\\S]*?)</${tag}>`));
	return m ? unescapeXml(m[1]) : null;
};

/**
 * Unpacks a token.
 * @param {Uint8Array} data - the .rptok file
 * @returns {{name, gmName, gmNotes, size, images: {token, portrait, statblock}, embedded}}
 *   images are {data, ext}, null where the token has none; embedded is null for foreign tokens
 */
export function readRptok (data) {
	const files = unzipSync(data);
	if (!files["content.xml"]) throw new Error("Not a MapTool token: content.xml missing");
	const xml = strFromU8(files["content.xml"]);
	if (!xml.startsWith("<net.rptools.maptool.model.Token>")) throw new Error("Not a MapTool token: unexpected content.xml");

	const asset = id => {
		const key = Object.keys(files).find(k => k.startsWith(`assets/${id}.`));
		if (key) return {data: files[key], ext: key.slice(key.lastIndexOf(".") + 1)};
		if (files[`assets/${id}`]) throw new Error(`Asset ${id} has no image file (older token format, not supported)`);
		throw new Error(`Asset ${id} missing`);
	};
	const images = {};
	for (const role of IMAGE_ROLES) {
		const id = xml.match(role.xml)?.[1];
		images[role.key] = id ? asset(id) : null;
	}

	const footprint = xml.match(/<sizeMap>[\s\S]*?<baGUID>([^<]+)<\/baGUID>/)?.[1];
	const size = Object.entries(SQUARE_FOOTPRINTS).find(([, guid]) => guid === footprint)?.[0] ?? null;
	const embedded = files[EMBEDDED_PATH] ? JSON.parse(strFromU8(files[EMBEDDED_PATH])) : null;
	if (embedded && embedded.format !== EMBEDDED_FORMAT) throw new Error(`Unknown ${EMBEDDED_PATH} format ${embedded.format}`);

	return {
		name: tokenField(xml, "name"),
		gmName: tokenField(xml, "gmName"),
		gmNotes: tokenField(xml, "gmNotes"),
		size,
		images,
		embedded,
	};
}
