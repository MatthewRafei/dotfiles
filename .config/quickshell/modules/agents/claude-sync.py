#!/usr/bin/env python3
"""Sync Claude Code sessions between machines through a synced folder (Syncthing).

  claude-sync.py push         copy this machine's changes into the staging folder
  claude-sync.py pull         merge the other machines' changes into ~/.claude
  claude-sync.py sync         pull, then push
  claude-sync.py status       JSON: last push/pull, peers, pending files, conflicts
  claude-sync.py conflicts    list conflict copies (resolve them by hand)
  claude-sync.py init         create the staging folder for this machine

  -q        no output          --hook   read a hook's JSON on stdin, leave its session alone

Ideas taken from https://github.com/tawanorg/claude-sync (sessions scope, home
path tokens so transcripts move between machines with different homes,
conflict copies instead of silent overwrites). The transport is a plain folder,
STAGE (default ~/Sync/claude, $CLAUDE_SYNC_DIR), which Syncthing shares
between the machines. Every machine writes only STAGE/<its host>/, so no file
there ever has two writers; pulls read everyone else's.

What syncs (the "sessions" scope): projects/ (transcripts, auto-memory),
plans/, tasks/ and history.jsonl. Not settings, skills or plugins: those hold
machine-specific paths and are in the dotfiles anyway.

Merging:
  transcripts (*.jsonl)  the longer one wins when one extends the other;
                         if both moved on, the remote one is kept beside it
                         as <name>.conflict-<host>
  other files            the newer one wins, unless both changed since the
                         last sync: then a conflict copy as above
  history.jsonl          lines merged from every machine, sorted by time
  deletions              a file deleted here is deleted on the others,
                         unless they changed it after the deletion
Sessions running here are never touched; they're merged on a later pull.
Standard library only; does nothing until STAGE exists.
"""
import fcntl
import json
import os
import re
import socket
import sys
import time

HOME = os.path.expanduser("~")
CLAUDE = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
STAGE = os.environ.get("CLAUDE_SYNC_DIR") or os.path.join(HOME, "Sync", "claude")
HOST = re.sub(r"[^A-Za-z0-9_.-]", "_", os.environ.get("CLAUDE_SYNC_HOST") or socket.gethostname().split(".")[0])
STATE = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(HOME, ".local", "state"),
                     "claude-sync", "state.json")
SCOPE = ["projects", "plans", "tasks", "history.jsonl"]
HISTORY = "history.jsonl"
TOMBS = ".deleted.json"
TOMB_DAYS = 90

# the home directory, in file contents and in project folder names (Claude
# names them after the path: /home/me/x -> -home-me-x)
TOKEN = b"@@CLAUDE_SYNC_HOME@@"
HOME_B = HOME.encode()
HOME_DIR = re.sub(r"[^A-Za-z0-9]", "-", HOME)
DIR_TOKEN = "@HOME"

quiet = False


def say(*a):
    if not quiet:
        print(*a)


def now_ms():
    return int(time.time() * 1000)


# --- paths -----------------------------------------------------------------

def to_stage(rel):
    """projects/-home-me-x/... -> projects/@HOME-x/..."""
    parts = rel.split("/")
    if len(parts) > 1 and parts[0] == "projects":
        d = parts[1]
        if d == HOME_DIR or d.startswith(HOME_DIR + "-"):
            parts[1] = DIR_TOKEN + d[len(HOME_DIR):]
    return "/".join(parts)


def to_local(srel):
    parts = srel.split("/")
    if len(parts) > 1 and parts[0] == "projects" and parts[1].startswith(DIR_TOKEN):
        parts[1] = HOME_DIR + parts[1][len(DIR_TOKEN):]
    return "/".join(parts)


def skip_name(name):
    return name.startswith(".syncthing.") or name.startswith(".~") or ".conflict-" in name \
        or name.endswith(".tmp") or name in (TOMBS, ".stfolder", ".stignore", ".stversions")


def walk(root, scope=SCOPE):
    """{relative path: (size, mtime_ns)} of the files under root in scope"""
    out = {}
    for top in scope:
        base = os.path.join(root, top)
        if os.path.isfile(base):
            st = os.stat(base)
            out[top] = (st.st_size, st.st_mtime_ns)
            continue
        for d, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if not skip_name(x)]
            for f in files:
                if skip_name(f):
                    continue
                p = os.path.join(d, f)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if os.path.isfile(p) and not os.path.islink(p):
                    out[os.path.relpath(p, root)] = (st.st_size, st.st_mtime_ns)
    return out


def sig(path):
    try:
        st = os.stat(path)
        return [st.st_size, st.st_mtime_ns]
    except OSError:
        return None


def read(path):
    with open(path, "rb") as f:
        return f.read()


def write(path, data, mtime_ns=None):
    """Atomic write (the temp name is one Syncthing ignores); keeps mtime_ns when given."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = os.path.join(os.path.dirname(path), f".syncthing.{os.path.basename(path)}.{os.getpid()}.tmp")
    with open(tmp, "wb") as f:
        f.write(data)
    if mtime_ns is not None:
        os.utime(tmp, ns=(mtime_ns, mtime_ns))
    os.replace(tmp, path)


def remove(path, stop):
    """Delete path and the empty folders above it, up to stop."""
    try:
        os.remove(path)
    except OSError:
        return
    d = os.path.dirname(path)
    while d.startswith(stop + os.sep) and d != stop:
        try:
            os.rmdir(d)
        except OSError:
            break
        d = os.path.dirname(d)


# --- state -----------------------------------------------------------------

def load_state():
    try:
        with open(STATE) as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    for k in ("push", "local", "pull", "tombs"):
        s.setdefault(k, {})
    return s


def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATE)


def lock(wait):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    fd = open(STATE + ".lock", "w")
    end = time.time() + wait
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except OSError:
            if time.time() >= end:
                return None
            time.sleep(0.2)


def peers():
    try:
        return sorted(d for d in os.listdir(STAGE)
                      if d != HOST and not d.startswith(".") and os.path.isdir(os.path.join(STAGE, d)))
    except OSError:
        return []


def running_sids():
    """Sessions with a live process here: their files are left alone."""
    out = set()
    reg = os.path.join(CLAUDE, "sessions")
    try:
        names = os.listdir(reg)
    except OSError:
        return out
    for n in names:
        if n.endswith(".json"):
            try:
                with open(os.path.join(reg, n)) as f:
                    s = json.load(f)
                if os.path.exists(f"/proc/{int(s['pid'])}"):
                    out.add(s.get("sessionId"))
            except (OSError, ValueError, KeyError, TypeError):
                pass
    return out


def session_of(rel):
    """projects/<p>/<sid>.jsonl or projects/<p>/<sid>/... -> sid"""
    parts = rel.split("/")
    if len(parts) >= 3 and parts[0] == "projects":
        return parts[2][:-6] if len(parts) == 3 and parts[2].endswith(".jsonl") else parts[2]
    return ""


def tombs_all(state):
    """srel -> newest deletion time (ms) from any machine, this one included"""
    out = dict(state["tombs"])
    for h in peers():
        try:
            with open(os.path.join(STAGE, h, TOMBS)) as f:
                for k, v in json.load(f).items():
                    out[k] = max(out.get(k, 0), int(v))
        except (OSError, ValueError, AttributeError, TypeError):
            pass
    return out


# --- push ------------------------------------------------------------------

def push(state):
    mine = os.path.join(STAGE, HOST)
    os.makedirs(mine, exist_ok=True)
    files = walk(CLAUDE)
    n = 0
    for rel, sg in files.items():
        sg = list(sg)
        if state["local"].get(rel) == sg:
            continue                      # came from another machine, unchanged since
        dst = os.path.join(mine, to_stage(rel))
        if state["push"].get(rel) == sg and os.path.exists(dst):
            continue
        try:
            data = read(os.path.join(CLAUDE, rel)).replace(HOME_B, TOKEN)
        except OSError:
            continue
        write(dst, data, sg[1])
        state["push"][rel] = sg
        state["local"].pop(rel, None)
        state["tombs"].pop(to_stage(rel), None)
        n += 1
    # deleted here since they were synced: off the staging folder, and a
    # tombstone so the other machines drop their copies too
    gone = 0
    for table in ("push", "local"):
        for rel in [r for r in state[table] if r not in files]:
            srel = to_stage(rel)
            remove(os.path.join(mine, srel), mine)
            state["tombs"][srel] = now_ms()
            del state[table][rel]
            gone += 1
    cutoff = now_ms() - TOMB_DAYS * 86400000
    state["tombs"] = {k: v for k, v in state["tombs"].items() if v >= cutoff}
    try:
        with open(os.path.join(mine, TOMBS)) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = None
    if old != state["tombs"]:
        write(os.path.join(mine, TOMBS), json.dumps(state["tombs"]).encode())
    state["lastPush"] = now_ms()
    say(f"pushed {n} file(s), {gone} deletion(s) -> {mine}")


# --- pull ------------------------------------------------------------------

def pull(state, skip_sids=()):
    busy = running_sids() | set(skip_sids)
    tombs = tombs_all(state)
    # the newest copy of every file across the other machines
    best = {}
    for h in peers():
        hp = os.path.join(STAGE, h)
        seen = state["pull"].setdefault(h, {})
        for srel, sg in walk(hp).items():
            if srel == HISTORY or seen.get(srel) == list(sg):
                continue
            if srel not in best or sg[1] > best[srel][2][1]:
                best[srel] = (h, os.path.join(hp, srel), sg)
    got = conflicts = 0
    for srel, (h, src, sg) in sorted(best.items()):
        rel = to_local(srel)
        if session_of(rel) in busy:
            continue                      # running here: next time
        mark = lambda: state["pull"][h].__setitem__(srel, list(sg))
        if tombs.get(srel, 0) * 1000000 >= sg[1]:
            mark()                        # deleted somewhere after this copy was made
            continue
        try:
            data = read(src).replace(TOKEN, HOME_B)
        except OSError:
            continue
        dst = os.path.join(CLAUDE, rel)
        cur = None
        try:
            cur = read(dst)
        except OSError:
            pass
        take = False
        if cur is None:
            take = True
        elif cur == data:
            state["local"][rel] = sig(dst)
        elif rel.endswith(".jsonl"):
            if data.startswith(cur):
                take = True               # remote went on from where this one stops
            elif not cur.startswith(data):
                conflicts += conflict(dst, h, data, sg[1])
        else:
            lsig = sig(dst)
            synced = lsig in (state["local"].get(rel), state["push"].get(rel))
            if synced:
                take = sg[1] > lsig[1]
            elif sg[1] > lsig[1]:
                conflicts += conflict(dst, h, data, sg[1])
        if take:
            write(dst, data, sg[1])
            state["local"][rel] = sig(dst)
            state["push"].pop(rel, None)
            got += 1
        mark()
    # deletions made elsewhere, for copies nobody changed here since
    dropped = 0
    for srel, t in tombs.items():
        rel = to_local(srel)
        p = os.path.join(CLAUDE, rel)
        lsig = sig(p)
        if lsig is None or session_of(rel) in busy or lsig[1] > t * 1000000:
            continue
        if lsig in (state["local"].get(rel), state["push"].get(rel)):
            remove(p, CLAUDE)
            state["local"].pop(rel, None)
            state["push"].pop(rel, None)
            dropped += 1
    merged = merge_history()
    state["lastPull"] = now_ms()
    say(f"pulled {got} file(s), {dropped} deletion(s), {merged} history line(s), {conflicts} conflict(s)")


def conflict(dst, host, data, mtime_ns):
    p = f"{dst}.conflict-{host}"
    try:
        if read(p) == data:
            return 0
    except OSError:
        pass
    write(p, data, mtime_ns)
    say("conflict:", p)
    return 1


def history_lines(data):
    return [l for l in data.split(b"\n") if l.strip()]


def stamp(line):
    try:
        return int(json.loads(line).get("timestamp") or 0)
    except (ValueError, AttributeError, TypeError):
        return 0


def merge_history():
    """Add the other machines' prompt history lines to ours, in time order."""
    path = os.path.join(CLAUDE, HISTORY)
    for _ in range(3):                    # claude may append while we merge: retry
        before = sig(path)
        try:
            ours = history_lines(read(path))
        except OSError:
            ours = []
        have = set(ours)
        extra = []
        for h in peers():
            try:
                theirs = history_lines(read(os.path.join(STAGE, h, HISTORY)).replace(TOKEN, HOME_B))
            except OSError:
                continue
            for l in theirs:
                if l not in have:
                    have.add(l)
                    extra.append(l)
        if not extra:
            return 0
        lines = sorted(ours + extra, key=stamp)
        if sig(path) != before:
            continue
        write(path, b"\n".join(lines) + b"\n")
        return len(extra)
    return 0


# --- status ----------------------------------------------------------------

def list_conflicts():
    out = []
    for top in SCOPE:
        base = os.path.join(CLAUDE, top)
        for d, _, files in os.walk(base):
            out += [os.path.relpath(os.path.join(d, f), CLAUDE) for f in files if ".conflict-" in f]
    return sorted(out)


def status(state):
    files = walk(CLAUDE)
    pending = sum(1 for rel, sg in files.items()
                  if list(sg) not in (state["push"].get(rel), state["local"].get(rel)))
    ps = []
    for h in peers():
        hp = os.path.join(STAGE, h)
        stage = walk(hp)
        ps.append({"host": h, "files": len(stage),
                   "updated": max((sg[1] for sg in stage.values()), default=0) // 1000000})
    return {"enabled": os.path.isdir(STAGE), "host": HOST, "stage": STAGE,
            "lastPush": state.get("lastPush", 0), "lastPull": state.get("lastPull", 0),
            "pending": pending, "peers": ps, "conflicts": len(list_conflicts())}


def main():
    global quiet
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    flags = {a for a in sys.argv[1:] if a.startswith("-")}
    quiet = "-q" in flags or "--quiet" in flags
    skip = []
    if "--hook" in flags:
        quiet = True
        try:
            sid = json.loads(sys.stdin.read() or "{}").get("session_id", "")
            if re.fullmatch(r"[0-9a-f-]{36}", sid or ""):
                skip.append(sid)
        except ValueError:
            pass
    cmd = args[0] if args else ""
    if cmd == "init":
        os.makedirs(os.path.join(STAGE, HOST), exist_ok=True)
        say(f"staging folder: {os.path.join(STAGE, HOST)}  (share {STAGE} with your other machines)")
        return 0
    if cmd == "conflicts":
        for c in list_conflicts():
            print(c)
        return 0
    if cmd not in ("push", "pull", "sync", "status"):
        print(__doc__, file=sys.stderr)
        return 64
    if not os.path.isdir(STAGE):
        if cmd == "status":
            print(json.dumps({"enabled": False, "host": HOST, "stage": STAGE}))
        else:
            say(f"{STAGE} doesn't exist: run `claude-sync.py init` and share it (Syncthing)")
        return 0
    fd = lock(0 if cmd == "status" else 30)
    if fd is None and cmd != "status":
        say("another sync is running")
        return 0
    state = load_state()
    if cmd == "status":
        print(json.dumps(status(state)))
        return 0
    if cmd in ("pull", "sync"):
        pull(state, skip)
    if cmd in ("push", "sync"):
        push(state)
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
