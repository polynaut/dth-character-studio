"""DazToHue material utilities — the hython half of the studio's "Utils" panel.

Runs headless under `hython`, driven by a JSON request file and answering into a
JSON result file (the same write-a-job / read-a-result handoff as `456.py`, minus
the polling: this one is synchronous and the studio waits for the process).

    hython material_utils.py <requestFile> <resultFile>

Two operations:

  scan      list every DazToHueMaterial node in a set of `.hip` files, with the
            counts the panel shows (materials / UV channels / bakers / layers).
  transfer  copy one source node's material SETUP onto one or more target nodes
            — any combination of the material slots, the UV channels and the
            texture bakers — appending or replacing, with a dry-run mode that
            changes nothing and reports what a real run would do.

Copying only the bakers produces a setup that imports cleanly and bakes NOTHING:
a baker names its material (`MI_Skin`) and its layers name geometry groups and
UV channels (`uv_original`, `uv_geoshell`) as plain text. The material slots —
where one `Skin` merges fifteen Daz surfaces — and the UV channels that create
those names are the other two thirds of the same setup, which is why all three
are transferable and why the report still names whatever a target is missing.

Facts measured against DazToHue 2.5 / Houdini 22.0 rather than assumed:

  * The DazToHue multiparms are **0-based** (`multiParmStartOffset() == 0`), not
    the 1-based Houdini default. Every index here is read from the node — a
    1-based loop silently drops instance 0 and invents a trailing phantom.
  * A network box's visible title is its `comment()`; `name()` is an internal
    id (`__netbox1`) nobody sets.
  * Walking a project's nodes can raise `hou.PermissionError` on locked assets,
    so every traversal is guarded.

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

# The three transferable sections, each rooted at one multiparm folder. `extras`
# are node-level parms that belong to the section but live outside its block.
SECTIONS = (
    {
        "key": "materials",
        "multi": "material",
        "extras": ("material_prefix", "material_exclude_character_name"),
        # Appending duplicate SLOT NAMES would leave two slots claiming the same
        # surfaces, so an append merges by name instead (see _import_section).
        "dedupe_field": "material_name#",
    },
    {"key": "uvChannels", "multi": "material_uv_channel", "extras": (), "dedupe_field": ""},
    {"key": "bakers", "multi": "material_texture_baker", "extras": (), "dedupe_field": ""},
)
SECTION_BY_KEY = {s["key"]: s for s in SECTIONS}

MULTI_KINDS = (
    hou.folderType.MultiparmBlock,
    hou.folderType.ScrollingMultiparmBlock,
    hou.folderType.TabbedMultiparmBlock,
)
# Buttons are ACTIONS, not state — copying one would press it. Separators and
# labels hold nothing.
SKIP_TEMPLATES = (
    hou.ButtonParmTemplate,
    hou.SeparatorParmTemplate,
    hou.LabelParmTemplate,
)

BAKER_NAME_FIELD = "material_texture_baker_name#"
BAKER_MATERIAL_FIELD = "material_texture_baker_material#"
BAKER_LAYER_BLOCK = "material_texture_baker_layer#"
LAYER_GROUP_FIELDS = (
    "material_texture_baker_layer_group#_#",
    "material_texture_baker_layer_geoshell_group#_#",
)


# --- generic multiparm copying ----------------------------------------------
#
# One walker serves all three sections. It works off the node's PARM TEMPLATE
# GROUP rather than a hand-listed field table, so a DazToHue update that adds a
# parameter is carried across automatically instead of being silently dropped —
# which for a texture baker (20 fields per layer, seven of them colour
# adjustments) is the difference between a copy and a near-copy.


def _is_multi(template):
    return (
        isinstance(template, hou.FolderParmTemplate)
        and template.folderType() in MULTI_KINDS
    )


def _leaves_and_blocks(folder):
    """Value templates directly in this block, and the nested multiparms.

    Plain folders (Simple / Collapsible / Tabs) only group the UI — they add no
    index, so they are flattened away.
    """
    leaves, blocks = [], []

    def walk(templates):
        for template in templates:
            if _is_multi(template):
                blocks.append(template)
            elif isinstance(template, hou.FolderParmTemplate):
                walk(template.parmTemplates())
            elif isinstance(template, SKIP_TEMPLATES):
                continue
            else:
                leaves.append(template)

    walk(folder.parmTemplates())
    return leaves, blocks


def _instance_name(template_name, indices):
    """`material_texture_baker_layer_texture#_#` + [1, 4] → `..._texture1_4`."""
    out, used = [], 0
    for char in template_name:
        if char == "#" and used < len(indices):
            out.append(str(indices[used]))
            used += 1
        else:
            out.append(char)
    return "".join(out)


def _read(node, name):
    """{"v": value, "expr": expression|None} for a parm or parm tuple.

    Expressions travel as expressions: a channel-referenced value must arrive as
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


def _count_parm(node, folder, indices):
    return node.parm(_instance_name(folder.name(), indices))


def _offset(parm):
    try:
        return parm.multiParmStartOffset()
    except AttributeError:
        return 0


def _export_block(node, folder, indices):
    """Every instance of a multiparm folder, recursively."""
    parm = _count_parm(node, folder, indices)
    if parm is None:
        return []
    base = _offset(parm)
    leaves, blocks = _leaves_and_blocks(folder)
    instances = []
    for i in range(base, base + int(parm.eval())):
        idx = list(indices) + [i]
        instance = {"f": {}, "b": {}}
        for leaf in leaves:
            instance["f"][leaf.name()] = _read(node, _instance_name(leaf.name(), idx))
        for block in blocks:
            instance["b"][block.name()] = _export_block(node, block, idx)
        instances.append(instance)
    return instances


def _import_block(node, folder, indices, instances):
    """Append instances to a multiparm folder (caller clears it for a replace)."""
    parm = _count_parm(node, folder, indices)
    if parm is None:
        return 0
    base = _offset(parm)
    start = int(parm.eval())
    parm.set(start + len(instances))
    leaves, blocks = _leaves_and_blocks(folder)
    by_name = {b.name(): b for b in blocks}
    for k, instance in enumerate(instances):
        idx = list(indices) + [base + start + k]
        for name, rec in instance["f"].items():
            _write(node, _instance_name(name, idx), rec)
        for name, sub in instance["b"].items():
            block = by_name.get(name)
            if block is None:
                continue
            # A nested block starts empty on a fresh instance; clear anyway so a
            # reused instance can never keep a longer previous list.
            sub_parm = _count_parm(node, block, idx)
            if sub_parm is not None:
                sub_parm.set(0)
            _import_block(node, block, idx, sub)
    return int(parm.eval())


def _folder_template(node, name):
    try:
        return node.parmTemplateGroup().find(name)
    except Exception:
        return None


def _export_section(node, section):
    folder = _folder_template(node, section["multi"])
    if folder is None:
        return None
    return {
        "instances": _export_block(node, folder, []),
        "extras": {name: _read(node, name) for name in section["extras"]},
    }


def _instance_field(instance, field_name):
    rec = instance["f"].get(field_name)
    return rec["v"] if rec else None


def _import_section(node, section, payload, replace):
    """Apply one section. Returns (before, after, skipped)."""
    folder = _folder_template(node, section["multi"])
    if folder is None or payload is None:
        return (0, 0, 0)
    parm = _count_parm(node, folder, [])
    if parm is None:
        return (0, 0, 0)
    before = int(parm.eval())

    instances = payload["instances"]
    skipped = 0
    if replace:
        parm.set(0)
    elif section["dedupe_field"]:
        # Merge by name: a slot the target already defines is left alone, so an
        # append can never produce two slots claiming the same surfaces.
        existing = set()
        base = _offset(parm)
        for i in range(base, base + before):
            existing_parm = node.parm(_instance_name(section["dedupe_field"], [i]))
            if existing_parm is not None:
                existing.add(existing_parm.eval())
        kept = [
            inst
            for inst in instances
            if _instance_field(inst, section["dedupe_field"]) not in existing
        ]
        skipped = len(instances) - len(kept)
        instances = kept

    _import_block(node, folder, [], instances)
    for name, rec in payload["extras"].items():
        _write(node, name, rec)
    return (before, int(parm.eval()), skipped)


# --- node inspection ---------------------------------------------------------


def _material_nodes(root="/"):
    try:
        children = hou.node(root).allSubChildren()
    except (hou.OperationFailed, hou.PermissionError):
        return []
    return [n for n in children if n.type().name() == MATERIAL_TYPE]


def _load(path):
    hou.hipFile.load(path, suppress_save_prompt=True, ignore_load_warnings=True)


def _network_box_label(node):
    """Title of the network box the node sits in, or ''.

    When a project holds several DTH networks, users wrap each in a network box
    and title it (`KiraDefault`, `KiraYoga`, `KiraNaked`) — the only
    human-meaningful name the setup has, since the nodes themselves are just
    `DazToHueMaterial`, `…1`, `…2`. Measured: the visible title is the box's
    COMMENT; `name()` is an internal id. Boxes live in the node's PARENT network
    and may nest, so the innermost containing box wins.
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
    except (hou.OperationFailed, hou.PermissionError):
        comment = ""
    # Only the first line: a box comment can be a multi-line note. An untitled
    # box has an internal name only, which is worthless as a label.
    return comment.splitlines()[0].strip() if comment else ""


def _section_count(node, section):
    parm = node.parm(section["multi"])
    return int(parm.eval()) if parm is not None else 0


def _material_names(node):
    """Slot names with and without the node's prefix — a baker names its
    material the way the slot renders (`MI_Skin`)."""
    parm = node.parm("material")
    if parm is None:
        return set()
    base = _offset(parm)
    prefix_parm = node.parm("material_prefix")
    prefix = prefix_parm.eval() if prefix_parm is not None else ""
    names = set()
    for i in range(base, base + int(parm.eval())):
        slot = node.parm("material_name%d" % i)
        if slot is None or not slot.eval():
            continue
        names.add(slot.eval())
        names.add(prefix + slot.eval())
    return names


def _baker_summary(payload):
    """(names, materials referenced, groups referenced, layer count)."""
    if payload is None:
        return ([], set(), set(), 0)
    names, materials, groups, layers = [], set(), set(), 0
    for instance in payload["instances"]:
        names.append(_instance_field(instance, BAKER_NAME_FIELD) or "")
        material = _instance_field(instance, BAKER_MATERIAL_FIELD)
        if material:
            materials.add(material)
        for layer in instance["b"].get(BAKER_LAYER_BLOCK, []):
            layers += 1
            for field in LAYER_GROUP_FIELDS:
                value = _instance_field(layer, field)
                if value:
                    groups.add(value)
    return (names, materials, groups, layers)


def _node_info(node):
    payload = _export_section(node, SECTION_BY_KEY["bakers"])
    names, _, _, layers = _baker_summary(payload)
    return {
        "path": node.path(),
        "name": node.name(),
        "networkBox": _network_box_label(node),
        "materials": _section_count(node, SECTION_BY_KEY["materials"]),
        "uvChannels": _section_count(node, SECTION_BY_KEY["uvChannels"]),
        "bakers": len(names),
        "layers": layers,
        "bakerNames": names,
        "materialNames": sorted(_material_names(node)),
    }


# --- operations --------------------------------------------------------------


def op_scan(request):
    projects = []
    for path in request.get("hipPaths", []):
        entry = {"hipPath": path, "ok": True, "error": "", "nodes": []}
        try:
            _load(path)
            entry["nodes"] = [_node_info(n) for n in _material_nodes()]
        except Exception as exc:
            entry["ok"] = False
            entry["error"] = str(exc).strip() or exc.__class__.__name__
        projects.append(entry)
    return {"op": "scan", "projects": projects, "targets": []}


def _backup(path):
    """One rolling backup per project, inside Houdini's own `backup/` folder.

    Deliberately NOT timestamped: a `.hiplc` here is ~8 MB and an unbounded
    trail would quietly fill the user's drive. The most recent pre-transfer
    state is what a mistake needs.
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
    source = request["source"]
    dry_run = bool(request.get("dryRun"))
    replace = bool(request.get("replace"))
    keys = [k for k in request.get("sections", []) if k in SECTION_BY_KEY]
    if not keys:
        raise ValueError("no sections selected")

    _load(source["hipPath"])
    node = hou.node(source["nodePath"])
    if node is None or node.type().name() != MATERIAL_TYPE:
        raise hou.Error("The source material node was not found: %s" % source["nodePath"])

    payloads = {}
    for key in keys:
        payloads[key] = _export_section(node, SECTION_BY_KEY[key])
    baker_names, needed_materials, needed_groups, source_layers = _baker_summary(
        payloads.get("bakers")
    )
    # Material names the copy itself will install at the target.
    incoming_materials = set()
    if "materials" in payloads and payloads["materials"] is not None:
        prefix_rec = payloads["materials"]["extras"].get("material_prefix")
        prefix = prefix_rec["v"] if prefix_rec else ""
        for instance in payloads["materials"]["instances"]:
            name = _instance_field(instance, "material_name#")
            if name:
                incoming_materials.add(name)
                incoming_materials.add(prefix + name)

    # Group targets per file so each `.hip` is opened (and saved) exactly once.
    by_file = []
    for target in request.get("targets", []):
        for entry in by_file:
            if entry["hipPath"] == target["hipPath"]:
                entry["nodePaths"].append(target["nodePath"])
                break
        else:
            by_file.append({"hipPath": target["hipPath"], "nodePaths": [target["nodePath"]]})

    def blank(hip, node_path):
        return {
            "hipPath": hip,
            "nodePath": node_path,
            "ok": True,
            "error": "",
            "sections": [],
            "added": list(baker_names),
            "replaced": replace,
            "missingMaterials": [],
            "missingGroups": [],
            "backupPath": "",
        }

    results = []
    for entry in by_file:
        hip = entry["hipPath"]
        touched = False
        try:
            _load(hip)
        except Exception as exc:
            for node_path in entry["nodePaths"]:
                failed = blank(hip, node_path)
                failed["ok"] = False
                failed["error"] = str(exc).strip() or exc.__class__.__name__
                failed["added"] = []
                results.append(failed)
            continue

        for node_path in entry["nodePaths"]:
            target_node = hou.node(node_path)
            result = blank(hip, node_path)
            if target_node is None or target_node.type().name() != MATERIAL_TYPE:
                result["ok"] = False
                result["error"] = "Material node not found: %s" % node_path
                result["added"] = []
                results.append(result)
                continue

            # A baker resolves its material by NAME. What the target will have
            # AFTER this run is its own slots plus whatever the copy installs —
            # so a missing material means "still missing when this finishes",
            # not "missing right now".
            have_materials = _material_names(target_node) | incoming_materials
            result["missingMaterials"] = sorted(
                m for m in needed_materials if m not in have_materials
            )
            geo_groups = set()
            try:
                geometry = target_node.geometry()
                if geometry is not None:
                    geo_groups = {g.name() for g in geometry.primGroups()}
            except Exception:
                # No cooked geometry (headless, nothing imported) — the check is
                # best-effort and its absence must never fail a transfer.
                geo_groups = set()
            if geo_groups:
                result["missingGroups"] = sorted(
                    g
                    for g in needed_groups
                    if not all(
                        tok in geo_groups
                        for tok in g.split()
                        if "*" not in tok and "@" not in tok
                    )
                )

            for key in keys:
                section = SECTION_BY_KEY[key]
                payload = payloads.get(key)
                if payload is None:
                    continue
                if dry_run:
                    before = _section_count(target_node, section)
                    incoming = len(payload["instances"])
                    after = incoming if replace else before + incoming
                    result["sections"].append(
                        {"key": key, "before": before, "after": after, "skipped": 0}
                    )
                    continue
                try:
                    before, after, skipped = _import_section(
                        target_node, section, payload, replace
                    )
                    result["sections"].append(
                        {"key": key, "before": before, "after": after, "skipped": skipped}
                    )
                    touched = True
                except Exception as exc:
                    result["ok"] = False
                    result["error"] = str(exc).strip() or exc.__class__.__name__
                    result["added"] = []
                    break
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
        "sourceBakers": len(baker_names),
        "sourceLayers": source_layers,
        "sourceBakerNames": baker_names,
        "sections": keys,
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
    payload.setdefault("sections", [])
    payload.setdefault("dryRun", False)
    payload.setdefault("replace", False)

    # Write-then-rename: the studio reads this the moment hython exits, and a
    # half-written JSON would parse as a corrupt result rather than a failure.
    temp = result_file + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
    if os.path.exists(result_file):
        os.remove(result_file)
    os.rename(temp, result_file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
