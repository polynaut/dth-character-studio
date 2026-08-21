"""DTH Character Studio — Houdini-side export runner.

The studio launches HEADLESS hython via the sibling `headless_export.py`
bootstrap, which loads the scene and then RUNS THIS FILE explicitly (with
`DTH_HEADLESS` set), `DTH_HOUDINI_JOB` pointing at a job file — the same
handoff shape the Daz side uses for the Runner plugin: the studio writes a
JSON job, the other side works through it and writes results back, the studio
polls.

The studio deliberately does NOT put this file on HOUDINI_SCRIPT_PATH anymore.
MEASURED on the first headless run (2026-08-11): Houdini runs a `456.py` found
there on the INITIAL EMPTY scene at startup too, not only on a `.hip` load —
the job was consumed against the empty scene ("nothing to export" in 2 s), the
env popped, and `closeWhenDone` exited hython before the bootstrap ever loaded
the real project. The bootstrap's explicit exec is the only trigger now; the
GUI's scene-load mechanism still works if a user wires it up by hand, and the
window-wait machinery below exists for that shape.

WITHOUT `DTH_HOUDINI_JOB` this file does nothing at all, immediately. That
matters: even if it ever ran in a normal session, an ordinary scene load must
stay an ordinary scene load.

What it drives (all of it measured off the installed HDA, not assumed):

  * `export_trigger` is the "Export With Selected Options" button, on BOTH
    DazToHueExport and DazToHueGroomExport.
  * The HDA builds its output path as
    `export_directory.eval() + character_name + "/"` — a naive concatenation,
    so a directory we write MUST end in a slash or the character folder fuses
    onto the last segment.
  * `do_export` bails via `exit()` when export_directory is empty. That raises
    SystemExit, which would take the whole batch down, so a node without a
    usable directory is skipped HERE and never triggered.
  * `do_export` shows a "Continue anyway?" dialog when its pre-flight check
    finds problems. Headless that would crash; visible it would block the batch
    on a human. Either way we answer it ourselves and RECORD what it said, so
    the problems reach the studio's report instead of vanishing.
  * There is no PDG/TOP graph behind any of it, so `do_export` is synchronous:
    sequential really is one call after another.
  * 456.py fires after the SCENE loads but before the main window ever paints
    (measured 2026-08-03, the first live run): work done inline here blocks the
    window, so the whole batch ground through inside startup and Houdini
    "opened" only after the last node finished. And `hdefereval` alone does not
    fix that — startup pumps the event loop, so the deferred callback plus a
    fixed timer can still fire pre-paint on a slow scene load, and with
    `closeWhenDone` the run is then completely invisible (measured 2026-08-11).
    Hence the launch() at the bottom: defer, then WAIT FOR THE MAIN WINDOW to
    report visible, then breathe — Houdini is visibly open and interactive
    before the first export starts.

The batch can be INTERRUPTED from the studio: `cancelPath` in the job names a
flag file, and the loop checks it between nodes (see `stop_requested`). The
nodes it then never runs are reported as `skipped` and the result carries
`cancelled: true` — the studio reports an interrupted run as interrupted, never
as a batch that simply had less to do.

The scene is never saved. Any parm this touches is restored afterwards. With
`closeWhenDone` in the job (the DTH Export flow always sets it), the instance
closes itself again once the final result is on disk — it existed to carry
the batch, and a queue of projects must not stack open windows.
"""

import json
import os
import sys
import time
import traceback

import hou

JOB_ENV = "DTH_HOUDINI_JOB"
EXPORT_TYPES = ("daztohueexport", "daztohuegroomexport")

# The result file's live-activity channel is BOUNDED (the studio polls it, and
# a print-happy export must not grow it without limit): the rolling window the
# studio shows, the per-node tail kept in the final report, and how often the
# file is rewritten mid-node at most.
ACTIVITY_LINES_KEPT = 40
NODE_LOG_LINES_KEPT = 200
ACTIVITY_FLUSH_SECONDS = 0.5


def normalize(path):
    """Compare paths the way the studio does: slashes forward, case-folded —
    on the PHYSICAL path. `os.path.realpath` earns its keep three ways: it
    collapses the `..` hops in the `$HIP/../...`-style import paths the
    studio writes, it folds a mapped drive letter to its UNC target, and it
    resolves the junction spellings (`<houdini-project>/dth-exports/...`)
    that nodes in old .hip files still store from the retired junction era —
    none of which would string-match the job's canonical export path raw.
    Measured on Windows: safe, both sides of every compare get the same
    treatment — and it never raises on a path that does not exist."""
    cleaned = (path or "").strip()
    if not cleaned:
        return ""
    try:
        cleaned = os.path.realpath(cleaned)
    except (OSError, ValueError):
        pass
    return cleaned.replace("\\", "/").lower()


def with_trailing_slash(path):
    """The HDA concatenates `export_directory + character_name`, so a missing
    separator silently produces `.../exportKira/`."""
    cleaned = (path or "").replace("\\", "/").rstrip("/")
    return cleaned + "/" if cleaned else ""


def is_export_node(node):
    return node.type().name().lower() in EXPORT_TYPES


def upstream_import_node(node, limit=256):
    """THIS node's own DazToHueImport, found by walking its inputs upstream.

    An export node's payload arrives down the WIRE from its import node, so the
    import that feeds it is the one connected to it. Asking the export node's
    PARENT instead is only right when a subnet holds exactly one network —
    measured 2026-08-21 on a real project whose `/obj/DazToHue` held TWO
    complete networks side by side, where every export node answered with the
    FIRST import node's `.dth`.

    Breadth-first so the nearest import wins; a visited set and a hard limit so
    neither a cycle nor a very long chain can hang a run.
    """
    seen = set()
    queue = [node]
    while queue and len(seen) < limit:
        current = queue.pop(0)
        try:
            inputs = current.inputs()
        except Exception:
            continue
        for src in inputs:
            if src is None:
                continue
            try:
                key = src.path()
                name = src.type().name().lower()
            except Exception:
                continue
            if key in seen:
                continue
            seen.add(key)
            # `daztohuegroomimport` does NOT contain `daztohueimport`.
            if "daztohueimport" in name:
                return src
            queue.append(src)
    return None


def import_path_of(node):
    """The `.dth` THIS export node's network imports — the studio WROTE that
    file at a path it computes, which makes it an exact identity for the Daz
    scene behind this network. Far steadier than a node name, which the user
    may rename.

    Resolved from the NODE (its own wired import), falling back to the parent's
    SOLE import node when no wire can be followed. Two imports in one parent and
    no wire is '' — "cannot tell" — and `collect_targets` then leaves the node
    alone, which is the safe direction: exporting a network the user did not
    tick writes over a set this run was never asked to touch.
    """
    found = upstream_import_node(node)
    if found is None:
        try:
            children = node.parent().children()
        except Exception:
            return ""
        candidates = [
            child for child in children if "daztohueimport" in child.type().name().lower()
        ]
        if len(candidates) != 1:
            return ""
        found = candidates[0]
    parm = found.parm("import_character_dtu_file")
    return parm.evalAsString() if parm is not None else ""


class DialogAnswers(object):
    """Stands in for hou.ui's dialogs for the duration of one export.

    Answers every question with button 0 — for the pre-flight check that is
    "Yes, continue" — and keeps the text so the studio can show what was
    detected. Without this the batch either dies (headless: hou.ui does not
    exist) or waits forever on a click (visible).
    """

    def __init__(self):
        self.messages = []
        self._saved = {}

    def _record(self, message, *args, **kwargs):
        text = str(message).strip()
        if text:
            self.messages.append(text)
        return 0

    def __enter__(self):
        ui = getattr(hou, "ui", None)
        if ui is None:
            # Headless: manufacture just enough of hou.ui to get through
            # do_export's two calls (displayMessage and triggerUpdate).
            import types

            ui = types.ModuleType("ui")
            ui.displayMessage = self._record
            ui.triggerUpdate = lambda *a, **k: None
            hou.ui = ui
            self._saved = {"__module__": None}
            return self
        for name in ("displayMessage",):
            self._saved[name] = getattr(ui, name, None)
            setattr(ui, name, self._record)
        return self

    def __exit__(self, *exc):
        if "__module__" in self._saved:
            del hou.ui
            return False
        for name, original in self._saved.items():
            if original is not None:
                setattr(hou.ui, name, original)
        return False


class ActivityCapture(object):
    """Record every line the HDA emits while ONE export node runs — the only
    progress channel a synchronous `do_export` has. Three sources, all TEE'd
    (forwarded, never swallowed — the Houdini console keeps its own log):
    `sys.stdout` and `sys.stderr` (prints and tracebacks), and
    `hou.ui.setStatusMessage` (the status-bar updates an HDA shows the user).

    Deliberately broad, because what `do_export` actually emits is UNMEASURED
    until the first live run — capturing all three channels makes that run the
    probe: whatever arrives lands in the report; if nothing arrives, the studio
    simply keeps showing elapsed time.
    """

    def __init__(self, on_line):
        self._on_line = on_line
        self._saved_streams = []
        self._saved_status = None
        self.lines = []

    def _emit(self, text):
        line = str(text).strip()
        if not line:
            return
        self.lines.append(line)
        if len(self.lines) > NODE_LOG_LINES_KEPT:
            del self.lines[: len(self.lines) - NODE_LOG_LINES_KEPT]
        if self._on_line is not None:
            try:
                self._on_line(line)
            except Exception:
                pass

    class _Tee(object):
        def __init__(self, original, emit):
            self._original = original
            self._emit = emit
            self._buffer = ""

        def write(self, text):
            try:
                if self._original is not None:
                    self._original.write(text)
            except Exception:
                pass
            try:
                self._buffer += str(text)
                while "\n" in self._buffer:
                    line, self._buffer = self._buffer.split("\n", 1)
                    self._emit(line)
            except Exception:
                pass

        def flush(self):
            try:
                if self._original is not None:
                    self._original.flush()
            except Exception:
                pass

    def __enter__(self):
        for name in ("stdout", "stderr"):
            original = getattr(sys, name, None)
            self._saved_streams.append((name, original))
            setattr(sys, name, self._Tee(original, self._emit))
        # The status bar only exists with a UI; entered BEFORE DialogAnswers, so
        # its headless stand-in module is never mistaken for a real status bar.
        ui = getattr(hou, "ui", None)
        original_status = getattr(ui, "setStatusMessage", None) if ui is not None else None
        if original_status is not None:
            emit = self._emit

            def recording_status(message, *args, **kwargs):
                emit(message)
                try:
                    return original_status(message, *args, **kwargs)
                except Exception:
                    return None

            self._saved_status = original_status
            ui.setStatusMessage = recording_status
        return self

    def __exit__(self, *exc):
        for name, original in self._saved_streams:
            if original is not None:
                setattr(sys, name, original)
        if self._saved_status is not None:
            try:
                hou.ui.setStatusMessage = self._saved_status
            except Exception:
                pass
        return False


def network_box_label(node):
    """Title of the network box the node sits in, or ''.

    A project with several DazToHue networks has each wrapped in a titled
    network box — `LaraClassic`, `LaraNaked` — and that title is the only
    human-meaningful name the setup has: the nodes themselves are
    `DazToHueExport`, `…1`, `…2`. The visible title is the box's COMMENT
    (`name()` is an internal id), boxes live in the node's PARENT network, and
    they nest, so the innermost containing box wins. Same rule as the scan's
    `_network_box_label`, which is where it was measured.
    """

    def search(container, depth=0):
        try:
            boxes = container.networkBoxes()
        except Exception:
            return None
        best = None
        for box in boxes:
            try:
                members = box.nodes()
            except Exception:
                continue
            deeper = search(box, depth + 1)
            if deeper is not None:
                if best is None or deeper[1] > best[1]:
                    best = deeper
            elif node in members and (best is None or depth > best[1]):
                best = (box, depth)
        return best

    parent = node.parent()
    if parent is None:
        return ""
    found = search(parent)
    if found is None:
        return ""
    try:
        comment = (found[0].comment() or "").strip()
    except Exception:
        comment = ""
    return comment.splitlines()[0].strip() if comment else ""


class Report(object):
    """The result file. Written after every node so the studio's poll sees
    progress rather than one silent block and a result at the end — and, while
    a node is EXPORTING, rewritten (throttled) with the `activity` channel: the
    lines {@ActivityCapture} caught mid-`do_export`, so the studio can show
    what the minutes-long synchronous call is doing."""

    def __init__(self, path, total, targets=None):
        self.path = path
        self.data = {
            "version": 1,
            "state": "running",
            "total": total,
            "done": 0,
            "nodes": [],
            # WHAT this run will export, named, before any of it has happened.
            # The studio draws one task card per network and could only label
            # the ones already finished — everything ahead read as "Network 2",
            # which is a count where the user has a name. The run knows its
            # targets the moment it has collected them; it just never said so.
            "targets": targets or [],
        }
        self._last_flush = 0.0
        self.flush(force=True)

    def add(self, entry):
        self.data["nodes"].append(entry)
        self.data["done"] = len(self.data["nodes"])
        self.flush(force=True)

    def begin_activity(self, node_path, scene, dth=""):
        now_ms = int(time.time() * 1000)
        self.data["activity"] = {
            "node": node_path,
            "scene": scene,
            # The `.dth` the node's network imports — the run's identity for
            # the studio ("which export set is this working through?").
            "dth": dth,
            "lines": [],
            "startedAtMs": now_ms,
            "updatedAtMs": now_ms,
        }
        self.flush(force=True)

    def note_activity(self, line):
        activity = self.data.get("activity")
        if activity is None:
            return
        activity["lines"].append(line)
        if len(activity["lines"]) > ACTIVITY_LINES_KEPT:
            del activity["lines"][: len(activity["lines"]) - ACTIVITY_LINES_KEPT]
        activity["updatedAtMs"] = int(time.time() * 1000)
        self.flush()

    def end_activity(self):
        # The following add() carries the flush.
        self.data.pop("activity", None)

    def finish(self, state="done", error="", cancelled=False):
        self.data["state"] = state
        self.data.pop("activity", None)
        if error:
            self.data["error"] = error
        if cancelled:
            self.data["cancelled"] = True
        self.flush(force=True)

    def flush(self, force=False):
        if not self.path:
            return
        # Throttled between nodes' boundary writes: a print-happy do_export
        # would otherwise rewrite the file per line.
        now = time.time()
        if not force and now - self._last_flush < ACTIVITY_FLUSH_SECONDS:
            return
        self._last_flush = now
        try:
            # Write-then-rename: the studio polls this file, and a half-written
            # JSON would parse as garbage exactly once per run.
            temporary = self.path + ".tmp"
            with open(temporary, "w", encoding="utf-8") as handle:
                json.dump(self.data, handle, indent=2)
            if os.path.exists(self.path):
                os.remove(self.path)
            os.rename(temporary, self.path)
        except Exception:
            pass


def stop_requested(cancel_path):
    """Has the studio asked this run to stop?

    The signal is the mere existence of the flag file the studio drops (the
    SAME one the Daz leg's generated scripts probe — one export run is one
    thing to stop). Checked only BETWEEN nodes: `do_export` is synchronous and
    owns the main thread from its first call, so there is no point inside it
    where this could be asked, let alone answered.

    Best-effort: a path we cannot stat reads as "not cancelled". The dangerous
    answer here is the false positive — it would abandon a batch nobody asked
    to stop.
    """
    if not cancel_path:
        return False
    try:
        return os.path.exists(cancel_path)
    except (OSError, ValueError):
        return False


def collect_targets(wanted):
    """Every export node whose network imports one of the wanted `.dth` files.

    `wanted` maps a normalized .dth path to the studio's label for that scene.
    A project can hold several DazToHue networks — for different characters or
    different scenes of one character — and a run must touch only the scenes the
    user actually ticked, so a network whose import is not in the map is left
    alone. Ordered by node path: deterministic, and the report is readable.
    """
    targets = []
    for node in hou.node("/obj").allSubChildren():
        if not is_export_node(node):
            continue
        source = normalize(import_path_of(node))
        label = wanted.get(source)
        if label is None:
            continue
        targets.append((node, source, label))
    targets.sort(key=lambda item: item[0].path())
    return targets


# What a SWALLOWED failure looks like in the captured stream.
#
# `pressButton()` runs the HDA's callback through Houdini's own wrapper, and
# that wrapper CATCHES whatever the script raises: it prints the traceback and
# returns normally. So `export_one`'s try/except never fires and the node was
# reported "ok" no matter what happened inside. Measured 2026-08-19 on a
# project whose PoseAsset CSV was missing: both export nodes died on
# `AttributeError: 'NoneType' object has no attribute 'attribValue'`, both were
# reported ok, and the studio's toast said "2 exported in 17s" over an export
# that wrote nothing. A false success is the most expensive answer this script
# can give -- it sends the user looking anywhere but here.
#
# So the captured text is evidence, not just log colour. These are Houdini's
# own wrapper headings plus the Python traceback banner; matched
# case-insensitively on the tee'd stdout+stderr.
SWALLOWED_FAILURE_MARKERS = (
    "error running callback",
    "error running event handler",
    "traceback (most recent call last)",
)


def swallowed_failure(lines):
    """The most INFORMATIVE line of a swallowed blow-up, or None.

    A marker line alone can be information-free ("Traceback (most recent call
    last):" says only that something died), so once one is found, the LAST
    captured line is preferred - a printed traceback ends with the exception
    itself ("AttributeError: ...", the line worth reading) and the capture
    stops when the callback does.

    Kept dumb on purpose: any marker means the run cannot be called clean, and
    being wrong in the SAFE direction (reporting a failure that was
    survivable) costs a look at the log, while being wrong the other way costs
    the whole afternoon this was measured in. The capture is tail-capped
    (NODE_LOG_LINES_KEPT); a marker evicted by a chatty export past the error
    is caught by the studio-side console-log backstop instead
    (houdiniConsoleFailure in houdini-jobs.ts - keep the marker lists in
    step)."""
    found = None
    for line in lines:
        low = str(line).lower()
        for marker in SWALLOWED_FAILURE_MARKERS:
            if marker in low:
                found = str(line)
                break
        if found is not None:
            break
    if found is None:
        return None
    last = str(lines[-1]) if lines else found
    return found if last == found else "{} ... {}".format(found, last)


def export_one(node, fallback_directory, on_line=None):
    """Trigger one export node. Returns the report entry for it. `on_line`
    receives every line the HDA emits mid-export (see ActivityCapture)."""
    entry = {"node": node.path(), "type": node.type().name(), "status": "ok", "problems": []}
    started = time.time()
    activity = ActivityCapture(on_line)

    directory_parm = node.parm("export_directory")
    if directory_parm is None:
        entry["status"] = "skipped"
        entry["error"] = "the node has no export_directory parameter"
        return entry

    original = directory_parm.evalAsString()
    # RESPECT what the user configured: the project is theirs, and its export
    # directory is a deliberate choice. Only fill a blank one, and only when the
    # job supplied something to fill it with. Blank means blank AFTER strip —
    # the same rule material_utils' prefill uses, so "  " can't dodge the fill
    # and then be skipped below.
    directory = (original.strip() and original) or fallback_directory
    if not directory.strip():
        entry["status"] = "skipped"
        entry["error"] = "no export directory set on the node, and the job supplied none"
        return entry

    changed = False
    try:
        wanted = with_trailing_slash(directory)
        if wanted != original:
            directory_parm.set(wanted)
            changed = True
        hou.setPwd(node)
        with activity:
            with DialogAnswers() as dialogs:
                node.parm("export_trigger").pressButton()
            entry["problems"] = dialogs.messages
        # The button "returned" — which proves nothing (see
        # SWALLOWED_FAILURE_MARKERS). Ask what it printed on the way.
        blew_up = swallowed_failure(activity.lines)
        if blew_up is not None:
            entry["status"] = "failed"
            entry["error"] = "the HDA raised behind Houdini's callback wrapper: {}".format(blew_up)
    except SystemExit:
        # do_export's own `exit()` guard. Pre-checked above, so reaching this
        # means the HDA bailed for a reason of its own — one node's bail must
        # never end the batch.
        entry["status"] = "failed"
        entry["error"] = "the HDA aborted the export (exit)"
    except Exception as error:
        entry["status"] = "failed"
        entry["error"] = "{}: {}".format(type(error).__name__, error)
        entry["traceback"] = traceback.format_exc()
    finally:
        if changed:
            # Leave the scene as we found it — the studio never saves it, but a
            # modified parm would mark it dirty under the user's hands.
            try:
                directory_parm.set(original)
            except Exception:
                pass
        entry["seconds"] = round(time.time() - started, 1)
        # The node's captured output rides its report entry (tail-capped) — the
        # per-node record of what the HDA said, surviving after the live
        # `activity` window has moved on.
        if activity.lines:
            entry["log"] = list(activity.lines)
    return entry


def run(job):
    wanted = {}
    for scene in job.get("scenes", []):
        key = normalize(scene.get("dth", ""))
        if key:
            wanted[key] = scene.get("label", key)
    fallback = with_trailing_slash(job.get("exportDirectory", ""))

    targets = collect_targets(wanted)
    # The network box's title is the name the user gave this network; the scene
    # is what the studio calls it; the node path is the last resort and always
    # exists.
    labels = [
        {
            "node": node.path(),
            "scene": label,
            "box": network_box_label(node),
        }
        for node, _source, label in targets
    ]
    report = Report(job.get("resultPath", ""), len(targets), labels)
    print("DTH Character Studio: {} export node(s) match the selected scenes".format(len(targets)))

    if not targets:
        # Not an error: the project may simply hold no network for these scenes.
        # But say WHY into the console log — the first headless run burned an
        # afternoon on a bare "nothing to export": what was wanted, what export
        # nodes exist at all (none = the DazToHue otls likely didn't load in
        # this session), and what each one's network imports.
        for key in sorted(wanted):
            print("DTH Character Studio: wanted .dth import: {} ({})".format(key, wanted[key]))
        found_any = False
        for node in hou.node("/obj").allSubChildren():
            if not is_export_node(node):
                continue
            found_any = True
            print("DTH Character Studio: export node {} imports {}".format(
                node.path(), normalize(import_path_of(node)) or "(nothing)"))
        if not found_any:
            print("DTH Character Studio: the scene has NO DazToHue export nodes at all - "
                  "did the DazToHue otls load in this session? (scene: {})".format(
                      hou.hipFile.path()))
        report.finish("done")
        return

    cancel_path = job.get("cancelPath", "")
    cancelled = False
    for node, source, label in targets:
        # The one interrupt point this leg has, and it is a real one: every
        # node is a fresh export of its own, so stopping before the next leaves
        # nothing half-written. The nodes never reached are still REPORTED (as
        # skipped, with the reason) — a run that silently shortened its own
        # batch would read as "there was nothing else to do".
        if not cancelled and stop_requested(cancel_path):
            cancelled = True
            print("DTH Character Studio: interrupted by the studio - stopping before {}".format(
                node.path()))
        if cancelled:
            report.add({
                "node": node.path(),
                "type": node.type().name(),
                "status": "skipped",
                "problems": [],
                "error": "the export was interrupted",
                "seconds": 0,
                "scene": label,
                "dth": source,
            })
            continue
        print("DTH Character Studio: exporting {} ({})".format(node.path(), label))
        # The live-activity window: whatever the HDA emits during this node's
        # do_export streams into the polled result file as it happens.
        report.begin_activity(node.path(), label, source)
        entry = export_one(node, fallback, report.note_activity)
        report.end_activity()
        entry["scene"] = label
        entry["dth"] = source
        report.add(entry)
        print("DTH Character Studio: {} -> {}".format(node.path(), entry["status"]))
    # One last look, so a stop that lands during the FINAL node is still
    # reported as an interrupt rather than as an ordinary finish.
    cancelled = cancelled or stop_requested(cancel_path)
    report.finish("done", cancelled=cancelled)


def close_houdini():
    """Close the instance the batch ran in — from INSIDE it, so a Houdini the
    user had open on their own is never touched. `suppress_save_prompt` is
    mandatory: the scene is deliberately never saved, and an unattended exit
    must not hang on the save dialog (every touched parm was restored, but a
    cook alone can mark the scene dirty). Runs strictly AFTER the final result
    flush — the studio's poll reads the file from disk, so a finished result
    survives the exit."""
    print("DTH Character Studio: batch finished - closing Houdini")
    try:
        hou.exit(exit_code=0, suppress_save_prompt=True)
    except Exception:
        print("DTH Character Studio: could not close Houdini\n" + traceback.format_exc())


def main():
    job_path = os.environ.get(JOB_ENV, "")
    if not job_path or not os.path.isfile(job_path):
        return
    try:
        with open(job_path, "r", encoding="utf-8") as handle:
            job = json.load(handle)
    except Exception as error:
        print("DTH Character Studio: unreadable job file: {}".format(error))
        return
    # One job runs ONCE. 456.py fires on every scene load, and without this a
    # user opening another scene in the same session would re-run the batch.
    try:
        os.environ.pop(JOB_ENV, None)
    except Exception:
        pass
    try:
        run(job)
    except Exception:
        print("DTH Character Studio: export run failed\n" + traceback.format_exc())
        try:
            Report(job.get("resultPath", ""), 0).finish("failed", traceback.format_exc())
        except Exception:
            pass
    # Close on EVERY completed run, crashed included: the report carries the
    # traceback, the run is unattended, and a queue of projects must not stack
    # windows. A run that never got here (Houdini itself died) can't close —
    # the studio's liveness poll covers that side.
    if job.get("closeWhenDone"):
        close_houdini()


# Once the UI is up, the batch waits this much longer before starting:
# `do_export` hogs the main thread from its first call, and the freshly opened
# viewport needs a moment to finish its first cook — textures included — or
# the user watches the whole export against a clay-white figure.
STARTUP_BREATHER_MS = 10000

# The main-window wait below polls at this cadence, bounded so a session whose
# window never reports visible still exports instead of idling forever.
WINDOW_POLL_MS = 500
WINDOW_WAIT_ATTEMPTS = 240  # × 500 ms = 2 minutes


def launch():
    """Run the batch AFTER Houdini's main window is visibly open, not during
    startup.

    456.py executes inside the startup sequence, before the main window paints
    — inline work here holds the whole window back (the batch ran to the last
    node against a blank screen on the first live run). `hdefereval
    .executeDeferred` is Houdini's own "run this once the UI is up and idle"
    idiom — but it is NOT a paint guarantee: the startup sequence pumps the
    event loop (the splash screen updates through it), so the deferred callback
    can fire while the scene is still loading, and a fixed timer from there
    LOSES THE RACE against a slow first load — the batch then seizes the UI
    thread before the window ever paints, and with `closeWhenDone` the whole
    run comes and goes without a window (measured 2026-08-11: a four-minute
    export, delivered, fully invisible). So the breather only STARTS once
    `hou.qt.mainWindow().isVisible()` says the window is actually up, polled on
    a Qt timer (a sleep would freeze the very event loop this waits on) and
    bounded by WINDOW_WAIT_ATTEMPTS — a session whose window never shows still
    exports. The studio's result-file watch covers progress either way
    ("Houdini starting…" simply lasts until the batch writes its first state).
    Without hdefereval (hython / no UI event loop) there is no window to wait
    for — run inline, exactly as before. A session with no job keeps the
    do-nothing-immediately promise: nothing is scheduled at all."""
    if not os.environ.get(JOB_ENV, ""):
        return
    # The studio's headless hython launch (headless_export.py sets the flag):
    # no window to wait for, no event loop to defer into — run inline, now.
    # Explicit rather than trusting the hdefereval import to fail under hython,
    # because an import that SUCCEEDS without a UI event loop would defer the
    # batch into a callback that never fires.
    if os.environ.get("DTH_HEADLESS", ""):
        main()
        return
    try:
        import hdefereval
    except Exception:
        main()
        return

    def breathe():
        # Houdini 20.5+ ships PySide6, older builds PySide2 — try both; with
        # neither (unlikely in a GUI session) the deferral alone has to do.
        try:
            from PySide6.QtCore import QTimer
        except Exception:
            try:
                from PySide2.QtCore import QTimer
            except Exception:
                main()
                return

        state = {"attempts": WINDOW_WAIT_ATTEMPTS}

        def poll():
            visible = False
            try:
                window = hou.qt.mainWindow()
                visible = bool(window is not None and window.isVisible())
            except Exception:
                # Can't tell — don't hold the batch hostage on a probe.
                visible = True
            state["attempts"] -= 1
            if visible or state["attempts"] <= 0:
                QTimer.singleShot(STARTUP_BREATHER_MS, main)
            else:
                QTimer.singleShot(WINDOW_POLL_MS, poll)

        poll()

    hdefereval.executeDeferred(breathe)


launch()
