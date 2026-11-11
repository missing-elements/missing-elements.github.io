export default {
  name: "Missing Elements",
  url: "https://missing-elements.github.io",
  github: "https://github.com/missing-elements",
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
  // A tool's GitHub link is where it is explained. The build page links the skill's page itself.
  tools: [
    {
      name: "Build an H5P activity",
      description: "Make H5P activities with an AI chat and the h5p-author skill: paste the source it wrote, play it, and download a .h5p file for any H5P site. Nothing is uploaded.",
      page: "/h5p/build/",
      repo: "https://github.com/missing-elements/missing-elements.github.io/blob/main/docs/h5p-build-page.md",
    },
  ],
};
