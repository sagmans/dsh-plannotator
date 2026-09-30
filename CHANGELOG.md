# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-30

### Added

- `AGENTS.md` records this repository's operating map: the supported harness
  line, the releases verified against it, the command surface, the module
  layout, and the release and security boundaries. Every agent working here had
  been rediscovering those from the sources on each task, so the guidance now
  sits beside the code it describes and stays checkable against it.

### Changed

- The plugin now serves the whole `>=0.1.5-rc.1 <0.3.0` harness range. The
  former `<0.2.0` ceiling excluded the 0.2.0 line, and the harness disables a row
  whose range does not admit its own version, so a profile on `0.2.0-rc.2` would
  have dropped this bundle's commands without a browser ever opening.
- `0.2.0-rc.2` joins `0.1.5-rc.2`, `0.1.5-rc.3`, and `0.1.7-rc.2` in
  `dsh.compatibility.dshReleases`: every pinned harness package resolves at that
  version, the gates pass against it, and a session driven from the packed
  tarball on the `0.2.0-rc.2` launcher mounts this row with no disable notice.
  The clone's terminal surface did not start — the sibling bundles that supply it
  still name `<0.1.6` peers — so no model reply was observed on this line yet.
  `node tools/harness-matrix.mjs` guards the list against the declared range, the
  peers, and the release the sources compile against, and CI runs it on every
  change.

### Fixed

- The release helper now acts on a supported npm 12 and answers npm's browser
  approval. npm 12 answers a version-qualified view with a one-element list
  where npm 11 answers with the object itself, and the metadata check demanded
  an object, so the helper refused a supported npm and the failure read as
  corrupt registry data rather than a shape difference. The wrapper opened a
  terminal for npm's browser prompt but never wrote to it, so npm printed its
  authentication URL and then waited for a keypress that never came: the read
  stalled until the window closed and the operator was never given the chance to
  approve.

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

[Unreleased]: https://github.com/sagmans/dsh-plannotator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sagmans/dsh-plannotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sagmans/dsh-plannotator/releases/tag/v0.1.0
