## Unreleased

- Diffs and files from other branches are now written to the extension's private per-project storage instead of the shared `/tmp/branch-review` folder, which other users on the Mac could read.
- New **Clear Cache** command (*Extensions › Branch Review*) deletes those files.
- Reviewed marks and the chosen base and target branches are now kept in the extension's private storage instead of the project's `.nova` settings. A branch under review could commit those settings to pre-mark its own files as reviewed or to hide its changes behind a different base. Marks saved by 0.1 aren't carried over.

## Version 0.1

- First release: a sidebar that lists the files a branch changed against its base, with diffs, commit filtering and reviewed marks.
