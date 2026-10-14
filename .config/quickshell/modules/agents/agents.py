#!/usr/bin/env python3
"""Claude Code sessions for the bar's agents chip (Agents.qml).

  agents.py scan          JSON list of running sessions on stdout
  agents.py serve         stay up: a "scan" line on stdin answers with the scan, a "list"
                          line with {"convos": [...]}, one JSON line each (what the bar
                          uses; exits when stdin closes, i.e. with qs)
  agents.py convos        JSON list of every saved conversation, newest first
  agents.py delete SID    move conversation SID (transcript + its folder) to the Trash;
                          refused while it runs
  agents.py focus PID     focus the terminal window that PID runs in (Hyprland or niri)
  agents.py attached NAME focus a terminal attached to kept session NAME (exit 1: none)

A session is "kept" when it runs inside the private tmux server (`tmux -L claude`,
config agents/tmux.conf): closing its terminal only detaches it, and the bar can open
it again. Other sessions live and die with their terminal.

Live state comes from Claude Code's session registry (~/.claude/sessions/<pid>.json:
status busy / idle / waiting), titles from the transcript's latest "ai-title" record.
Both are internal formats, so everything here degrades to "unknown" rather than failing.
Standard library only.
"""
import json
import os
import re
import subprocess
import sys

CLAUDE = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
TRASH = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "Trash")
TMUX = ["tmux", "-L", "claude"]
TITLE_TAIL = 512 * 1024          # bytes of a transcript searched for its title
HEAD_LINES = 200                 # records read from a transcript's start for its cwd and prompt


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def ppid(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        return 0


def ancestors(pid):
    out = []
    while pid > 1 and len(out) < 64:
        out.append(pid)
        pid = ppid(pid)
    return out


def proc_start(pid):
    """Field 22 of /proc/PID/stat (start time in clock ticks), to spot reused pids."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


_titles = {}                     # transcript path -> (size searched up to, title found), for serve


def title(cwd, sid, path=None):
    """The newest ai-title / custom title in the session's transcript."""
    if path is None:
        proj = re.sub(r"[^A-Za-z0-9]", "-", cwd)
        path = os.path.join(CLAUDE, "projects", proj, f"{sid}.jsonl")
    seen, found = _titles.get(path, (0, ""))
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            if size == seen:
                return _decode(found)
            if size < seen:                              # rewritten: start over
                seen, found = 0, ""
            # only what was appended since the last look (a little overlap
            # for a record cut in half last time), else the tail
            f.seek(max(0, size - TITLE_TAIL, seen - 4096))
            tail = f.read().decode("utf-8", "replace")
    except OSError:
        return ""
    for m in re.finditer(r'"(?:customTitle|aiTitle)"\s*:\s*"((?:[^"\\]|\\.)*)"', tail):
        found = m.group(1)
    _titles[path] = (size, found)
    return _decode(found)


def _decode(found):
    try:
        return json.loads(f'"{found}"') if found else ""
    except ValueError:
        return found


def tmux_socket():
    base = os.environ.get("TMUX_TMPDIR") or "/tmp"
    return os.path.join(base, f"tmux-{os.getuid()}", "claude")


def tmux_panes():
    """pane pid -> {session, attached, created}"""
    panes = {}
    if not os.path.exists(tmux_socket()):
        return panes                                     # no kept sessions: skip the fork
    fmt = "#{pane_pid}\t#{session_name}\t#{session_attached}\t#{session_created}\t#{pane_current_path}"
    for line in run(TMUX + ["list-panes", "-a", "-F", fmt]).splitlines():
        f = line.split("\t")
        if len(f) == 5 and f[0].isdigit():
            panes[int(f[0])] = {"pid": int(f[0]), "session": f[1], "attached": int(f[2] or 0),
                                "created": int(f[3] or 0), "cwd": f[4]}
    return panes


def argv(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return [a.decode("utf-8", "replace") for a in f.read().split(b"\0") if a]
    except OSError:
        return []


def proc_state(pid):
    """R/S/Z/... from /proc/PID/stat, "" when it's gone."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0]
    except (OSError, IndexError):
        return ""


def scan():
    """Running sessions, as a list of dicts."""
    panes = tmux_panes()
    out = []
    reg = os.path.join(CLAUDE, "sessions")
    try:
        names = os.listdir(reg)
    except OSError:
        names = []
    seen_tmux = set()
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(reg, name)) as f:
                s = json.load(f)
            pid = int(s["pid"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if not os.path.exists(f"/proc/{pid}"):
            continue
        if s.get("procStart") and proc_start(pid) not in (None, str(s["procStart"])):
            continue                                    # the pid was reused
        job = s.get("kind") == "bg"                     # a background job: runs under a session
        if s.get("kind") not in (None, "interactive") and not job:
            continue                                    # skip `claude -p` runs and the like
        chain = ancestors(pid)
        pane = next((panes[p] for p in chain if p in panes), None)
        if pane and not job:
            seen_tmux.add(pane["session"])
        cwd = s.get("cwd") or ""
        out.append({
            "pid": pid,
            "sid": s.get("sessionId", ""),
            "cwd": cwd,
            "title": title(cwd, s.get("sessionId", "")) or s.get("name") or os.path.basename(cwd) or "claude",
            "status": s.get("status") or "unknown",
            "since": s.get("statusUpdatedAt") or s.get("updatedAt") or 0,
            "started": s.get("startedAt") or 0,
            # a job is opened through the session it runs in, never stopped from here
            "tmux": pane["session"] if pane and not job else "",
            "host": pane["session"] if pane and job else "",
            "job": job,
            "attached": pane["attached"] if pane else 1,
        })
    # kept sessions whose claude hasn't registered yet: Claude Code only writes its
    # registry entry once past the start screen (e.g. the "trust this folder?" prompt).
    # A pane running a subcommand (`claude agents`, the sessions view) never registers:
    # it's listed as a view, not a session, so it can't sit there as "New session"
    for p in panes.values():
        if p["session"] in seen_tmux:
            continue
        state = proc_state(p["pid"])
        if state in ("", "Z", "X"):
            continue                                     # claude already exited
        seen_tmux.add(p["session"])
        args = argv(p["pid"])
        sub = args[1] if len(args) > 1 and not args[1].startswith("-") else ""
        name, status = "New session", "new"
        if sub:
            name, status = ("Agents view" if sub == "agents" else "claude " + sub), "view"
        out.append({"pid": 0, "sid": "", "cwd": p["cwd"], "title": name, "status": status,
                    "since": p["created"] * 1000, "started": p["created"] * 1000,
                    "tmux": p["session"], "host": "", "job": False, "attached": p["attached"]})
    out.sort(key=lambda x: x["started"])
    return out


def serve():
    for line in sys.stdin:
        if line.strip() == "scan":
            print(json.dumps(scan()), flush=True)
        elif line.strip() == "list":
            print(json.dumps({"convos": convos()}), flush=True)


def running_sids():
    """Session ids with a live claude process."""
    out = set()
    reg = os.path.join(CLAUDE, "sessions")
    try:
        names = os.listdir(reg)
    except OSError:
        return out
    for name in names:
        if name.endswith(".json"):
            try:
                with open(os.path.join(reg, name)) as f:
                    s = json.load(f)
                if os.path.exists(f"/proc/{int(s['pid'])}"):
                    out.add(s.get("sessionId"))
            except (OSError, ValueError, KeyError, TypeError):
                pass
    return out


def _prompt_text(rec):
    """The words of a user record, "" for tool results, commands and other plumbing."""
    if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isSidechain"):
        return ""
    content = (rec.get("message") or {}).get("content")
    if isinstance(content, list):
        content = " ".join(c.get("text", "") for c in content
                           if isinstance(c, dict) and c.get("type") == "text")
    if not isinstance(content, str):
        return ""
    content = content.strip()
    if not content or content.startswith("<"):        # <command-name>, <local-command-stdout>, ...
        return ""
    return " ".join(content.split())[:300]


_heads = {}                      # transcript path -> (cwd, first prompt), for serve


def head(path):
    """(cwd, first prompt) from the start of a transcript."""
    if path in _heads and _heads[path][1]:
        return _heads[path]
    cwd, prompt = "", ""
    try:
        with open(path, "rb") as f:
            for _ in range(HEAD_LINES):
                line = f.readline()
                if not line:
                    break
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(rec, dict):
                    continue
                cwd = cwd or rec.get("cwd") or ""
                prompt = prompt or _prompt_text(rec)
                if cwd and prompt:
                    break
    except OSError:
        pass
    _heads[path] = (cwd, prompt)
    return cwd, prompt


def convos():
    """Every saved conversation: [{sid, cwd, title, prompt, mtime, found}], newest first.
    Transcripts without a single message (opened and quit, or the title-only stubs
    Claude Code leaves for named agents) aren't conversations."""
    files = []
    root = os.path.join(CLAUDE, "projects")
    try:
        dirs = os.listdir(root)
    except OSError:
        dirs = []
    for d in dirs:
        full = os.path.join(root, d)
        try:
            names = os.listdir(full)
        except OSError:
            continue
        for f in names:
            if f.endswith(".jsonl") and re.fullmatch(r"[0-9a-f-]{36}", f[:-6]):
                p = os.path.join(full, f)
                try:
                    files.append((os.path.getmtime(p), p))
                except OSError:
                    pass
    out = []
    for mtime, p in sorted(files, reverse=True):
        sid = os.path.basename(p)[:-6]
        cwd, prompt = head(p)
        if not cwd:
            continue
        t = title(cwd, sid, p)
        out.append({"sid": sid, "cwd": cwd, "title": t or prompt, "prompt": prompt,
                    "mtime": int(mtime * 1000), "found": os.path.isdir(cwd)})
    return out


def _trash(path):
    """Move path into the XDG Trash (restorable from a file manager)."""
    import shutil
    import time
    from urllib.parse import quote
    files, info = os.path.join(TRASH, "files"), os.path.join(TRASH, "info")
    os.makedirs(files, exist_ok=True)
    os.makedirs(info, exist_ok=True)
    base = name = os.path.basename(path)
    n = 1
    while os.path.lexists(os.path.join(files, name)) or os.path.lexists(os.path.join(info, name + ".trashinfo")):
        n += 1
        name = f"{base}.{n}"
    with open(os.path.join(info, name + ".trashinfo"), "x") as f:
        f.write(f"[Trash Info]\nPath={quote(os.path.abspath(path))}\n"
                f"DeletionDate={time.strftime('%Y-%m-%dT%H:%M:%S')}\n")
    shutil.move(path, os.path.join(files, name))


def delete(sid):
    """Trash a conversation: its transcript, the folder beside it (subagents, tool output)
    and side copies of the transcript (<sid>.orphaned-*.jsonl, sync's <sid>.jsonl.conflict-*)."""
    if sid in running_sids():
        print("agents.py: that session is running; stop it first", file=sys.stderr)
        return 1
    root = os.path.join(CLAUDE, "projects")
    found = 0
    try:
        dirs = os.listdir(root)
    except OSError:
        dirs = []
    for d in dirs:
        try:
            names = os.listdir(os.path.join(root, d))
        except OSError:
            continue
        for name in names:
            if name == sid or name.startswith(sid + "."):
                _trash(os.path.join(root, d, name))
                found += 1
    return 0 if found else 1


def attached(name):
    for line in run(TMUX + ["list-clients", "-t", name, "-F", "#{client_pid}"]).splitlines():
        if line.strip().isdigit() and focus(int(line)) == 0:
            return 0
    return 1


def focus(pid):
    """Focus the window of the nearest ancestor that owns one."""
    chain = ancestors(pid)
    if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        try:
            clients = json.loads(run(["hyprctl", "-j", "clients"]) or "[]")
        except ValueError:
            return 1
        by_pid = {c.get("pid"): c.get("address") for c in clients}
        for p in chain:
            addr = by_pid.get(p)
            if addr and re.fullmatch(r"0x[0-9a-f]+", addr):
                run(["hyprctl", "dispatch", f'hl.dsp.focus({{ window = "address:{addr}" }})'])
                return 0
    elif os.environ.get("NIRI_SOCKET"):
        try:
            wins = json.loads(run(["niri", "msg", "--json", "windows"]) or "[]")
        except ValueError:
            return 1
        by_pid = {w.get("pid"): w.get("id") for w in wins}
        for p in chain:
            wid = by_pid.get(p)
            if isinstance(wid, int):
                run(["niri", "msg", "action", "focus-window", "--id", str(wid)])
                return 0
    return 1


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "scan":
        print(json.dumps(scan()))
        return 0
    if len(sys.argv) >= 2 and sys.argv[1] == "serve":
        serve()
        return 0
    if len(sys.argv) >= 2 and sys.argv[1] == "convos":
        print(json.dumps(convos()))
        return 0
    if len(sys.argv) == 3 and sys.argv[1] == "focus" and sys.argv[2].isdigit():
        return focus(int(sys.argv[2]))
    if len(sys.argv) == 3 and sys.argv[1] == "delete" and re.fullmatch(r"[0-9a-f-]{36}", sys.argv[2]):
        return delete(sys.argv[2])
    if len(sys.argv) == 3 and sys.argv[1] == "attached" and re.fullmatch(r"[A-Za-z0-9_.-]+", sys.argv[2]):
        return attached(sys.argv[2])
    print(__doc__, file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main())
