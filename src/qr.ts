import { renderSVG } from "uqr";

/** Encode a URL (or other text) as a real scannable QR SVG. */
export function qrSvg(text: string): string {
	return renderSVG(text, { ecc: "M", border: 2 });
}
