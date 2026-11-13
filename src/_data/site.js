// The address the project answers at: the one h5p-offline-player's code of conduct and security
// policy give, and the organization's on GitHub.
const contact = "alekswebnet@gmail.com";

// Where to say how the H5P build page and the h5p-author skill went, in two ways that start from
// the same title and two questions. An email asks for no account, and a teacher may have none on
// GitHub. A new discussion in h5p-offline-player, where the author is made, is public, for someone
// who has one. A mail body's lines end in CRLF (RFC 6068).
const feedbackTitle = "Feedback on the H5P build page";
const feedbackBody = "What I made (the content type, and the chat that wrote the source):\n\n\nWhat went well, or wrong:\n\n";
const buildFeedback = {
  email:
    `mailto:${contact}?subject=${encodeURIComponent(feedbackTitle)}` +
    `&body=${encodeURIComponent(feedbackBody.replaceAll("\n", "\r\n"))}`,
  github:
    "https://github.com/missing-elements/h5p-offline-player/discussions/new?category=general" +
    `&title=${encodeURIComponent(feedbackTitle)}&body=${encodeURIComponent(feedbackBody)}`,
};

export default {
  name: "Missing Elements",
  // What the organization makes, in a line: under the name in the top bar.
  tagline: "Browser-based OSS and tools",
  url: "https://missing-elements.github.io",
  github: "https://github.com/missing-elements",
  // Where to give to the project's development: the home page's hero button, and the footer.
  support: "https://donatello.to/OleksandrShevchuk",
  // Google Search Console's code for the site, from the "HTML tag" check of its URL-prefix property,
  // https://missing-elements.github.io/: base.njk writes it on every page while it is set.
  googleSiteVerification: "_z8PPC9AkWc2rKheTsM0kGmM6UA6FLfgMf0aRxDzULU",
  // The web components, on the home page with their element's tag, and in its footer by their npm
  // package and their issues. `docs` is where each is shown working, named by `docsText`.
  elements: [
    {
      name: "pdfjs-viewer",
      tag: "pdfjs-viewer-element",
      package: "@missing-elements/pdfjs-viewer",
      description: "Views and edits PDF files in Firefox's PDF.js viewer, in an isolated iframe, with no runtime dependencies.",
      docs: "/pdfjs-viewer/",
      docsText: "Docs and playground",
      repo: "https://github.com/missing-elements/pdfjs-viewer",
    },
    {
      name: "h5p-offline-player",
      tag: "h5p-player",
      package: "@missing-elements/h5p-offline-player",
      description: "Plays .h5p files from your own URLs or from disk with no H5P server, offline too, and reports results as xAPI, cmi5 or SCORM.",
      docs: "https://h5p-offline-player.vercel.app/",
      docsText: "Demo",
      repo: "https://github.com/missing-elements/h5p-offline-player",
    },
  ],
  // The tools on the home page, under the elements: built on them, in the browser, an editor or an AI
  // agent. Each card's title goes where its first link does; a GitHub link is the tool's source.
  tools: [
    {
      name: "Build an H5P activity with AI",
      description: "Describe a lesson to ChatGPT, Claude or Grok and get an H5P activity, from a quiz to a branching scenario: play it, and download a .h5p file for Moodle or any other H5P site.",
      links: [
        { text: "Open", href: "/h5p/build/" },
        { text: "How-to", href: "/h5p/create-with-ai/" },
        { text: "GitHub", href: "https://github.com/missing-elements/missing-elements.github.io/tree/main/src/h5p/build" },
      ],
    },
    {
      name: "H5P to SCORM",
      description: "Turns a .h5p file into a SCORM zip that an LMS plays and grades, in your browser.",
      links: [
        { text: "Open", href: "https://h5p-offline-player.vercel.app/demo/scorm.html" },
        { text: "GitHub", href: "https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed" },
      ],
    },
    {
      name: "H5P Offline Player",
      description: "An app you install from the browser that plays .h5p files with no network.",
      links: [
        { text: "Open", href: "https://h5p-offline-player.vercel.app/app/" },
        { text: "GitHub", href: "https://github.com/missing-elements/h5p-offline-player" },
      ],
    },
    {
      name: "H5P Preview",
      description: "Plays .h5p files in VS Code, Cursor and VSCodium: offline, and nothing leaves your computer.",
      links: [
        { text: "VS Code Marketplace", href: "https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview" },
        { text: "Open VSX", href: "https://open-vsx.org/extension/MissingElements/h5p-preview" },
        { text: "GitHub", href: "https://github.com/missing-elements/h5p-offline-player/tree/main/packages/vscode" },
      ],
    },
    {
      name: "H5P skills for AI agents",
      description: "Five skills for Claude Code and other agents: H5P from a prompt, a check that it plays, a SCORM zip, H5P on your site, and video that streams.",
      links: [
        { text: "Install", href: "https://skills.sh/missing-elements/h5p-offline-player" },
        { text: "For a chat", href: "/h5p/create-with-ai/#install" },
        { text: "GitHub", href: "https://github.com/missing-elements/h5p-offline-player/tree/main/skills" },
      ],
    },
  ],
  buildFeedback,
};
