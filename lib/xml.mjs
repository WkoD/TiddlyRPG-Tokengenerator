// Minimal XML text escaping, enough for the XStream files MapTool writes.

export const escapeXml = s => String(s)
	.replace(/&/g, "&amp;")
	.replace(/</g, "&lt;")
	.replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;")
	.replace(/'/g, "&apos;");

const NAMED = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'"};

export const unescapeXml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
	if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
	return NAMED[e] ?? m;
});
