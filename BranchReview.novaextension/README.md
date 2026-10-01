Review a branch without leaving Nova. Branch Review lists every file a branch changed against its base, opens the diff with a double-click, and keeps track of which files you have already read.

## Features

- **Changed Files** with lines added and removed, and an icon for added, modified, deleted or renamed files
- **Only what the branch introduced**, compared from where it diverged, so later changes on the base are not noise
- **Uncommitted changes** to tracked files included when you review the checked-out branch
- **Commits** section: pick a commit to see just its files, or pick *All commits* to go back
- **Reviewed marks** for files or whole folders, with progress shown, plus *Open Next Unreviewed File*
- **Marks reset** when a file's diff changes, so new edits are never missed
- **Folder tree or flat list**, filtering by change type, and hiding reviewed files
- **Review any branch** without checking it out
- **Stays current** after saves, commits and branch switches

## Using it

Open a project that is a git repository, then open the **Branch Review** sidebar. The list fills in on its own: the target is the checked-out branch and the base is `main`.

- **Double-click a file** to open its diff, or the full file, depending on the setting below. Diffs open as temporary files, so Nova never asks you to save them. They are kept in the extension's private storage for this project; *Extensions › Branch Review › Clear Cache* deletes them.
- **Right-click** a file or folder to mark it reviewed, or to open the diff or full file.
- **Choose Target Branch…** and **Choose Base Branch…** (buttons in the Commits header, and in *Extensions › Branch Review*) change what is compared. They are remembered per project, along with your reviewed marks, in the extension's own storage rather than the project's `.nova` folder, so nothing is committed with the project.
- If no base is chosen, the first of `main`, `origin/main`, `master`, `origin/master`, `develop` that exists is used, then the remote's default branch.

## Preferences

- **Show files as**: a folder tree or a flat list
- **Double-click opens**: the diff or the full file
- **Hide reviewed files**

## Requirements

Git, installed through Homebrew, at `/usr/local/bin`, or from Apple's command-line tools.