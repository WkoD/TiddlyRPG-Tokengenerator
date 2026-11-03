// Image from the Windows clipboard, saved as PNG (Windows PowerShell, Get-Clipboard).

import {spawnSync} from "node:child_process";

const SCRIPT = `
$img = Get-Clipboard -Format Image
if (-not $img) { exit 3 }
$img.Save($env:TOKENGEN_CLIPBOARD_FILE, [System.Drawing.Imaging.ImageFormat]::Png)
`;

export function saveClipboardImage (file) {
	const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
		env: {...process.env, TOKENGEN_CLIPBOARD_FILE: file},
		encoding: "utf-8",
	});
	if (r.status === 3) throw new Error("The clipboard holds no image.");
	if (r.status !== 0) throw new Error(`Reading the clipboard failed: ${(r.stderr || r.error?.message || "").trim()}`);
}
