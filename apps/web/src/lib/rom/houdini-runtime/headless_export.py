"""DTH Character Studio — headless export bootstrap.

The studio runs the "Export too" batch through `hython <this file>` now — no
Houdini window at all. The job contract is unchanged (`DTH_HOUDINI_JOB` names
the job file, the sibling `456.py` works through it and writes the polled
result); this file only supplies what a GUI session got for free: loading the
`.hip` (`DTH_HOUDINI_HIP`) and then making sure `456.py` runs exactly once.

Why a bootstrap instead of trusting the `456.py` scene-load mechanism: whether
`hou.hipFile.load()` under hython fires the on-load scripts is a version
detail the studio has not measured. Both cases are safe here — `456.py` pops
`DTH_HOUDINI_JOB` when it runs, so if the load already triggered it, the
explicit run below finds no job and does nothing at all.

`DTH_HEADLESS` tells `456.py` to run its batch inline (there is no main window
to wait for and no event loop to defer into). A scene that fails to load still
reports: the failure is written to the job's result file, so the studio shows
the reason instead of a generic "the run died".
"""

import json
import os
import traceback

import hou

JOB_ENV = "DTH_HOUDINI_JOB"
HIP_ENV = "DTH_HOUDINI_HIP"


def write_failure(job_path, message):
    """Best-effort failed result, so the studio's poll reports the REASON."""
    try:
        with open(job_path, "r", encoding="utf-8") as handle:
            job = json.load(handle)
        result_path = job.get("resultPath", "")
        if not result_path:
            return
        temporary = result_path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(
                {"version": 1, "state": "failed", "total": 0, "done": 0, "nodes": [], "error": message},
                handle,
                indent=2,
            )
        if os.path.exists(result_path):
            os.remove(result_path)
        os.rename(temporary, result_path)
    except Exception:
        pass


def main():
    job_path = os.environ.get(JOB_ENV, "")
    scene = os.environ.get(HIP_ENV, "")
    if not job_path or not os.path.isfile(job_path):
        print("DTH Character Studio: no job file ({!r}) - nothing to do".format(job_path))
        return
    if not scene or not os.path.isfile(scene):
        message = "The Houdini project file is missing: {}".format(scene)
        print("DTH Character Studio: " + message)
        write_failure(job_path, message)
        return
    print("DTH Character Studio: loading {} (headless)".format(scene))
    try:
        hou.hipFile.load(scene, suppress_save_prompt=True, ignore_load_warnings=True)
    except hou.LoadWarning as warning:
        # Warnings are a loaded scene — the batch proceeds, the console log keeps them.
        print("DTH Character Studio: scene loaded with warnings: {}".format(warning))
    except Exception:
        message = "The Houdini project could not be loaded:\n" + traceback.format_exc()
        print("DTH Character Studio: " + message)
        write_failure(job_path, message)
        return
    # Run 456.py — unless the scene load already triggered it (it pops the job
    # env when it runs, which is what makes this attempt a no-op then).
    if not os.environ.get(JOB_ENV, ""):
        print("DTH Character Studio: the scene load already ran the batch")
        return
    runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), "456.py")
    try:
        with open(runner, "r", encoding="utf-8") as handle:
            source = handle.read()
        exec(compile(source, runner, "exec"), {"__file__": runner, "__name__": "__dth_456__"})
    except Exception:
        message = "The export batch crashed before it could report:\n" + traceback.format_exc()
        print("DTH Character Studio: " + message)
        write_failure(job_path, message)


main()
