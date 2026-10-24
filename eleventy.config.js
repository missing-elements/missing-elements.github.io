import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import attributes from "./src/_data/pdfjsAttributes.js";

const slugify = (text) =>
  text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const escapeHtml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight, { preAttributes: { tabindex: 0 } });

  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/pdfjs-viewer/samples");
  eleventyConfig.addPassthroughCopy("src/pdfjs-viewer/docs.js");
  // The docs run the exact package version they describe, served from this site.
  eleventyConfig.addPassthroughCopy({ "node_modules/@missing-elements/pdfjs-viewer/dist": "pdfjs-viewer/vendor" });

  let markdown;
  eleventyConfig.amendLibrary("md", (md) => {
    markdown = md;

    // Heading ids, so the table of contents and deep links work.
    md.core.ruler.push("heading_ids", (state) => {
      state.tokens.forEach((token, i) => {
        if (token.type === "heading_open" && !token.attrGet("id")) {
          token.attrSet("id", slugify(state.tokens[i + 1].content));
        }
      });
    });

    // A fence flagged with `try` (```html try, ```js try, ```js try=fresh) gets a Try button
    // in the browser that applies the snippet to the preview viewer.
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const html = fence(tokens, idx, options, env, self);
      const flag = tokens[idx].info.split(/\s+/).slice(1).find((word) => word.startsWith("try"));
      if (!flag) return html;
      const mode = flag === "try=fresh" ? "fresh" : "apply";
      return `<div class="example" data-try="${mode}">${html}</div>\n`;
    };
  });

  // h2/h3 headings of the rendered page, for the sidebar table of contents.
  eleventyConfig.addFilter("toc", (content) =>
    [...content.matchAll(/<h([23]) id="([^"]+)">(.*?)<\/h\1>/g)].map(([, level, id, text]) => ({
      level: Number(level),
      id,
      text: text.replace(/<[^>]+>/g, ""),
    }))
  );

  const inline = (text) => markdown.renderInline(text);

  eleventyConfig.addShortcode("attributeTable", (group) => {
    const rows = attributes
      .filter((attr) => attr.group === group)
      .map(
        (attr) => `<tr id="attr-${attr.name}">
<th scope="row"><a href="#attr-${attr.name}"><code>${attr.name}</code></a></th>
<td>${inline(attr.description)}</td>
<td class="default">${attr.default ? inline(attr.default) : `<span class="muted" aria-label="none">—</span>`}</td>
<td><span class="update update-${attr.update}">${{ live: "Live", load: "Next load", init: "Before connect" }[attr.update]}</span></td>
</tr>`
      )
      .join("");
    return `<div class="table-wrap"><table class="attributes"><thead><tr><th scope="col">Attribute</th><th scope="col">Description</th><th scope="col">Default</th><th scope="col">Updates</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  });

  eleventyConfig.addShortcode("playground", () => {
    const controls = attributes
      .filter((attr) => attr.playground)
      .map(({ name, playground: control }) => {
        const id = `pg-${name}`;
        let field;
        if (control.type === "select") {
          const options = control.options
            .map((option) => {
              const [value, label] = Array.isArray(option) ? option : [option, option || "(unset)"];
              return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
            })
            .join("");
          field = `<select id="${id}" data-attr="${name}">${options}</select>`;
        } else if (control.type === "checkbox") {
          field = `<input id="${id}" type="checkbox" data-attr="${name}" value="true">`;
        } else {
          field = `<input id="${id}" type="${control.type}" data-attr="${name}"${control.min ? ` min="${control.min}"` : ""} placeholder="${escapeHtml(control.placeholder ?? "")}" autocomplete="off">`;
        }
        return `<div class="control"><label for="${id}"><code>${name}</code></label>${field}</div>`;
      })
      .join("");
    return `<form class="playground" data-playground aria-label="Attribute playground">${controls}<p class="playground-hint">Changes apply to the preview as you edit them.</p></form>`;
  });

  return {
    dir: { input: "src", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
