import { readFileSync } from "node:fs";

const dist = "node_modules/@missing-elements/pdfjs-viewer";
const { version } = JSON.parse(readFileSync(`${dist}/package.json`, "utf8"));
const pdfjsVersion = readFileSync(`${dist}/dist/pdf.mjs`, "utf8").match(/apiVersion:"(\d+\.\d+\.\d+)"/)[1];

export default {
  version,
  major: version.split(".")[0],
  pdfjsVersion,
  repo: "https://github.com/missing-elements/pdfjs-viewer",
  npm: "https://www.npmjs.com/package/@missing-elements/pdfjs-viewer",
};
