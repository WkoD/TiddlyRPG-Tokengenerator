// Draws a token: a circular crop of the source image inside a metal ring. Plain browser script,
// loaded by the CLI into headless Chrome and served to the crop page, so the preview there is
// exactly what gets written.
//
// crop: {x, y, diameter} in source image pixels; (x, y) is the centre of the circle.
// ring: three colours [light, mid, dark] from config.roles.<role>.ring.
// background: colour behind the picture, seen through transparent images and outside the image.

(function (global) {
	const RING_WIDTH = 0.075; // relative to the token size

	/** Start crop: the largest centred square; for upright images the top square (heads sit there). */
	function defaultCrop (width, height) {
		const diameter = Math.min(width, height);
		return {x: width / 2, y: height > width ? diameter / 2 : height / 2, diameter};
	}

	function circle (ctx, c, r) {
		ctx.beginPath();
		ctx.arc(c, c, r, 0, Math.PI * 2);
	}

	function drawPicture (ctx, c, r, image, crop, background) {
		ctx.save();
		circle(ctx, c, r);
		ctx.clip();
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, c * 2, c * 2);
		const scale = (2 * r) / crop.diameter;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.translate(c, c);
		ctx.scale(scale, scale);
		ctx.drawImage(image, -crop.x, -crop.y);
		ctx.restore();

		// Inner shadow, so the picture sits below the ring
		ctx.save();
		circle(ctx, c, r);
		const shadow = ctx.createRadialGradient(c, c, r * 0.8, c, c, r);
		shadow.addColorStop(0, "rgba(0,0,0,0)");
		shadow.addColorStop(1, "rgba(0,0,0,0.45)");
		ctx.fillStyle = shadow;
		ctx.fill();
		ctx.restore();
	}

	/** Deterministic pseudo random numbers (mulberry32), so every render looks the same. */
	function random (seed) {
		return () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** Grey noise of cells × cells, drawn smoothly scaled: mottled cast metal. */
	function noiseCanvas (cells, seed) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = cells;
		const ctx = canvas.getContext("2d");
		const data = ctx.createImageData(cells, cells);
		const rnd = random(seed);
		for (let i = 0; i < data.data.length; i += 4) {
			const v = 70 + rnd() * 116;
			data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
			data.data[i + 3] = 255;
		}
		ctx.putImageData(data, 0, 0);
		return canvas;
	}

	/**
	 * Cast metal ring with a ridge along its middle: two sloped faces in light from the top left.
	 * The outer face is bright at the top left, the inner face (sloping towards the picture) at
	 * the bottom right; where they meet, the ridge catches a thin highlight.
	 */
	function drawRing (ctx, c, inner, outer, [light, mid, dark]) {
		const ridge = inner + (outer - inner) * 0.5;
		const width = outer - inner;
		const band = (r1, r2) => {
			ctx.beginPath();
			ctx.arc(c, c, r2, 0, Math.PI * 2);
			ctx.arc(c, c, r1, 0, Math.PI * 2, true);
			ctx.closePath();
		};
		const diagonal = (from, to) => {
			const d = outer * 0.75;
			const g = ctx.createLinearGradient(c - d, c - d, c + d, c + d);
			g.addColorStop(0, from);
			g.addColorStop(0.5, mid);
			g.addColorStop(1, to);
			return g;
		};
		const fill = (r1, r2, style) => {
			band(r1, r2);
			ctx.fillStyle = style;
			ctx.fill();
		};

		// The two faces
		fill(ridge, outer, diagonal(light, dark));
		fill(inner, ridge, diagonal(dark, light));

		// Curvature: each face darkens towards its edge, away from the ridge
		const towardsOuter = ctx.createRadialGradient(c, c, ridge, c, c, outer);
		towardsOuter.addColorStop(0, "rgba(0,0,0,0)");
		towardsOuter.addColorStop(1, "rgba(0,0,0,0.35)");
		fill(ridge, outer, towardsOuter);
		const towardsInner = ctx.createRadialGradient(c, c, inner, c, c, ridge);
		towardsInner.addColorStop(0, "rgba(0,0,0,0.4)");
		towardsInner.addColorStop(1, "rgba(0,0,0,0)");
		fill(inner, ridge, towardsInner);

		// Cast texture: coarse and fine noise, blended into the colour
		ctx.save();
		band(inner, outer);
		ctx.clip();
		ctx.globalCompositeOperation = "overlay";
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.globalAlpha = 0.35;
		ctx.drawImage(noiseCanvas(40, 7), 0, 0, c * 2, c * 2);
		ctx.globalAlpha = 0.18;
		ctx.drawImage(noiseCanvas(160, 11), 0, 0, c * 2, c * 2);
		ctx.restore();

		// Ridge highlight, strongest where the light falls
		const glint = ctx.createLinearGradient(c - outer, c - outer, c + outer, c + outer);
		glint.addColorStop(0, "rgba(255,255,255,0.45)");
		glint.addColorStop(0.5, "rgba(255,255,255,0.08)");
		glint.addColorStop(1, "rgba(255,255,255,0.3)");
		ctx.lineWidth = Math.max(1, width * 0.07);
		ctx.strokeStyle = glint;
		circle(ctx, c, ridge);
		ctx.stroke();

		// Dark edges
		ctx.lineWidth = Math.max(1, c * 0.01);
		ctx.strokeStyle = "rgba(0,0,0,0.7)";
		circle(ctx, c, outer - ctx.lineWidth / 2);
		ctx.stroke();
		circle(ctx, c, inner);
		ctx.stroke();
	}

	/** Draws the token into a size × size area of ctx (transparent outside the ring). */
	function drawToken (ctx, size, image, crop, ring, background) {
		const c = size / 2;
		const outer = c;
		const inner = outer - size * RING_WIDTH;
		ctx.clearRect(0, 0, size, size);
		drawPicture(ctx, c, inner + 1, image, crop, background);
		drawRing(ctx, c, inner, outer, ring);
	}

	global.TokenRender = {defaultCrop, drawToken, RING_WIDTH};
})(globalThis);
