"""DTH Character Studio — Houdini-side export runner.

Houdini runs a `456.py` found on HOUDINI_SCRIPT_PATH after a scene finishes
loading. The studio launches Houdini with its own scripts folder on that path
and `DTH_HOUDINI_JOB` pointing at a job file — the same handoff shape the Daz
side uses for the Runner plugin: the studio writes a JSON job, the other side
works through it and writes results back, the studio polls.

WITHOUT that environment variable this file does nothing at all, immediately.
That matters: HOUDINI_SCRIPT_PATH is only set on the process the studio spawns,
but even if it ever leaked into a normal session, an ordinary scene load must
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

The scene is never saved. Any parm this touches is restored afterwards.
"""

import json
import os
import time
import traceback

import hou

JOB_ENV = "DTH_HOUDINI_JOB"
EXPORT_TYPES = ("daztohueexport", "daztohuegroomexport")


def normalize(path):
    """Compare paths the way the studio does: slashes forward, case-folded."""
    return (path or "").replace("\\", "/").strip().lower()


def with_trailing_slash(path):
    """The HDA concatenates `export_directory + character_name`, so a missing
    separator silently produces `.../dth-exportsKira/`."""
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


class Report(object):
    """The result file. Written after every node so the studio's poll sees
    progress rather than one silent block and a result at the end."""

    def __init__(self, path, total):
        self.path = path
        self.data = {"version": 1, "state": "running", "total": total, "done": 0, "nodes": []}
        self.flush()

    def add(self, entry):
        self.data["nodes"].append(entry)
        self.data["done"] = len(self.data["nodes"])
        self.flush()

    def finish(self, state="done", error=""):
        self.data["state"] = state
        if error:
            self.data["error"] = error
        self.flush()

    def flush(self):
        if not self.path:
            return
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


def export_one(node, fallback_directory):
    """Trigger one export node. Returns the report entry for it."""
    entry = {"node": node.path(), "type": node.type().name(), "status": "ok", "problems": []}
    started = time.time()

    directory_parm = node.parm("export_directory")
    if directory_parm is None:
        entry["status"] = "skipped"
        entry["error"] = "the node has no export_directory parameter"
        return entry

    original = directory_parm.evalAsString()
    # RESPECT what the user configured: the project is theirs, and its export
    # directory is a deliberate choice. Only fill a blank one, and only when the
    # job supplied something to fill it with.
    directory = original or fallback_directory
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
        report.finish("done")
        return

    for node, source, label in targets:
        print("DTH Character Studio: exporting {} ({})".format(node.path(), label))
        entry = export_one(node, fallback)
        entry["scene"] = label
        entry["dth"] = source
        report.add(entry)
        print("DTH Character Studio: {} -> {}".format(node.path(), entry["status"]))
    report.finish("done")


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


main()
