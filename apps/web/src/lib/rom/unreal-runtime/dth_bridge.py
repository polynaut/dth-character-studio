"""The studio's half inside Unreal: watch for a job file, import, report back.

Third instance of the SAME handoff the Daz Runner and Houdini's 456.py already
implement, and deliberately so — the studio writes a job file, the other side
claims it by RENAME, works, and writes a result file the studio polls:

    Saved/DTHStudio/job.json          <- the studio writes this
    Saved/DTHStudio/running_job.json  <- this side renames it (the claim)
    Saved/DTHStudio/result.json       <- this side writes this, the studio polls

A job carries one or more EXPORT SETS (`imports`) — a character's export folder
holds one per HDA `character_name`, and the handoff is a single job file, so
they travel together rather than overwriting each other.

Each set also names the FBX files the export produced. They are not imported
directly — importing them would bypass the DazToHue pipeline that builds the
materials, curves and anim blueprint — they are used to FIND those assets in
this project, so a second send refreshes what the user already has, wherever
they put it, instead of importing a duplicate set into a folder of our choosing.

Why a watcher inside a live editor rather than a `-run=pythonscript`
commandlet: an editor holds its project. A commandlet writing into `Content/`
behind a running editor produces assets the editor does not know about, or two
writers on one package. The watcher is the only correct answer while the editor
is open — and, exactly like the Daz Runner, it covers the closed case too: the
studio starts Unreal and this claims the job on startup.

What it does NOT do: any content decisions. The import runs mrpdean's own
DazToHue Interchange pipeline, unmodified — this file only decides WHEN.

Lives in the studio's own plugin (`DTHStudioBridge`), never inside the DazToHue
plugin: that one is beta and iterating, and a fork of it would need re-merging
on every release.
"""

import json
import os
import traceback

import unreal

# --- the handoff -------------------------------------------------------------

FOLDER = "DTHStudio"
JOB_FILE = "job.json"
CLAIMED_FILE = "running_job.json"
RESULT_FILE = "result.json"

#: The contract version the studio writes. A job naming anything else is
#: refused rather than guessed at — a mismatched bridge is a stale install, and
#: silently doing the old thing is how a "successful" import imports nothing.
#: (The studio checks this before writing a job, by reading the `Version` out of
#: the installed `.uplugin`, so a stale bridge is normally caught there.)
JOB_VERSION = 4

#: Seconds between directory checks. The tick fires every frame; a stat per
#: frame on a network project folder is not free, and nobody needs sub-second
#: pickup for a job that takes minutes.
POLL_SECONDS = 1.0

_elapsed = 0.0
_busy = False
_tick_handle = None


def _dir():
    return os.path.join(unreal.Paths.project_saved_dir(), FOLDER)


def _path(name):
    return os.path.normpath(os.path.join(_dir(), name))


def _write_result(payload):
    """Write the result file whole. The studio treats a torn read as "still
    running" and re-reads, the same rule its other two pollers use."""
    try:
        os.makedirs(_dir(), exist_ok=True)
        with open(_path(RESULT_FILE), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
    except Exception:
        unreal.log_error("DTH bridge: could not write its result file\n" + traceback.format_exc())


def _claim():
    """Rename the pending job to the claimed name and return its contents.

    The rename IS the claim, and it is atomic — so a second editor with the
    same bridge cannot run the same job twice. None means "nothing to do".
    """
    pending = _path(JOB_FILE)
    if not os.path.isfile(pending):
        return None
    claimed = _path(CLAIMED_FILE)
    try:
        # A leftover claim from an editor that died mid-import: the new claim
        # replaces it, because the run it described is provably not running.
        if os.path.isfile(claimed):
            os.remove(claimed)
        os.replace(pending, claimed)
        with open(claimed, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        unreal.log_error("DTH bridge: could not claim the job file\n" + traceback.format_exc())
        return None


def _import_dth(source_file, destination_path):
    """Import one `.dth` through Interchange, which is what triggers the
    DazToHue post-import pipeline (its own code imports the same way).

    Returns the list of created assets.
    """
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    params = unreal.ImportAssetParameters()
    params.set_editor_property("is_automated", True)
    # `replace_existing` is what makes this a RE-import: the studio's whole
    # reason for existing here is the second export of the same character.
    params.set_editor_property("replace_existing", True)
    source_data = manager.create_source_data(os.path.normpath(source_file))
    return manager.import_asset(destination_path, source_data, params)


# --- where is this export already imported? -----------------------------------


def _source_files(asset_data):
    """Every source file one asset was imported from, absolute where it can be
    resolved and lowercased for comparison.

    Read from the asset registry's `AssetImportData` TAG rather than by loading
    the asset: a project can hold tens of thousands of assets and loading them
    to ask one question would stall the editor for minutes. The tag is the same
    JSON the Content Browser's "source file" column reads.

    UNVERIFIED against a live editor — the tag name and its shape are Unreal's,
    not ours, and this has never run against a real project. It is written to
    answer "nothing found" on anything it does not recognise, which degrades to
    the plain import the studio did before.
    """
    try:
        raw = asset_data.get_tag_value("AssetImportData")
    except Exception:
        return []
    if not raw:
        return []
    try:
        parsed = json.loads(str(raw))
    except Exception:
        return []
    entries = parsed.get("SourceFiles") if isinstance(parsed, dict) else None
    if not isinstance(entries, list):
        return []
    out = []
    for entry in entries:
        name = entry.get("RelativeFilename", "") if isinstance(entry, dict) else ""
        if not name:
            continue
        # RelativeFilename is relative to the asset's own package file when it
        # is relative at all; both forms occur, so keep the basename too — the
        # match below is happy with either.
        out.append(name.replace("\\", "/").lower())
    return out


def _existing_destination(files):
    """The content folder where these exported files are ALREADY imported, or
    None.

    The point of the file list: a second send must refresh the assets the user
    already has — wherever they put them — instead of importing a duplicate set
    into the studio's guessed `/Game/DazToHue/<Character>`. The folder holding
    the most matches wins; ties go to the first, which is stable because the
    registry returns package paths in a fixed order.
    """
    wanted = set()
    for path in files:
        clean = str(path).replace("\\", "/").lower()
        wanted.add(clean)
        wanted.add(clean.rsplit("/", 1)[-1])
    if not wanted:
        return None
    try:
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        # A job claimed during editor startup would otherwise search a registry
        # that is still scanning, and "not imported yet" is exactly the wrong
        # answer to give from an incomplete list. The import blocks the game
        # thread for minutes anyway; waiting for the scan is noise beside it.
        registry.wait_for_completion()
        assets = registry.get_assets_by_path("/Game", recursive=True)
    except Exception:
        unreal.log_warning("DTH bridge: could not read the asset registry\n" + traceback.format_exc())
        return None

    counts = {}
    for asset_data in assets:
        for source in _source_files(asset_data):
            if source in wanted or source.rsplit("/", 1)[-1] in wanted:
                try:
                    folder = str(asset_data.package_path)
                except Exception:
                    continue
                counts[folder] = counts.get(folder, 0) + 1
                break
    if not counts:
        return None
    best = max(counts.items(), key=lambda item: item[1])
    unreal.log(
        "DTH bridge: %d of these files are already imported under %s" % (best[1], best[0])
    )
    return best[0]


def _run_one(entry):
    """One export set: find where it already lives, import there, report."""
    dth = entry.get("dth", "")
    destination = entry.get("destination", "") or "/Game/DazToHue"
    if not dth or not os.path.isfile(dth):
        raise IOError("The .dth file named by the job is not on disk: %s" % dth)

    # Re-import in place when this project already has these files; a fresh
    # import at the job's destination when it doesn't. Either way the import
    # itself is the same call — the DazToHue pipeline off the `.dth`, with
    # `replace_existing`, which is what makes landing on top of the existing
    # assets a REFRESH rather than a second copy. Importing the FBX files
    # directly would bypass that pipeline and lose everything it builds.
    #
    # The STUDIO's answer wins. MEASURED 2026-08-13, first real run: the
    # registry lookup below found nothing and a second copy landed in
    # `/Game/DazToHue/LaraClassic` beside the user's `/Game/Characters/Lara`.
    # The studio can read the same fact off the `.uasset` files on disk, and
    # does, so `existing` means "these assets are AT destination — import
    # there". The search stays as the fallback for a job that has no answer.
    mode = "import"
    if entry.get("existing"):
        mode = "reimport"
    else:
        found = _existing_destination(entry.get("files") or [])
        if found:
            destination = found
            mode = "reimport"

    unreal.log("DTH bridge: %s %s into %s" % (mode, dth, destination))
    assets = _import_dth(dth, destination) or []
    names = []
    for asset in assets:
        try:
            names.append(asset.get_path_name())
        except Exception:
            # An asset that cannot name itself is still an asset — the count
            # must not lie because one entry was awkward.
            names.append("<unnamed>")
    return {
        "character": entry.get("character", ""),
        "destination": destination,
        "mode": mode,
        "assets": names,
    }


def _run(job):
    if job.get("version") != JOB_VERSION:
        return {
            "version": JOB_VERSION,
            "state": "failed",
            "error": "This job was written by a different studio version — re-install the bridge from the project card.",
            "imports": [],
        }
    entries = job.get("imports") or []
    if not entries:
        return {
            "version": JOB_VERSION,
            "state": "failed",
            "error": "The job names no export set to import.",
            "imports": [],
        }

    # One job, N export sets — a character's export folder holds one per HDA
    # `character_name`, and they are separate imports into separate content
    # folders. A set that fails does NOT take the others with it: each is its
    # own import, and reporting nothing because the third one broke would hide
    # two that worked.
    done = []
    errors = []
    for entry in entries:
        try:
            done.append(_run_one(entry))
        except Exception:
            detail = traceback.format_exc()
            unreal.log_error("DTH bridge: import failed for one set\n" + detail)
            last = detail.strip().splitlines()[-1] if detail.strip() else "import failed"
            errors.append("%s: %s" % (entry.get("character", "?"), last))
    return {
        "version": JOB_VERSION,
        "state": "failed" if errors and not done else "done",
        "error": "; ".join(errors),
        "imports": done,
    }


def _tick(delta_seconds):
    """Slate post-tick. Must NEVER raise: this fires every frame, so an escaping
    exception would fill the log and be impossible to read."""
    global _elapsed, _busy
    if _busy:
        return
    _elapsed += delta_seconds
    if _elapsed < POLL_SECONDS:
        return
    _elapsed = 0.0
    try:
        job = _claim()
        if job is None:
            return
        _busy = True
        # Say "running" BEFORE the work: the import blocks the game thread for
        # minutes, and a studio polling an absent result file cannot tell
        # "not started" from "started and silent".
        _write_result({"version": JOB_VERSION, "state": "running", "error": "", "imports": []})
        try:
            _write_result(_run(job))
        except Exception:
            detail = traceback.format_exc()
            unreal.log_error("DTH bridge: the import failed\n" + detail)
            _write_result(
                {
                    "version": JOB_VERSION,
                    "state": "failed",
                    "error": detail.strip().splitlines()[-1] if detail.strip() else "import failed",
                    "imports": [],
                }
            )
        finally:
            # The claim file has served its purpose; leaving it would make the
            # next start look like a job was interrupted.
            try:
                os.remove(_path(CLAIMED_FILE))
            except OSError:
                pass
    except Exception:
        unreal.log_error("DTH bridge: watcher error\n" + traceback.format_exc())
    finally:
        _busy = False


def start():
    """Register the watcher. Idempotent — a second `init_unreal.py` pass (or a
    manual re-import of this module) must not end up with two pollers."""
    global _tick_handle
    if _tick_handle is not None:
        return
    _tick_handle = unreal.register_slate_post_tick_callback(_tick)
    unreal.register_python_shutdown_callback(stop)
    unreal.log("DTH bridge: watching %s" % _path(JOB_FILE))


def stop():
    global _tick_handle
    if _tick_handle is None:
        return
    unreal.unregister_slate_post_tick_callback(_tick_handle)
    _tick_handle = None
