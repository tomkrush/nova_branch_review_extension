// Branch Review: a sidebar that lists what a branch changed against its base and tracks review progress.

const gitlib = require("./git.js");
const { Review } = require("./review.js");

const IMAGE = { A: "st-added", M: "st-modified", D: "st-deleted", R: "st-renamed" };
const WORD = { A: "Added", M: "Modified", D: "Deleted", R: "Renamed" };
const FILTERS = [["all", "All changes"], ["A", "Added"], ["M", "Modified"], ["D", "Deleted"], ["R", "Renamed"]];

const setting = (key, def) => {
  const v = nova.config.get(`branchreview.${key}`);
  return v === null || v === undefined ? def : v;
};

function novaExec(gitPath, cwd) {
  return (args) =>
    new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      try {
        const p = new Process(gitPath, { args, cwd, env: { GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
        p.onStdout((s) => (stdout += s));
        p.onStderr((s) => (stderr += s));
        p.onDidExit((code) => resolve({ code, stdout, stderr }));
        p.start();
      } catch (e) {
        resolve({ code: -1, stdout, stderr: String(e) });
      }
    });
}

function mkdirp(dir) {
  if (nova.fs.stat(dir)) return;
  mkdirp(nova.path.dirname(dir));
  nova.fs.mkdir(dir);
}

// Diffs and other-branch files are written here: private to the user and to this project.
const viewsDir = () => nova.path.join(nova.extension.workspaceStoragePath, "views");

// Reviewed marks and the chosen branches. Kept in the extension's storage, not the workspace
// config: that lives in the project's .nova folder, which a branch under review can commit.
const stateFile = () => nova.path.join(nova.extension.workspaceStoragePath, "state.json");

function readState() {
  try {
    const fh = nova.fs.open(stateFile(), "r");
    const text = fh.read();
    fh.close();
    const state = JSON.parse(text);
    return state && typeof state === "object" ? state : {};
  } catch (_) {
    return {};
  }
}

const stateGet = (key) => {
  const v = readState()[key];
  return v === undefined ? null : v;
};

function stateSet(key, v) {
  const state = readState();
  if (v === null || v === undefined) delete state[key];
  else state[key] = v;
  mkdirp(nova.extension.workspaceStoragePath);
  const fh = nova.fs.open(stateFile(), "w");
  fh.write(JSON.stringify(state));
  fh.close();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

class App {
  constructor() {
    this.data = { files: [], commits: [], revs: [] };
    this.commit = null;
    this.filter = "all";
    this.seq = 0;
    this.timer = null;
    this.cache = new Map();
    this.review = new Review({
      get: () => {
        const keys = stateGet("reviewed");
        return Array.isArray(keys) ? keys : [];
      },
      set: (keys) => stateSet("reviewed", keys),
    });
    this.git = null;
  }

  // ---- loading ----------------------------------------------------------------

  async refresh() {
    const id = ++this.seq;
    const data = await this.load();
    if (id !== this.seq) return; // a newer refresh is on its way
    this.data = data;
    this.commit = data.commit || null;
    if (!data.error && !this.commit) this.review.prune(data.files);
    this.filesView.reload();
    this.commitsView.reload();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 400);
  }

  async load() {
    const root = nova.workspace.path;
    if (!root) return { error: "Open a folder to review a branch." };
    const gitPath = gitlib.findGit((p) => !!nova.fs.stat(p));
    if (!gitPath) return { error: "Git wasn't found (looked in /opt/homebrew/bin, /usr/local/bin and /usr/bin)." };
    this.git = novaExec(gitPath, root);
    try {
      return await gitlib.load(this.git, { base: stateGet("base"), target: stateGet("target"), commit: this.commit });
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  // ---- files tree -------------------------------------------------------------

  visibleFiles() {
    const hide = setting("hideReviewed", false);
    return this.data.files.filter((f) => (this.filter === "all" || f.status === this.filter) && !(hide && this.review.has(f.key)));
  }

  node(key, fields) {
    let n = this.cache.get(key);
    if (!n) this.cache.set(key, (n = { key }));
    for (const k of Object.keys(n)) if (k !== "key") delete n[k];
    return Object.assign(n, fields);
  }

  filesRoot() {
    const d = this.data;
    if (d.error) return [this.node("error", { kind: "message", name: d.error, image: "warning" })];
    const rows = [];
    if (!d.baseWasSaved) rows.push(this.node("notice", { kind: "message", name: `Saved base not found; using “${d.base}”`, image: "warning" }));
    if (!d.files.length) return rows.concat(this.node("empty", { kind: "message", name: d.empty || "Loading…", image: "info" }));
    const done = d.files.filter((f) => this.review.has(f.key)).length;
    rows.push(this.node("progress", { kind: "progress", name: done === d.files.length ? "All files reviewed" : `Reviewed ${done} of ${d.files.length}`, text: d.commit ? "this commit" : `${d.target} ← ${d.base}`, image: "check" }));
    const files = this.visibleFiles();
    if (!files.length) return rows.concat(this.node("hidden", { kind: "message", name: "No files match the filter", image: "info" }));
    return rows.concat(setting("view", "tree") === "tree" ? this.tree(files) : files.map((f) => this.fileNode(f)));
  }

  fileNode(f, parent) {
    return this.node(`file:${f.path}`, { kind: "file", file: f, parent });
  }

  tree(files) {
    const root = { dirs: new Map(), files: [] };
    for (const f of files) {
      let d = root;
      for (const part of f.path.split("/").slice(0, -1)) {
        if (!d.dirs.has(part)) d.dirs.set(part, { dirs: new Map(), files: [] });
        d = d.dirs.get(part);
      }
      d.files.push(f);
    }
    const build = (d, prefix, parent) => {
      const out = [];
      for (const [name, sub] of [...d.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
        let label = name;
        let cur = sub;
        while (!cur.files.length && cur.dirs.size === 1) {
          const [n2, s2] = [...cur.dirs][0];
          label += "/" + n2;
          cur = s2;
        }
        const path = prefix ? `${prefix}/${label}` : label;
        const folder = this.node(`dir:${path}`, { kind: "folder", label, parent });
        folder.kids = build(cur, path, folder);
        folder.files = folder.kids.flatMap((k) => (k.kind === "folder" ? k.files : [k.file]));
        out.push(folder);
      }
      for (const f of d.files) out.push(this.fileNode(f, parent));
      return out;
    };
    return build(root, "", null);
  }

  describeFile(n) {
    const f = n.file;
    const reviewed = this.review.has(f.key);
    const slash = f.path.lastIndexOf("/");
    const flat = setting("view", "tree") !== "tree";
    const counts = f.binary ? "binary" : `+${f.add} −${f.del}`;
    return {
      name: `${reviewed ? "✓ " : ""}${slash === -1 ? f.path : f.path.slice(slash + 1)}`,
      text: [flat && slash !== -1 ? f.path.slice(0, slash) : "", counts].filter(Boolean).join("  "),
      tooltip: `${WORD[f.status]} · ${f.oldPath ? `${f.oldPath} → ` : ""}${f.path}\n${counts}${reviewed ? "\nReviewed" : ""}`,
      image: IMAGE[f.status],
      context: "file",
    };
  }

  // ---- opening files ----------------------------------------------------------

  writeTemp(name, text) {
    const dir = viewsDir();
    mkdirp(dir);
    const file = nova.path.join(dir, name);
    const fh = nova.fs.open(file, "w");
    fh.write(text);
    fh.close();
    return file;
  }

  viewName() {
    return this.data.commit ? this.data.commit.slice(0, 7) : "branch";
  }

  async openDiff(f) {
    const text = await gitlib.diffText(this.git, this.data.revs, f);
    return nova.workspace.openFile(this.writeTemp(`${this.viewName()}__${f.path.replace(/\//g, "__")}.diff`, text));
  }

  async openFull(f) {
    const d = this.data;
    if (f.status === "D" || f.binary) return this.openDiff(f);
    if (d.isCurrent && !d.commit) return nova.workspace.openFile(nova.path.join(nova.workspace.path, f.path));
    const text = await gitlib.fileAt(this.git, d.commit || d.target, f.path);
    return nova.workspace.openFile(this.writeTemp(`${this.viewName()}__${f.path.replace(/\//g, "__")}`, text));
  }

  open(f, mode) {
    return (mode || setting("openMode", "diff")) === "file" ? this.openFull(f) : this.openDiff(f);
  }

  clearCache() {
    const dir = viewsDir();
    const names = nova.fs.stat(dir) ? nova.fs.listdir(dir) : [];
    for (const name of names) nova.fs.remove(nova.path.join(dir, name));
    nova.workspace.showInformativeMessage(names.length ? `Removed ${plural(names.length, "cached file")}.` : "The cache is already empty.");
  }

  // ---- review marks -----------------------------------------------------------

  selectedFiles() {
    return this.filesView.selection.flatMap((n) => (n.kind === "folder" ? n.files : n.kind === "file" ? [n.file] : []));
  }

  toggleReviewed() {
    const files = this.selectedFiles();
    if (!files.length) return;
    const allDone = files.every((f) => this.review.has(f.key));
    this.review.set(files.map((f) => f.key), !allDone);
    this.filesView.reload();
  }

  nextUnreviewed() {
    const order = setting("view", "tree") === "tree" ? this.flatten(this.tree(this.visibleFiles())) : this.visibleFiles();
    const sel = this.filesView.selection.find((n) => n.kind === "file");
    const start = sel ? order.findIndex((f) => f.path === sel.file.path) : -1;
    const rotated = order.slice(start + 1).concat(order.slice(0, start + 1));
    const next = rotated.find((f) => !this.review.has(f.key));
    if (!next) return nova.workspace.showInformativeMessage("Every file is reviewed.");
    this.filesView.reveal(this.cache.get(`file:${next.path}`), { select: true, focus: true });
    return this.open(next);
  }

  flatten(nodes) {
    return nodes.flatMap((n) => (n.kind === "folder" ? this.flatten(n.kids) : [n.file]));
  }

  // ---- commits ----------------------------------------------------------------

  commitsRoot() {
    const d = this.data;
    if (d.error || !d.commits.length) return [];
    const all = this.node("all", { kind: "all" });
    return [all, ...d.commits.map((c) => this.node(`commit:${c.sha}`, { kind: "commit", commit: c }))];
  }

  describeCommit(n) {
    if (n.kind === "all") return { name: "All commits", text: plural(this.data.commits.length, "commit"), image: "commit" };
    const c = n.commit;
    return { name: c.subject, text: `${c.sha.slice(0, 7)} · ${c.author}`, tooltip: `${c.sha}\n${c.author}\n${c.subject}`, image: "commit" };
  }

  selectCommit(sel) {
    const n = sel[0];
    if (!n) return;
    const sha = n.kind === "commit" ? n.commit.sha : null;
    if (sha === this.commit) return; // a reload re-sends the selection
    this.commit = sha;
    this.refresh();
  }

  // ---- pickers ----------------------------------------------------------------

  async pickBranch(key, title, allowReset) {
    const branches = await gitlib.listBranches(this.git || novaExec(gitlib.findGit((p) => !!nova.fs.stat(p)), nova.workspace.path));
    const choices = allowReset ? ["(Checked-out branch)", ...branches] : branches;
    nova.workspace.showChoicePalette(choices, { placeholder: title }, (choice, index) => {
      if (choice === null || choice === undefined) return;
      stateSet(key, allowReset && index === 0 ? null : choice);
      this.commit = null;
      this.refresh();
    });
  }

  chooseFilter() {
    nova.workspace.showChoicePalette(FILTERS.map((f) => f[1]), { placeholder: "Show files" }, (choice, index) => {
      if (index === null || index === undefined) return;
      this.filter = FILTERS[index][0];
      this.filesView.reload();
    });
  }
}

function makeTree(app, describe, children, activateCommand) {
  return {
    getChildren: (n) => (n ? n.kids || [] : children()),
    getParent: (n) => (n && n.parent) || null,
    getTreeItem: (n) => {
      const d = describe(n);
      const item = new TreeItem(d.name, n.kids ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None);
      item.identifier = `${n.kind}:${n.key}`;
      if (d.text) item.descriptiveText = d.text;
      if (d.tooltip) item.tooltip = d.tooltip;
      if (d.image) item.image = d.image;
      if (d.context) item.contextValue = d.context;
      if (activateCommand && n.kind === "file") item.command = activateCommand;
      return item;
    },
  };
}

let app = null;
let disposables = null;

exports.activate = function () {
  disposables = new CompositeDisposable();
  app = new App();

  // Nova sends a handler's return value across a process boundary and aborts if it can't encode it
  // (a Promise can't be), so handlers must return nothing.
  const reg = (name, fn) =>
    disposables.add(
      nova.commands.register(`branchreview.${name}`, (...args) => {
        try {
          const r = fn(...args);
          if (r && r.catch) r.catch((e) => console.error(`[Branch Review] ${name}:`, e && e.message ? e.message : e));
        } catch (e) {
          console.error(`[Branch Review] ${name}:`, e && e.message ? e.message : e);
        }
      })
    );
  const firstFile = () => app.filesView.selection.find((n) => n.kind === "file");
  reg("refresh", () => app.refresh());
  reg("chooseBase", () => app.pickBranch("base", "Compare against…", false));
  reg("chooseTarget", () => app.pickBranch("target", "Review branch…", true));
  reg("chooseFilter", () => app.chooseFilter());
  reg("toggleView", () => {
    nova.config.set("branchreview.view", setting("view", "tree") === "tree" ? "list" : "tree");
    app.filesView.reload();
  });
  reg("toggleHideReviewed", () => {
    nova.config.set("branchreview.hideReviewed", !setting("hideReviewed", false));
    app.filesView.reload();
  });
  reg("toggleReviewed", () => app.toggleReviewed());
  reg("nextUnreviewed", () => app.nextUnreviewed());
  reg("openDefault", () => firstFile() && app.open(firstFile().file));
  reg("openDiff", () => firstFile() && app.open(firstFile().file, "diff"));
  reg("clearCache", () => app.clearCache());
  reg("openFile", () => firstFile() && app.open(firstFile().file, "file"));


  const filesProvider = makeTree(
    app,
    (n) => {
      if (n.kind === "file") return app.describeFile(n);
      if (n.kind === "folder") return { name: n.label, text: plural(n.files.length, "file"), image: "folder", context: "folder" };
      return { name: n.name, text: n.text, image: n.image };
    },
    () => app.filesRoot(),
    "branchreview.openDefault"
  );
  const commitsProvider = makeTree(app, (n) => app.describeCommit(n), () => app.commitsRoot());

  app.filesView = new TreeView("branchreview.files", { dataProvider: filesProvider });
  app.commitsView = new TreeView("branchreview.commits", { dataProvider: commitsProvider });
  disposables.add(app.filesView);
  disposables.add(app.commitsView);
  disposables.add(app.commitsView.onDidChangeSelection((sel) => app.selectCommit(sel)));

  for (const key of ["view", "openMode", "hideReviewed"]) disposables.add(nova.config.onDidChange(`branchreview.${key}`, () => app.filesView.reload()));

  disposables.add(nova.workspace.onDidAddTextEditor((editor) => disposables.add(editor.onDidSave(() => app.schedule()))));
  if (nova.fs.watch) {
    // Commits, checkouts and saves all touch files; ignore git internals and our own .nova writes.
    disposables.add(
      nova.fs.watch(null, (p) => {
        if (p.includes("/.nova/")) return;
        if (p.includes("/.git/") && !/\/\.git\/(HEAD|refs\/)/.test(p)) return;
        app.schedule();
      })
    );
  }

  app.refresh();
};

exports.deactivate = function () {
  if (app) clearTimeout(app.timer);
  if (disposables) disposables.dispose();
  app = null;
  disposables = null;
};

exports._internals = { getApp: () => app };
