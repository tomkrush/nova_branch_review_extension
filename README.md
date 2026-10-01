# Branch Review

A [Nova](https://nova.app) extension for reviewing a branch without leaving the editor. It lists every file a branch changed against its base, opens each diff with a double-click, and tracks which files you have already read.

See [BranchReview.novaextension/README.md](BranchReview.novaextension/README.md) for features and usage.

## Install for development

1. Clone this repository.
2. In Nova, choose **Extensions › Extension Library**, then open **Extensions › Show Extension Folder** and add a link to `BranchReview.novaextension`, or drag the folder onto Nova's Extensions menu.
3. Open a project that is a git repository, then open the **Branch Review** sidebar.

## Develop

Requires Node and `rsvg-convert` (`brew install librsvg`) for the icons.

```sh
cd BranchReview.novaextension
node tests/run.js      # runs the extension against a fake Nova and real temporary git repos
node tools/icons.js    # regenerates Images/ and extension.png from tools/logo.svg
```

## License

[MIT](LICENSE)
