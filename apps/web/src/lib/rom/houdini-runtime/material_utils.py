"""DazToHue material utilities — the hython half of the studio's "Utils" panel.

Runs headless under `hython`, driven by a JSON request file and answering into a
JSON result file (the same write-a-job / read-a-result handoff as `456.py`, minus
the polling: this one is synchronous and the studio waits for the process).

    hython material_utils.py <requestFile> <resultFile>

Two operations:

  scan      list every DazToHueMaterial node in a set of `.hip` files, with the
            counts the panel shows (materials / UV channels / bakers / layers).
  transfer  copy ONE source node's texture-baker definitions onto one or more
            target nodes, appending or replacing, with a dry-run mode that
            changes nothing and reports what a real run would do.

Two measured facts drive the whole file, both verified against DazToHue 2.5 in
Houdini 22.0 rather than assumed:

  * The DazToHue multiparms are **0-based** (`multiParmStartOffset() == 0`), not
    the 1-based Houdini default. Every index here is read from the node, never
    counted from one — a 1-based loop silently drops baker 0 and invents a
    trailing phantom.
  * A baker references its material and its geometry groups **by name**
    (`MI_Skin`, `Head`, `GP*`, geoshell `..._Shape`). Names that do not exist at
    the target still import cleanly and then bake nothing, so the transfer
    reports them as warnings instead of pretending the copy was complete.

Nothing here writes to a source file, and a target is only ever saved by a real
(non-dry) transfer — after a single rolling backup beside Houdini's own.
"""

import json
import os
import shutil
import sys
import traceback

import hou


MATERIAL_TYPE = "DazToHueMaterial"

BAKER_MULTI = "material_texture_baker"
LAYER_MULTI = "material_texture_baker_layer"
MATERIAL_MULTI = "material"
UV_MULTI = "material_uv_channel"

# Per-baker fields. Buttons (duplicate / move) are deliberately absent: they are
# actions, not state, and pressing one on import would mutate the node.
BAKER_FIELDS = (
    "material_texture_baker_material",
    "material_texture_baker_target_uv",
    "material_texture_baker_resolution",
    "material_texture_baker_type",
    "material_texture_baker_raw",
    "material_texture_baker_name",
)

# Per-layer fields, suffixed "<baker>_<layer>".
LAYER_FIELDS = (
    "material_texture_baker_layer_enabled",
    "material_texture_baker_layer_source_uv",
    "material_texture_baker_layer_geoshell_group",
    "material_texture_baker_layer_group",
    "material_texture_baker_layer_texture",
    "material_texture_baker_layer_colour",
    "material_texture_baker_layer_blend_mode",
    "material_texture_baker_layer_blend_opacity",
    "material_texture_baker_layer_normal_blend_mode",
    "material_texture_baker_layer_normal_blend_opacity",
    "material_texture_baker_layer_dilate",
    "material_texture_baker_layer_alpha_source",
    "material_texture_baker_layer_alpha_texture",
    "material_texture_baker_layer_adjust_hue_shift",
    "material_texture_baker_layer_adjust_saturation_scale",
    "material_texture_baker_layer_adjust_saturation_shift",
    "material_texture_baker_layer_adjust_value_scale",
    "material_texture_baker_layer_adjust_value_shift",
    "material_texture_baker_layer_adjust_brightness",
    "material_texture_baker_layer_adjust_contrast",
)


# --- small hou helpers -------------------------------------------------------


def _offset(node, multi_name):
    """The multiparm's first instance index, read from the node itself."""
    parm = node.parm(multi_name)
    if parm is None:
        return 0
    try:
        return parm.multiParmStartOffset()
    except AttributeError:
        return 0


def _count(node, multi_name):
    parm = node.parm(multi_name)
    return int(parm.eval()) if parm is not None else 0


def _read(node, name):
    """{"v": value, "expr": expression|None} for a parm or parm tuple.

    Expressions are carried across so a channel-referenced value transfers as
    the reference it is, not as the number it happened to evaluate to.
    """
    parm = node.parm(name)
    if parm is not None:
        try:
            expr = parm.expression()
        except hou.OperationFailed:
            expr = None
        return {"v": parm.eval(), "expr": expr}
    tup = node.parmTuple(name)
    if tup is not None:
        exprs = []
        for one in tup:
            try:
                exprs.append(one.expression())
            except hou.OperationFailed:
                exprs.append(None)
        return {"v": list(tup.eval()), "expr": exprs if any(exprs) else None}
    return None


def _write(node, name, rec):
    if not rec:
        return
    parm = node.parm(name)
    if parm is not None:
        if rec.get("expr"):
            parm.setExpression(rec["expr"])
        else:
            parm.deleteAllKeyframes()
            parm.set(rec["v"])
        return
    tup = node.parmTuple(name)
    if tup is None:
        return
    values = rec["v"]
    exprs = rec.get("expr") or [None] * len(values)
    for one, value, expr in zip(tup, values, exprs):
        if expr:
            one.setExpression(expr)
        else:
            one.deleteAllKeyframes()
            one.set(value)


def _material_nodes(root="/"):
    return [
        n
        for n in hou.node(root).allSubChildren()
        if n.type().name() == MATERIAL_TYPE
    ]


def _load(path):
    """Open a .hip read-only-ish: never prompts, tolerates missing HDAs."""
    hou.hipFile.load(path, suppress_save_prompt=True, ignore_load_warnings=True)


# --- the baker payload -------------------------------------------------------


def export_bakers(node):
    base = _offset(node, BAKER_MULTI)
    bakers = []
    for i in range(base, base + _count(node, BAKER_MULTI)):
        fields = {f: _read(node, "%s%d" % (f, i)) for f in BAKER_FIELDS}
        layer_parm = node.parm("%s%d" % (LAYER_MULTI, i))
        layers = []
        if layer_parm is not None:
            lbase = 0
            try:
                lbase = layer_parm.multiParmStartOffset()
            except AttributeError:
                pass
            for j in range(lbase, lbase + int(layer_parm.eval())):
                layers.append(
                    {f: _read(node, "%s%d_%d" % (f, i, j)) for f in LAYER_FIELDS}
                )
        bakers.append({"fields": fields, "layers": layers})
    return bakers


def import_bakers(node, bakers, replace):
    """Append (or replace) baker definitions. Returns the new total."""
    multi = node.parm(BAKER_MULTI)
    base = _offset(node, BAKER_MULTI)
    if replace:
        multi.set(0)
    start = int(multi.eval())
    multi.set(start + len(bakers))
    for k, rec in enumerate(bakers):
        i = base + start + k
        for field, value in rec["fields"].items():
            _write(node, "%s%d" % (field, i), value)
        layer_parm = node.parm("%s%d" % (LAYER_MULTI, i))
        if layer_parm is None:
            continue
        lbase = 0
        try:
            lbase = layer_parm.multiParmStartOffset()
        except AttributeError:
            pass
        layer_parm.set(len(rec["layers"]))
        for m, layer in enumerate(rec["layers"]):
            for field, value in layer.items():
                _write(node, "%s%d_%d" % (field, i, lbase + m), value)
    return int(multi.eval())


def _field(rec, name):
    entry = rec["fields"].get(name)
    return entry["v"] if entry else None


def _layer_value(layer, name):
    entry = layer.get(name)
    return entry["v"] if entry else None


def _material_names(node):
    """Every material slot name on a node, with and without the node's prefix —
    a baker names its material the way the slot renders (`MI_Skin`)."""
    base = _offset(node, MATERIAL_MULTI)
    prefix_parm = node.parm("material_prefix")
    prefix = prefix_parm.eval() if prefix_parm is not None else ""
    names = set()
    for i in range(base, base + _count(node, MATERIAL_MULTI)):
        parm = node.parm("material_name%d" % i)
        if parm is None:
            continue
        name = parm.eval()
        if not name:
            continue
        names.add(name)
        names.add(prefix + name)
    return names


def _network_box_label(node):
    """The title of the network box the node sits in, or ''.

    When a project holds several DTH networks, users wrap each one in a network
    box and title it (`KiraDefault`, `KiraYoga`, `KiraNaked`) — that title is the
    only human-meaningful name the setup has, since the nodes themselves are
    just `DazToHueMaterial`, `…1`, `…2`.

    Measured on Houdini 22.0: the visible title is the box's **comment()**;
    `name()` is an internal id (`__netbox1`) and is never what the user typed.
    Boxes live in the node's PARENT network and may nest, so this searches
    nested boxes too and prefers the INNERMOST match — the closest box is the
    one whose label describes this network.
    """

    def search(container, depth=0):
        try:
            boxes = container.networkBoxes()
        except (AttributeError, hou.OperationFailed, hou.PermissionError):
            return None
        best = None
        for box in boxes:
            try:
                members = box.nodes()
            except (hou.OperationFailed, hou.PermissionError):
                continue
            deeper = search(box, depth + 1)
            if deeper is not None:
                # A nested box wins: it is the more specific label.
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
    box = found[0]
    try:
        comment = (box.comment() or "").strip()
    except (hou.OperationFailed, hou.PermissionError):
        comment = ""
    if comment:
        # Only the first line: a box comment can be a multi-line note.
        return comment.splitlines()[0].strip()
    # An untitled box has an internal name only — worthless as a label.
    return ""


def _node_info(node):
    bakers = export_bakers(node)
    return {
        "path": node.path(),
        "name": node.name(),
        "networkBox": _network_box_label(node),
        "materials": _count(node, MATERIAL_MULTI),
        "uvChannels": _count(node, UV_MULTI),
        "bakers": len(bakers),
        "layers": sum(len(b["layers"]) for b in bakers),
        "bakerNames": [
            _field(b, "material_texture_baker_name") or "" for b in bakers
        ],
        "materialNames": sorted(_material_names(node)),
    }


# --- operations --------------------------------------------------------------


def op_scan(request):
    """List the DazToHueMaterial nodes of every requested `.hip`."""
    projects = []
    for path in request.get("hipPaths", []):
        entry = {"hipPath": path, "ok": True, "error": "", "nodes": []}
        try:
            _load(path)
            entry["nodes"] = [_node_info(n) for n in _material_nodes()]
        except Exception as exc:  # a corrupt / locked / missing file
            entry["ok"] = False
            entry["error"] = str(exc).strip() or exc.__class__.__name__
        projects.append(entry)
    return {"op": "scan", "projects": projects, "targets": []}


def _backup(path):
    """One rolling backup per project, inside Houdini's own `backup/` folder.

    Deliberately NOT timestamped: a `.hiplc` here is ~8 MB, and an unbounded
    trail of them would quietly fill the user's drive. The most recent
    pre-transfer state is what a mistake needs.
    """
    folder = os.path.join(os.path.dirname(path), "backup")
    name, ext = os.path.splitext(os.path.basename(path))
    target = os.path.join(folder, "%s_dthbak%s" % (name, ext))
    try:
        if not os.path.isdir(folder):
            os.makedirs(folder)
        shutil.copy2(path, target)
        return target.replace("\\", "/")
    except Exception:
        return ""


def op_transfer(request):
    """Copy the source node's bakers onto each target node."""
    source = request["source"]
    dry_run = bool(request.get("dryRun"))
    replace = bool(request.get("replace"))

    _load(source["hipPath"])
    node = hou.node(source["nodePath"])
    if node is None or node.type().name() != MATERIAL_TYPE:
        raise hou.Error(
            "The source material node was not found: %s" % source["nodePath"]
        )
    bakers = export_bakers(node)
    baker_names = [_field(b, "material_texture_baker_name") or "" for b in bakers]
    # What the copied bakers will look for at the other end.
    needed_materials = sorted(
        {
            _field(b, "material_texture_baker_material") or ""
            for b in bakers
        }
        - {""}
    )
    needed_groups = set()
    for baker in bakers:
        for layer in baker["layers"]:
            for key in (
                "material_texture_baker_layer_group",
                "material_texture_baker_layer_geoshell_group",
            ):
                value = _layer_value(layer, key)
                if value:
                    needed_groups.add(value)

    # Group targets per file so each `.hip` is opened (and saved) exactly once.
    by_file = []
    for target in request.get("targets", []):
        for entry in by_file:
            if entry["hipPath"] == target["hipPath"]:
                entry["nodePaths"].append(target["nodePath"])
                break
        else:
            by_file.append(
                {"hipPath": target["hipPath"], "nodePaths": [target["nodePath"]]}
            )

    results = []
    for entry in by_file:
        hip = entry["hipPath"]
        touched = False
        loaded = False
        try:
            _load(hip)
            loaded = True
        except Exception as exc:
            for node_path in entry["nodePaths"]:
                results.append(
                    {
                        "hipPath": hip,
                        "nodePath": node_path,
                        "ok": False,
                        "error": str(exc).strip() or exc.__class__.__name__,
                        "bakersBefore": 0,
                        "bakersAfter": 0,
                        "added": [],
                        "replaced": replace,
                        "missingMaterials": [],
                        "missingGroups": [],
                        "backupPath": "",
                    }
                )
        if not loaded:
            continue

        for node_path in entry["nodePaths"]:
            target_node = hou.node(node_path)
            result = {
                "hipPath": hip,
                "nodePath": node_path,
                "ok": True,
                "error": "",
                "bakersBefore": 0,
                "bakersAfter": 0,
                "added": list(baker_names),
                "replaced": replace,
                "missingMaterials": [],
                "missingGroups": [],
                "backupPath": "",
            }
            if target_node is None or target_node.type().name() != MATERIAL_TYPE:
                result["ok"] = False
                result["error"] = "Material node not found: %s" % node_path
                result["added"] = []
                results.append(result)
                continue

            before = _count(target_node, BAKER_MULTI)
            result["bakersBefore"] = before

            # A baker resolves its material and groups BY NAME — report the ones
            # this target cannot satisfy instead of reporting a clean copy that
            # would silently bake nothing.
            have_materials = _material_names(target_node)
            result["missingMaterials"] = [
                m for m in needed_materials if m not in have_materials
            ]
            geo_groups = set()
            try:
                geometry = target_node.geometry()
                if geometry is not None:
                    for group in geometry.primGroups():
                        geo_groups.add(group.name())
            except Exception:
                # No cooked geometry here (headless, no imported FBX) — group
                # checking is best-effort and its absence must not fail a
                # transfer. Reported as "not checked" by leaving the list empty.
                geo_groups = set()
            if geo_groups:
                result["missingGroups"] = sorted(
                    g
                    for g in needed_groups
                    # Patterns ("GP*", multi-token groups) are matched loosely:
                    # every whitespace-separated plain token must exist.
                    if not all(
                        tok in geo_groups
                        for tok in g.split()
                        if "*" not in tok and "@" not in tok
                    )
                )

            if dry_run:
                result["bakersAfter"] = len(bakers) if replace else before + len(bakers)
            else:
                try:
                    result["bakersAfter"] = import_bakers(target_node, bakers, replace)
                    touched = True
                except Exception as exc:
                    result["ok"] = False
                    result["error"] = str(exc).strip() or exc.__class__.__name__
                    result["added"] = []
            results.append(result)

        if touched and not dry_run:
            backup = _backup(hip)
            try:
                hou.hipFile.save(hip)
            except Exception as exc:
                for result in results:
                    if result["hipPath"] == hip and result["ok"]:
                        result["ok"] = False
                        result["error"] = "Could not save the project: %s" % exc
                        result["added"] = []
                continue
            for result in results:
                if result["hipPath"] == hip and result["ok"]:
                    result["backupPath"] = backup

    return {
        "op": "transfer",
        "projects": [],
        "targets": results,
        "sourceBakers": len(bakers),
        "sourceLayers": sum(len(b["layers"]) for b in bakers),
        "sourceBakerNames": baker_names,
        "dryRun": dry_run,
        "replace": replace,
    }


OPS = {"scan": op_scan, "transfer": op_transfer}


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: material_utils.py <requestFile> <resultFile>\n")
        return 2
    request_file, result_file = sys.argv[1], sys.argv[2]
    # Explicit encodings on BOTH sides: Python's open() defaults to the LOCALE
    # encoding on Windows (cp1252), which mangles any non-ASCII path in a
    # request or a result. `utf-8-sig` additionally tolerates a BOM, so the file
    # parses no matter which writer produced it.
    with open(request_file, "r", encoding="utf-8-sig") as handle:
        request = json.load(handle)

    try:
        handler = OPS.get(request.get("op", ""))
        if handler is None:
            raise ValueError("unknown op %r" % request.get("op"))
        payload = handler(request)
        payload["ok"] = True
        payload["error"] = ""
    except Exception as exc:
        traceback.print_exc()
        payload = {
            "op": request.get("op", ""),
            "ok": False,
            "error": str(exc).strip() or exc.__class__.__name__,
            "projects": [],
            "targets": [],
        }

    payload.setdefault("sourceBakers", 0)
    payload.setdefault("sourceLayers", 0)
    payload.setdefault("sourceBakerNames", [])
    payload.setdefault("dryRun", False)
    payload.setdefault("replace", False)

    # Write-then-rename: the studio reads this file the moment hython exits, and
    # a half-written JSON would parse as a corrupt result rather than a failure.
    temp = result_file + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
    if os.path.exists(result_file):
        os.remove(result_file)
    os.rename(temp, result_file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
