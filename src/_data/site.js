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
  url: "https://missing-elements.github.io",
  github: "https://github.com/missing-elements",
  // Google Search Console's code for the site, from the "HTML tag" check of its URL-prefix property,
  // https://missing-elements.github.io/: base.njk writes it on every page while it is set.
  googleSiteVerification: "_z8PPC9AkWc2rKheTsM0kGmM6UA6FLfgMf0aRxDzULU",
  elements: [
    {
      name: "pdfjs-viewer",
      tag: "pdfjs-viewer-element",
      package: "@missing-elements/pdfjs-viewer",
      description: "A self-hostable PDF viewer web component, based on the PDF.js viewer.",
      docs: "/pdfjs-viewer/",
      repo: "https://github.com/missing-elements/pdfjs-viewer",
    },
    {
      name: "h5p-offline-player",
      package: "@missing-elements/h5p-offline-player",
      description: "A browser-only H5P player as one web component. Self-hostable, and builds a fully offline PWA.",
      docs: "https://h5p-offline-player.vercel.app/",
      repo: "https://github.com/missing-elements/h5p-offline-player",
    },
  ],
  // The tools on the home page, under the elements: pages built on them that run in the browser.
  // A tool's GitHub link is its source. The build page links the skill's page itself.
  tools: [
    {
      name: "Build an H5P activity with AI",
      description: "Describe a lesson to an AI chat and get an H5P activity, from a quiz to a branching scenario: play it, and download a .h5p file for Moodle or any other H5P site. Free, and nothing is uploaded.",
      page: "/h5p/build/",
      guide: "/h5p/create-with-ai/",
      repo: "https://github.com/missing-elements/missing-elements.github.io/tree/main/src/h5p/build",
    },
  ],
  buildFeedback,
};
