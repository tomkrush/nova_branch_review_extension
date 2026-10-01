// Draws the icons as SVG and renders @1x/@2x PNGs with rsvg-convert.
// Run: node tools/icons.js   (needs `brew install librsvg`)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "Images");
const S = 'fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="#000"';

const glyphs = {
  check: `<path d="M3 8.5l3.2 3L13 4.5" ${S}/>`,
  commit: `<circle cx="8" cy="8" r="2.6" ${S}/><path d="M1.5 8h3.9M10.6 8h3.9" ${S}/>`,
  folder: `<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.5 1.5h5.5c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" ${S}/>`,
  info: `<circle cx="8" cy="8" r="6" ${S}/><path d="M8 7.2v4" ${S}/><circle cx="8" cy="4.8" r=".9" ${F}/>`,
  "hdr-refresh": `<path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5a5 5 0 0 0 9.4 1.5M3.3 2.5v2.8h2.8M12.7 13.5v-2.8H9.9" ${S}/>`,
  "hdr-next": `<path d="M3 8h9M8.5 4l4 4-4 4" ${S}/>`,
  "hdr-filter": `<path d="M2 3h12l-4.6 5.5V13l-2.8-1.4V8.5z" ${S}/>`,
  "hdr-eye": `<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" ${S}/><circle cx="8" cy="8" r="2" ${S}/>`,
  "hdr-tree": `<path d="M2.5 3h4M5 6h5M5 9.5h5M7.5 13h5M3.5 3v10h4M3.5 6h1.5M3.5 9.5h1.5" ${S}/>`,
  "hdr-branch": `<circle cx="4.5" cy="3.5" r="1.6" ${S}/><circle cx="4.5" cy="12.5" r="1.6" ${S}/><circle cx="11.5" cy="5" r="1.6" ${S}/><path d="M4.5 5.1v5.8M11.5 6.6c0 3-7 2.2-7 4.3" ${S}/>`,
  "hdr-base": `<circle cx="4.5" cy="3.5" r="1.6" ${F}/><circle cx="4.5" cy="12.5" r="1.6" ${S}/><circle cx="11.5" cy="5" r="1.6" ${S}/><path d="M4.5 5.1v5.8M11.5 6.6c0 3-7 2.2-7 4.3" ${S}/>`,
};

// Coloured change-type badges (not tinted by Nova).
const badge = (fill, letter) =>
  `<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="${fill}"/><text x="8" y="11.6" text-anchor="middle" font-family="SF Pro Text, Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="9.5" fill="#fff">${letter}</text>`;
const colored = {
  "st-added": badge("#22a55a", "A"),
  "st-modified": badge("#3b82f6", "M"),
  "st-deleted": badge("#e5484d", "D"),
  "st-renamed": badge("#8e4ec6", "R"),
  warning: `<path d="M8 1.8l6.6 11.7H1.4z" fill="#f5a524" stroke="#f5a524" stroke-width="1" stroke-linejoin="round"/><path d="M8 6v3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".95" fill="#fff"/>`,
};

const S24 = 'fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const sidebar = `<path d="M5 3.5h10l4 4v13H5z" ${S24}/><path d="M9 14l2.2 2.2L15.5 12" ${S24}/>`;

const svg = (body, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

function write(name, body, grid, sizes, template) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ template }));
  sizes.forEach((px, i) => execFileSync("rsvg-convert", ["-w", String(px), "-h", String(px), "-o", path.join(dir, `${name}${i ? "@2x" : ""}.png`)], { input: svg(body, grid) }));
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const [name, body] of Object.entries(glyphs)) write(name, body, 16, [16, 32], true);
for (const [name, body] of Object.entries(colored)) write(name, body, 16, [16, 32], false);
write("sidebar-small", sidebar, 24, [16, 32], true);
write("sidebar-large", sidebar, 24, [24, 48], true);

// Extension icon (Extension Library): tools/logo.svg.
const logo = fs.readFileSync(path.join(__dirname, "logo.svg"));
execFileSync("rsvg-convert", ["-w", "32", "-h", "32", "-o", path.join(__dirname, "..", "extension.png")], { input: logo });
execFileSync("rsvg-convert", ["-w", "64", "-h", "64", "-o", path.join(__dirname, "..", "extension@2x.png")], { input: logo });
console.log("wrote icons");
