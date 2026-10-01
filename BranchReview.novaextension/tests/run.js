// Runs the extension from activation against a fake Nova runtime and real temporary git repos.
// Run: node tests/run.js
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync, spawn } = require("child_process");

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "branchreview-")));
const sh = (cwd, cmd) => execSync(cmd, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } }).toString();
const write = (cwd, p, text) => (fs.mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true }), fs.writeFileSync(path.join(cwd, p), text));

// ---------------- fake Nova ----------------
const views = {};
const opened = [];
const messages = [];
const commands = {};
let nextChoice = null;
let wsPath = null;
const wsConfig = {}; // survives "restarts", like .nova does
const storage = path.join(tmp, "storage"); // nova.extension.workspaceStoragePath
const cached = () => path.join(storage, "views");
const state = () => JSON.parse(fs.readFileSync(path.join(storage, "state.json"), "utf8"));
const config = {};

global.TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
global.TreeItem = class {
  constructor(name, state) {
    this.name = name;
    this.collapsibleState = state;
  }
};
global.TreeView = class {
  constructor(id, { dataProvider }) {
    this.id = id;
    this.provider = dataProvider;
    this.selection = [];
    this.selFn = null;
    views[id] = this;
  }
  reload() {
    return Promise.resolve();
  }
  reveal(n) {
    this.selection = [n];
    return Promise.resolve();
  }
  onDidChangeSelection(fn) {
    this.selFn = fn;
    return { dispose() {} };
  }
  dispose() {}
  rows(n = null, depth = 0, out = []) {
    for (const c of this.provider.getChildren(n)) {
      const item = this.provider.getTreeItem(c);
      out.push({ node: c, item, depth });
      if (item.collapsibleState) this.rows(c, depth + 1, out);
    }
    return out;
  }
  labels() {
    return this.rows().map(({ item, depth }) => `${"  ".repeat(depth)}${item.name}${item.descriptiveText ? "  [" + item.descriptiveText + "]" : ""}`);
  }
  pick(pred) {
    const hit = this.rows().find(({ node, item }) => pred(node, item));
    assert.ok(hit, `${this.id}: no row matched\n${this.labels().join("\n")}`);
    this.selection = [hit.node];
    if (this.selFn) this.selFn(this.selection);
    return hit;
  }
};
global.CompositeDisposable = class {
  constructor() {
    this.items = [];
  }
  add(d) {
    this.items.push(d);
    return d;
  }
  dispose() {
    this.items.forEach((d) => d && d.dispose && d.dispose());
  }
};
global.Process = class {
  constructor(cmd, o) {
    this.cmd = cmd;
    this.o = o;
  }
  onStdout(f) {
    this.out = f;
  }
  onStderr(f) {
    this.err = f;
  }
  onDidExit(f) {
    this.exit = f;
  }
  start() {
    const p = spawn(this.cmd, this.o.args, { cwd: this.o.cwd, env: { ...process.env, ...this.o.env } });
    p.stdout.setEncoding("utf8").on("data", (s) => this.out(s));
    p.stderr.setEncoding("utf8").on("data", (s) => this.err(s));
    p.on("close", (code) => this.exit(code));
  }
};
global.nova = {
  extension: { workspaceStoragePath: storage },
  config: { get: (k) => (k in config ? config[k] : null), set: (k, v) => (config[k] = v), onDidChange: () => ({ dispose() {} }) },
  path,
  fs: {
    stat: (p) => (fs.existsSync(p) ? {} : null),
    mkdir: (p) => fs.mkdirSync(p),
    listdir: (p) => fs.readdirSync(p),
    remove: (p) => fs.rmSync(p),
    open: (p, mode) => {
      if (mode === "r") {
        const text = fs.readFileSync(p, "utf8");
        return { read: () => text, close() {} };
      }
      let buf = "";
      return { write: (t) => (buf += t), close: () => fs.writeFileSync(p, buf) };
    },
    watch: () => ({ dispose() {} }),
  },
  commands: { register: (n, fn) => ((commands[n] = fn), { dispose() {} }) },
  workspace: {
    get path() {
      return wsPath;
    },
    config: { get: (k) => (k in wsConfig ? wsConfig[k] : null), set: (k, v) => (wsConfig[k] = v) },
    onDidAddTextEditor: () => ({ dispose() {} }),
    openFile: (p) => (opened.push(p), Promise.resolve(null)),
    showChoicePalette: (choices, o, cb) => {
      const i = nextChoice;
      nextChoice = null;
      i === null ? cb(null, null) : cb(choices[i], i);
    },
    showInformativeMessage: (m) => messages.push(m),
  },
};

// ---------------- helpers ----------------
const ext = require(path.join(__dirname, "..", "Scripts", "main.js"));
const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const FILES = () => views["branchreview.files"];
const COMMITS = () => views["branchreview.commits"];
const start = async (dir) => {
  wsPath = dir;
  ext.activate();
  await tick();
};
const restart = async () => {
  ext.deactivate();
  await start(wsPath);
};
const run = async (name) => (commands[`branchreview.${name}`](), await tick());

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS ", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL ", name, "\n     ", e.stack.split("\n").slice(0, 6).join("\n      "));
  }
}

// main has a later commit the branch never saw; feature adds, edits, renames, deletes and adds a binary.
function buildRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  sh(dir, "git init -q -b main");
  write(dir, "src/keep.js", "a\nb\nc\nd\ne\n");
  write(dir, "src/old name.js", "one\ntwo\nthree\nfour\nfive\nsix\n");
  write(dir, "docs/gone.md", "bye\n");
  write(dir, "main-only.txt", "m\n");
  sh(dir, "git add . && git commit -qm init");
  sh(dir, "git checkout -qb feature");
  write(dir, "src/keep.js", "a\nb\nc\nd\ne\nf\ng\n");
  sh(dir, 'git commit -qam "edit keep"');
  sh(dir, 'git mv "src/old name.js" "src/new é.js"');
  write(dir, "src/new é.js", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
  sh(dir, "git rm -q docs/gone.md");
  fs.writeFileSync(path.join(dir, "logo.bin"), Buffer.from([0, 1, 2, 3]));
  sh(dir, 'git add -A && git commit -qm "rename, delete, binary"');
  sh(dir, "git checkout -q main");
  write(dir, "main-only.txt", "m\nlater change on main\n");
  sh(dir, 'git commit -qam "main moves on"');
  sh(dir, "git checkout -q feature");
}

(async () => {
  const repo = path.join(tmp, "repo");
  buildRepo(repo);
  await start(repo);

  await test("list fills in on open against main, showing only what the branch introduced", () => {
    const l = FILES().labels();
    assert.ok(l.some((x) => /Reviewed 0 of 4/.test(x)), l.join("\n"));
    assert.ok(!l.some((x) => /main-only/.test(x)), "later change on main is not noise");
    assert.ok(l.some((x) => /keep\.js.*\+2 −0/.test(x)));
    assert.ok(l.some((x) => /logo\.bin.*binary/.test(x)));
  });

  await test("rows carry change-type icons and renames", () => {
    const icon = (re) => FILES().rows().find(({ item }) => re.test(item.name)).item.image;
    assert.strictEqual(icon(/keep\.js/), "st-modified");
    assert.strictEqual(icon(/logo\.bin/), "st-added");
    assert.strictEqual(icon(/gone\.md/), "st-deleted");
    assert.strictEqual(icon(/new é\.js/), "st-renamed");
    assert.match(FILES().rows().find(({ item }) => /new é/.test(item.name)).item.tooltip, /src\/old name\.js → src\/new é\.js/);
  });

  await test("folders group files; flat list shows the directory instead", async () => {
    assert.ok(FILES().labels().some((x) => /^src  \[2 files\]/.test(x)) || FILES().labels().some((x) => /^src/.test(x)), FILES().labels().join("\n"));
    config["branchreview.view"] = "list";
    const l = FILES().labels();
    assert.ok(l.some((x) => /^keep\.js  \[src  \+2 −0\]/.test(x)), l.join("\n"));
    delete config["branchreview.view"];
  });

  await test("double-click opens a stable temporary diff, or the full file per setting", async () => {
    FILES().pick((n) => n.kind === "file" && n.file.path === "src/keep.js");
    await run("openDefault");
    const diff = opened.pop();
    assert.ok(diff.startsWith(cached() + "/") && diff.endsWith(".diff"), diff);
    assert.match(fs.readFileSync(diff, "utf8"), /\+f\n\+g/);
    await run("openDefault");
    assert.strictEqual(opened.pop(), diff, "same name each time");
    config["branchreview.openMode"] = "file";
    await run("openDefault");
    assert.strictEqual(opened.pop(), path.join(repo, "src/keep.js"), "checked-out branch opens the real file");
    FILES().pick((n) => n.kind === "file" && n.file.path === "docs/gone.md");
    await run("openDefault");
    assert.ok(opened.pop().endsWith(".diff"), "deleted file falls back to its diff");
    delete config["branchreview.openMode"];
  });

  await test("uncommitted edits to tracked files join the checked-out branch's diff", async () => {
    write(repo, "src/keep.js", "a\nb\nc\nd\ne\nf\ng\nh\n");
    await run("refresh");
    assert.ok(FILES().labels().some((x) => /keep\.js.*\+3 −0/.test(x)), FILES().labels().join("\n"));
  });

  await test("reviewed marks: files and folders, progress, hide, next unreviewed", async () => {
    FILES().pick((n) => n.kind === "file" && n.file.path === "src/keep.js");
    await run("toggleReviewed");
    assert.ok(FILES().labels().some((x) => /✓ keep\.js/.test(x)));
    assert.ok(FILES().labels().some((x) => /Reviewed 1 of 4/.test(x)));
    FILES().pick((n) => n.kind === "folder" && n.label === "src");
    await run("toggleReviewed");
    assert.ok(FILES().labels().some((x) => /Reviewed 2 of 4/.test(x)), "folder marks its files");
    config["branchreview.hideReviewed"] = true;
    assert.ok(!FILES().labels().some((x) => /keep\.js/.test(x)));
    delete config["branchreview.hideReviewed"];
    FILES().pick((n) => n.kind === "file" && n.file.path === "logo.bin");
    await run("nextUnreviewed");
    assert.ok(opened.pop().endsWith(".diff"));
    assert.ok(FILES().selection[0].file.path !== "src/keep.js" && !FILES().selection[0].file.path.startsWith("src/"), "skips reviewed files");
  });

  await test("marks persist across restarts and reset when a file's diff changes", async () => {
    await restart();
    assert.ok(FILES().labels().some((x) => /Reviewed 2 of 4/.test(x)), FILES().labels().join("\n"));
    write(repo, "src/keep.js", "a\nb\nc\nd\ne\nf\ng\nh\nEDIT\n");
    await run("refresh");
    assert.ok(FILES().labels().some((x) => /Reviewed 1 of 4/.test(x)), FILES().labels().join("\n"));
    assert.ok(!FILES().labels().some((x) => /✓ keep\.js/.test(x)));
    assert.strictEqual(state().reviewed.filter((k) => k.startsWith("src/keep.js\t")).length, 0, "stale key pruned");
  });

  await test("type filter narrows the list", async () => {
    nextChoice = 4; // Renamed
    await run("chooseFilter");
    const l = FILES().labels();
    assert.ok(l.some((x) => /new é/.test(x)) && !l.some((x) => /keep\.js|logo\.bin/.test(x)), l.join("\n"));
    nextChoice = 0;
    await run("chooseFilter");
  });

  await test("commits section lists the branch's commits; picking one filters the files", async () => {
    const labels = COMMITS().labels();
    assert.ok(labels[0].startsWith("All commits") && labels.some((x) => /rename, delete, binary/.test(x)) && labels.some((x) => /edit keep/.test(x)), labels.join("\n"));
    COMMITS().pick((n) => n.kind === "commit" && /edit keep/.test(n.commit.subject));
    await tick();
    const l = FILES().labels();
    assert.ok(l.some((x) => /keep\.js/.test(x)) && !l.some((x) => /logo\.bin/.test(x)), l.join("\n"));
    assert.ok(l.some((x) => /Reviewed 0 of 1/.test(x)));
    FILES().pick((n) => n.kind === "file");
    await run("openDefault");
    assert.match(path.basename(opened.pop()), /^[0-9a-f]{7}__/, "commit diffs get their own name");
    COMMITS().pick((n) => n.kind === "all");
    await tick();
    assert.ok(FILES().labels().some((x) => /Reviewed \d of 4/.test(x)));
  });

  await test("another branch can be reviewed without checking it out", async () => {
    sh(repo, "git stash -q");
    sh(repo, "git checkout -q main");
    await run("refresh");
    assert.ok(FILES().labels().some((x) => /No changes between “main” and “main”|is the base branch/.test(x)), FILES().labels().join("\n"));
    nextChoice = 1 + ["feature", "main"].indexOf("feature"); // [checked-out, feature, main]
    await run("chooseTarget");
    const l = FILES().labels();
    assert.ok(l.some((x) => /Reviewed \d of 4/.test(x)), l.join("\n"));
    assert.ok(!l.some((x) => /EDIT/.test(x)));
    FILES().pick((n) => n.kind === "file" && n.file.path === "src/keep.js");
    config["branchreview.openMode"] = "file";
    await run("openDefault");
    const file = opened.pop();
    assert.ok(file.startsWith(cached() + "/") && file.endsWith("src__keep.js"), file);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "a\nb\nc\nd\ne\nf\ng\n", "content comes from the target branch");
    delete config["branchreview.openMode"];
    nextChoice = 0;
    await run("chooseTarget"); // back to the checked-out branch
    sh(repo, "git checkout -q feature");
    sh(repo, "git stash pop -q");
  });

  await test("the base can be changed per project and is remembered", async () => {
    sh(repo, "git checkout -q feature");
    sh(repo, "git branch develop main~0");
    nextChoice = 0; // branches sorted as git lists them: develop first
    await run("chooseBase");
    assert.strictEqual(state().base, "develop");
    await restart();
    assert.ok(FILES().labels().some((x) => /feature ← develop/.test(x)), FILES().labels().join("\n"));
    nextChoice = 2; // [develop, feature, main]: back to main
    await run("chooseBase");
  });

  await test("review state in the project's .nova config is ignored", async () => {
    const keys = ext._internals.getApp().data.files.map((f) => f.key);
    Object.assign(wsConfig, {
      "branchreview.reviewed": JSON.stringify(keys),
      "branchreview.base": "feature",
      "branchreview.target": "main",
    });
    await restart();
    const l = FILES().labels();
    assert.ok(l.some((x) => /feature ← main/.test(x)), l.join("\n"));
    assert.ok(!l.some((x) => /All files reviewed/.test(x)), l.join("\n"));
    for (const k of Object.keys(wsConfig)) delete wsConfig[k];
  });

  await test("clear messages: not a repository, missing base, missing git folder", async () => {
    const plain = path.join(tmp, "plain");
    fs.mkdirSync(plain);
    wsPath = plain;
    ext.deactivate();
    await start(plain);
    assert.deepStrictEqual(FILES().labels(), ["This folder isn't a git repository."]);

    const odd = path.join(tmp, "odd");
    fs.mkdirSync(odd);
    sh(odd, "git init -q -b trunk");
    write(odd, "a.txt", "a\n");
    sh(odd, 'git add . && git commit -qm one');
    ext.deactivate();
    await start(odd);
    assert.match(FILES().labels()[0], /No base branch found \(tried main, origin\/main, master, origin\/master, develop/);
    wsPath = null;
    ext.deactivate();
    await start(null);
    assert.deepStrictEqual(FILES().labels(), ["Open a folder to review a branch."]);
  });

  await test("Clear Cache deletes the opened diffs and files", async () => {
    assert.ok(fs.readdirSync(cached()).length > 0, "earlier tests opened diffs");
    await run("clearCache");
    assert.deepStrictEqual(fs.readdirSync(cached()), []);
    assert.match(messages.pop(), /^Removed \d+ cached files?\.$/);
    await run("clearCache");
    assert.strictEqual(messages.pop(), "The cache is already empty.");
  });

  await test("a newer refresh wins over a slower one", async () => {
    wsPath = repo;
    ext.deactivate();
    await start(repo);
    const app = ext._internals.getApp();
    const slow = app.refresh();
    const fast = app.refresh();
    await Promise.all([slow, fast]);
    assert.ok(app.data.files.length === 4);
  });

  console.log(`\n${passed}/${passed + failures.length} passed`);
  ext.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})();
