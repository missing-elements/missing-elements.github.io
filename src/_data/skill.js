import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// The h5p-author skill as the pinned @missing-elements/h5p-author carries it since 0.9.0: its
// SKILL.md, licence and references/, which eleventy.config.js copies to /h5p/skill/ as they are.
// src/h5p/skill/ lists them, each at its full address.
const author = "node_modules/@missing-elements/h5p-author";
const { version } = JSON.parse(readFileSync(`${author}/package.json`, "utf8"));
if (!existsSync(`${author}/SKILL.md`)) throw new Error(`@missing-elements/h5p-author ${version} carries no SKILL.md: 0.9.0 is the first that does`);

const references = readdirSync(`${author}/references`, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(author, join(entry.parentPath, entry.name)).split(sep).join("/"))
  .sort();
const types = references.filter((path) => path.startsWith("references/types/"));

export default {
  version,
  // What SKILL.md names and the type files, apart, as the page lists them; `files` is every one.
  named: [...references.filter((path) => !types.includes(path)), "LICENSE"],
  types,
  files: ["SKILL.md", ...references.filter((path) => !types.includes(path)), "LICENSE", ...types],
};
