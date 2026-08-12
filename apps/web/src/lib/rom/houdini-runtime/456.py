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


def import_path_of(network):
    """The `.dth` a network imports — the studio WROTE that file at a path it
    computes, which makes it an exact identity for the Daz scene behind this
    network. Far steadier than a node name, which the user may rename."""
    for node in network.children():
        if "daztohueimport" not in node.type().name().lower():
            continue
        parm = node.parm("import_character_dtu_file")
        if parm is not None:
            return parm.evalAsString()
    return ""


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


class Report(object):
    """The result file. Written after every node so the studio's poll sees
    progress rather than one silent block and a result at the end — and, while
    a node is EXPORTING, rewritten (throttled) with the `activity` channel: the
    lines {@ActivityCapture} caught mid-`do_export`, so the studio can show
    what the minutes-long synchronous call is doing."""

    def __init__(self, path, total):
        self.path = path
        self.data = {"version": 1, "state": "running", "total": total, "done": 0, "nodes": []}
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

    def finish(self, state="done", error=""):
        self.data["state"] = state
        self.data.pop("activity", None)
        if error:
            self.data["error"] = error
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
        source = normalize(import_path_of(node.parent()))
        label = wanted.get(source)
        if label is None:
            continue
        targets.append((node, source, label))
    targets.sort(key=lambda item: item[0].path())
    return targets


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
    report = Report(job.get("resultPath", ""), len(targets))
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
                node.path(), normalize(import_path_of(node.parent())) or "(nothing)"))
        if not found_any:
            print("DTH Character Studio: the scene has NO DazToHue export nodes at all - "
                  "did the DazToHue otls load in this session? (scene: {})".format(
                      hou.hipFile.path()))
        report.finish("done")
        return

    for node, source, label in targets:
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
    report.finish("done")


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
