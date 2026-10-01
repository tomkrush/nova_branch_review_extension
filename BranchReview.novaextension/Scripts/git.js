// Everything that talks to git. `git(args)` runs git in the project folder and resolves to
// { code, stdout, stderr }; main.js supplies it from Nova, the tests from child_process.

const GIT_LOCATIONS = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"];
const BASE_CANDIDATES = ["main", "origin/main", "master", "origin/master", "develop"];
const ZERO = /^0+$/;

function findGit(exists) {
  return GIT_LOCATIONS.find(exists) || null;
}

// `git diff --raw -z`: ":mode mode oldsha newsha STATUS\0path\0" (renames add a second path).
function parseRaw(out) {
  const t = out.split("\0");
  const files = [];
  for (let i = 0; i < t.length; ) {
    const head = t[i++];
    if (!head || head[0] !== ":") continue;
    const m = head.slice(1).split(" ");
    let status = m[4][0];
    let path = t[i++];
    let oldPath = null;
    if (status === "R" || status === "C") {
      oldPath = path;
      path = t[i++];
    }
    if (status === "T") status = "M";
    files.push({ path, oldPath, status, oldSha: m[2], newSha: m[3] });
  }
  return files;
}

// `git diff --numstat -z`: "add\tdel\tpath\0" (renames: "add\tdel\t\0old\0new\0"); binary is "-\t-".
function parseNumstat(out) {
  const t = out.split("\0");
  const stats = new Map();
  for (let i = 0; i < t.length; ) {
    const head = t[i++];
    if (!head) continue;
    const [add, del, ...rest] = head.split("\t");
    let path = rest.join("\t");
    if (path === "") {
      i++; // old path
      path = t[i++];
    }
    stats.set(path, { add: add === "-" ? 0 : Number(add), del: del === "-" ? 0 : Number(del), binary: add === "-" });
  }
  return stats;
}

const ok = async (git, args) => {
  const r = await git(args);
  return r.code === 0 ? r.stdout.trim() : null;
};
const exists = async (git, ref) => (await ok(git, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) !== null;

async function resolveBase(git, saved) {
  const candidates = [saved, ...BASE_CANDIDATES].filter(Boolean);
  for (const ref of candidates) if (await exists(git, ref)) return ref;
  const remoteDefault = await ok(git, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
  if (remoteDefault && (await exists(git, remoteDefault))) return remoteDefault;
  return null;
}

async function listBranches(git) {
  const out = (await ok(git, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])) || "";
  return out
    .split("\n")
    .filter((r) => r && !r.endsWith("/HEAD"))
    .map((r) => r.replace(/^refs\/(heads|remotes)\//, ""));
}

// The files changed between `revs` (one rev = that commit vs the working tree), with line counts.
// `key` identifies this exact diff: it changes whenever either side of the file changes.
async function diffFiles(git, revs) {
  const [raw, num] = await Promise.all([git(["diff", "--raw", "-z", "-M", ...revs]), git(["diff", "--numstat", "-z", "-M", ...revs])]);
  if (raw.code !== 0) throw new Error(raw.stderr.trim() || "git diff failed");
  const stats = parseNumstat(num.stdout);
  const files = parseRaw(raw.stdout);
  for (const f of files) {
    const s = stats.get(f.path) || { add: 0, del: 0, binary: false };
    Object.assign(f, s);
    let newSha = f.newSha;
    if (ZERO.test(newSha) && f.status !== "D") newSha = (await ok(git, ["hash-object", "--", f.path])) || "?"; // working-tree side
    f.key = `${f.path}\t${f.oldSha}\t${newSha}`;
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// target/base default to the checked-out branch and the first well-known base.
async function load(git, { base: savedBase, target: savedTarget, commit }) {
  if ((await ok(git, ["rev-parse", "--is-inside-work-tree"])) !== "true") return { error: "This folder isn't a git repository." };
  const current = await ok(git, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const target = savedTarget || current || "HEAD";
  if (!(await exists(git, target))) return { error: `Branch “${target}” doesn't exist.` };
  const base = await resolveBase(git, savedBase);
  if (!base) return { error: `No base branch found (tried ${BASE_CANDIDATES.join(", ")}, the remote default). Choose one with Choose Base Branch.` };
  const mergeBase = await ok(git, ["merge-base", base, target]);
  if (!mergeBase) return { error: `“${target}” and “${base}” share no history.` };

  const isCurrent = target === current || target === "HEAD";
  const log = (await ok(git, ["log", "-z", "--format=%H%x1f%an%x1f%at%x1f%s", `${mergeBase}..${target}`])) || "";
  const commits = log.split("\0").filter(Boolean).map((l) => {
    const [sha, author, at, subject] = l.split("\x1f");
    return { sha, author, at: Number(at) * 1000, subject };
  });
  if (commit && !commits.some((c) => c.sha === commit)) commit = null;

  const revs = commit ? [`${commit}^1`, commit] : isCurrent ? [mergeBase] : [mergeBase, target];
  const files = await diffFiles(git, revs);
  const empty = base === target ? `“${target}” is the base branch; choose another target or base.` : `No changes between “${target}” and “${base}”.`;
  return { base, target, mergeBase, isCurrent, commits, commit, revs, files, empty, baseWasSaved: !savedBase || savedBase === base };
}

async function diffText(git, revs, file) {
  const r = await git(["diff", "-M", ...revs, "--", ...(file.oldPath ? [file.oldPath, file.path] : [file.path])]);
  return r.stdout || "(no differences)\n";
}

async function fileAt(git, ref, path) {
  const r = await git(["show", `${ref}:${path}`]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git show failed");
  return r.stdout;
}

module.exports = { findGit, parseRaw, parseNumstat, resolveBase, listBranches, load, diffText, fileAt };
