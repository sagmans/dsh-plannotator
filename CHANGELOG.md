# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-22

### Added

- `/plannotator-plan [file.md]` — review the newest plan of the session, or a
  markdown file, in the browser.
- `/plannotator-review [options] [PR_URL]` — review the working tree, a branch
  range, or a pull request.
- `/plannotator-annotate <file|folder|URL>` — annotate a document, a folder, or
  a web page.
- `/plannotator-last` — annotate the newest assistant message.
- A reviewer's feedback reaches the model as a steering message, so the agent can
  act on it in the same turn.

[Unreleased]: https://github.com/sagmans/dsh-plannotator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sagmans/dsh-plannotator/releases/tag/v0.1.0
