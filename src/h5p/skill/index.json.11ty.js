// /h5p/skill/index.json: the author package's version and every file of the skill served here
// (src/_data/skill.js), for a script.
export const data = { permalink: "/h5p/skill/index.json", eleventyExcludeFromCollections: true };

export const render = ({ skill }) => `${JSON.stringify({ author: skill.version, files: skill.files }, null, 2)}\n`;
