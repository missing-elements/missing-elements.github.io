import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPackage } from "@missing-elements/h5p-author";

// What a build saves a chat, for the build page's cost section: measured here, at the site's
// build, on the page's own sample (src/h5p/build/sample.json) with the pinned author package, so
// the figures are those of the build the page runs and of the sample it plays.
//
// A chat asked plainly for an H5P activity has to write the two files that are its content,
// content.json and h5p.json. With the h5p-author skill it writes the source, and the build writes
// those two from it. Both are counted as JSON on one line, with no layout, and in tokens at four
// characters a token, the rule design/author.md of h5p-offline-player measures by. Tokens are a
// model's own, so they are said as "about", to the nearest ten.
const source = JSON.parse(await readFile("src/h5p/build/sample.json", "utf8"));
const work = await mkdtemp(join(tmpdir(), "h5p-build-cost-"));
let built;
try {
  built = await buildPackage(source, join(work, "sample.h5p"));
} finally {
  await rm(work, { recursive: true, force: true });
}

const number = new Intl.NumberFormat("en-GB");
const counted = (characters) => {
  const tokens = Math.round(characters / 4 / 10) * 10;
  return { characters, tokens, charactersText: number.format(characters), tokensText: number.format(tokens) };
};
const written = counted(JSON.stringify(source).length);
const file = counted(JSON.stringify(built.content).length + JSON.stringify(built.manifest).length);

export default {
  // The source, which the chat writes with the skill.
  written,
  // content.json and h5p.json, which the build writes from it, and a chat asked plainly writes itself.
  file,
  // What the build wrote for the chat: the tokens, and their share of the file's.
  saved: {
    tokensText: number.format(file.tokens - written.tokens),
    share: Math.round((1 - written.tokens / file.tokens) * 100),
  },
};
