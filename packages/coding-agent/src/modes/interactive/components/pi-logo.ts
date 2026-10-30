import {
	backgroundAnsi,
	foregroundAnsi,
	isAppleTerminalSession,
	type RgbColorValue,
	rgbColor,
	type TerminalColorMode,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const RESET = "\x1b[0m";

// Silver body, neon circuit core. The brand colors stay fixed across themes and
// follow the terminal's color mode.
const SILVER_LIGHT = rgbColor(232, 238, 243);
const SILVER = rgbColor(156, 170, 180);
const SILVER_DARK = rgbColor(82, 98, 109);
const NEON = rgbColor(0, 246, 196);
const NEON_DIM = rgbColor(0, 188, 150);
const NEON_CORE = rgbColor(200, 255, 242);
const NEON_CORE_DIM = rgbColor(128, 240, 214);

type LogoPixel = RgbColorValue | undefined;

// 8 columns by 4 pixel rows. Rows 0-1 and 2-3 become the two text lines; each
// cell holds two vertical pixels via a half block plus foreground/background
// colors. Four silver lobes meet at a crossed neon core.
const LOGO_PIXELS: LogoPixel[][] = [
	[SILVER_LIGHT, SILVER_LIGHT, undefined, undefined, undefined, undefined, SILVER_LIGHT, SILVER_LIGHT],
	[undefined, SILVER, NEON, NEON_CORE, NEON_CORE, NEON, SILVER, undefined],
	[undefined, SILVER_DARK, NEON_DIM, NEON_CORE_DIM, NEON_CORE_DIM, NEON_DIM, SILVER_DARK, undefined],
	[SILVER_DARK, SILVER_DARK, undefined, undefined, undefined, undefined, SILVER_DARK, SILVER_DARK],
];

function renderCell(top: LogoPixel, bottom: LogoPixel, mode: TerminalColorMode): string {
	if (!top) {
		return bottom ? `${foregroundAnsi(bottom, mode)}▄${RESET}` : " ";
	}
	if (!bottom) return `${foregroundAnsi(top, mode)}▀${RESET}`;
	return `${foregroundAnsi(top, mode)}${backgroundAnsi(bottom, mode)}▀${RESET}`;
}

function renderLine(topRow: LogoPixel[], bottomRow: LogoPixel[], mode: TerminalColorMode): string {
	return topRow.map((top, column) => renderCell(top, bottomRow[column], mode)).join("");
}

/**
 * The pi logo: an 8-cell-wide, 2-line emblem with four silver lobes around a
 * neon circuit core.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	return [renderLine(LOGO_PIXELS[0], LOGO_PIXELS[1], mode), renderLine(LOGO_PIXELS[2], LOGO_PIXELS[3], mode)];
}

/**
 * Whether the terminal renders the half-block logo correctly. Apple Terminal draws gaps between rows and
 * misaligns the half blocks, so it gets the text wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: "Pi" in the emblem's silver and neon. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(SILVER_LIGHT, mode)}P${RESET}${foregroundAnsi(NEON, mode)}i${RESET}`;
}
