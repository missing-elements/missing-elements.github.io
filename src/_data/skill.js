import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { contentTypes, openPack } from "@missing-elements/h5p-author";

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

// The rows of SKILL.md's table of the content types it offers the user to choose from (its step 1):
// a type, and what it is for, with the media it plays in brackets where it needs the user's.
const rows = [...readFileSync(`${author}/SKILL.md`, "utf8").matchAll(/^\| (H5P\.\w+) \| (.+?) \|$/gm)];
if (!rows.length) throw new Error(`@missing-elements/h5p-author ${version}: SKILL.md has no table of content types`);
const sentence = (text) => text[0].toUpperCase() + text.slice(1);

// What a build where npm cannot be reached fetches (SKILL.md's step 3), which vite.config.ts
// writes to /h5p/bundles/ after this page: the command line, and a bundle per content type, named
// by the author package's own list of them, the one its `writeBundles` writes from.
const pack = await openPack();
let bundles, titles;
try {
  const parts = await contentTypes(pack);
  bundles = parts.map((part) => `${part.library.machineName}.zip`);
  // The name H5P's editor gives each type, such as "Fill in the Blanks" for H5P.Blanks.
  titles = new Map(parts.map(({ library }) => [library.machineName, library.title]));
} finally {
  await pack.close();
}

// The types the skill offers, which the build page counts and the guide lists: each by its name in
// the pack, what it is for, and the media the user gives it, where it needs any ("pictures").
const offered = rows.map(([, type, text]) => {
  const [, use, media] = text.match(/^(.+?)(?: \((?:needs )?(.+)\))?$/);
  return { type, title: titles.get(type) ?? type, use: sentence(use), media };
});

export default {
  version,
  // What SKILL.md names and the type files, apart, as the page lists them; `files` is every one.
  named: [...references.filter((path) => !types.includes(path)), "LICENSE"],
  types,
  offered,
  files:["SKILL.md", ...references.filter((path) => !types.includes(path)), "LICENSE", ...types],
  // In /h5p/bundles/, the tool first.
  bundles: ["h5p-author.mjs", ...bundles],
};
