"""DazToHue material utilities — the hython half of the studio's "Utils" panel.

Runs headless under `hython`, driven by a JSON request file and answering into a
JSON result file (the same write-a-job / read-a-result handoff as `456.py`, minus
the polling: this one is synchronous and the studio waits for the process).

    hython material_utils.py <requestFile> <resultFile>

Three operations:

  scan      list every DazToHueMaterial node in a set of `.hip` files, with the
            counts the panel shows (materials / UV channels / bakers / layers)
            — plus each scene's `$JOB` and `$HIP`, read in the same pass.
  transfer  copy one source node's material SETUP onto one or more target nodes
            — any combination of the material slots, the UV channels and the
            texture bakers — appending or replacing, with a dry-run mode that
            changes nothing and reports what a real run would do.
  defaults  repoint a project's `$JOB` at the folder the studio expects, so a
            hand-picked export collapses to a variable instead of an absolute
            path (`op_defaults`).

Copying only the bakers produces a setup that imports cleanly and bakes NOTHING:
a baker names its material (`MI_Skin`) and its layers name geometry groups and
UV channels (`uv_original`, `uv_geoshell`) as plain text. The material slots —
where one `Skin` merges fifteen Daz surfaces — and the UV channels that create
those names are the other two thirds of the same setup, which is why all three
are transferable and why the report still names whatever a target is missing.

Material slots are merged BY SURFACE, never by name and never wholesale — see
`_plan_surface_merge`, which owns that rule and explains why the two obvious
modes are both wrong.

Facts measured against DazToHue 2.5 / Houdini 22.0 rather than assumed:

  * The DazToHue multiparms are **0-based** (`multiParmStartOffset() == 0`), not
    the 1-based Houdini default. Every index here is read from the node — a
    1-based loop silently drops instance 0 and invents a trailing phantom.
  * `material_group#` is a plain STRING of space-separated group expressions,
    one per Daz surface: `@fbx_material_name=Body @fbx_material_name=Head …`.
  * `removeMultiParmInstance(i)` takes the instance index and RENUMBERS what
    follows, so a batch of removals must run in descending order.
  * A network box's visible title is its `comment()`; `name()` is an internal
    id (`__netbox1`) nobody sets.
  * Walking a project's nodes can raise `hou.PermissionError` on locked assets,
    so every traversal is guarded.

Nothing here writes to a source file, and a target is only ever saved by a real
(non-dry) transfer — after a single rolling backup beside Houdini's own.
"""

import json
import os
import re
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
        # A material slot is a CLAIM on Daz surfaces, and a surface can belong to
        # exactly one slot — so this section is neither appended nor replaced
        # wholesale, it is merged by surface (`_plan_surface_merge`).
        "merge_by_surface": True,
    },
    {"key": "uvChannels", "multi": "material_uv_channel", "extras": ()},
    {"key": "bakers", "multi": "material_texture_baker", "extras": ()},
)
SECTION_BY_KEY = {s["key"]: s for s in SECTIONS}

SKELETON_TYPE = "DazToHueSkeleton"

# The skeleton node's three top-level TABS. Unlike the material node's sections
# (each one multiparm block) these are plain folders mixing flat settings with
# nested multiparms — bone renames, reparents, physics-bone offsets — so they
# copy as whole subtrees. Measured on a real setup: 22 renames, 10 reparents,
# 3 deletes and two skin-weight operations, and because Daz bone names are
# fixed per generation the whole block transfers between G9 characters.
SKELETON_SECTIONS = (
    {"key": "general", "folder": "skeleton_options_folder", "label": "General"},
    {"key": "skeleton", "folder": "skeleton_options_folder_1", "label": "Skeleton"},
    {"key": "skinWeights", "folder": "skeleton_options_folder_2", "label": "Skin Weights"},
)
SKELETON_SECTION_BY_KEY = {s["key"]: s for s in SKELETON_SECTIONS}

# What the panel can transfer, keyed by the `nodeType` a request names.
NODE_KINDS = {
    "material": {"type": MATERIAL_TYPE, "sections": [s["key"] for s in SECTIONS]},
    "skeleton": {"type": SKELETON_TYPE, "sections": [s["key"] for s in SKELETON_SECTIONS]},
}

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
LAYER_SOURCE_UV_FIELD = "material_texture_baker_layer_source_uv#_#"
SLOT_NAME_FIELD = "material_name#"
# The Daz surfaces merged into a slot, as one space-separated string of group
# expressions (`@fbx_material_name=Body @fbx_material_name=Head`). Measured, not
# assumed — see the module header.
SLOT_GROUP_FIELD = "material_group#"
LAYER_GROUP_FIELDS = (
    "material_texture_baker_layer_group#_#",
    "material_texture_baker_layer_geoshell_group#_#",
)

# UV names that exist on any DTH-imported geometry, so a baker reading one needs
# no UV channel copied with it. Measured on DazToHue 2.5: every baker reads
# `uv_original` (the untouched Daz UVs) and writes `uv`; only the skin bakers
# read a channel-PRODUCED name (`uv_geoshell`, from the Copy-From-Geoshell
# channels). Anything outside this set therefore implies a UV-channel
# dependency — which is what lets the report tell a user copying a clothing
# material that they do NOT need the channels, instead of leaving them to guess.
INTRINSIC_UV_NAMES = frozenset(("", "uv", "uv_original"))

# The Houdini variable the studio upserts into every configured houdini.env
# (`DAZ3D_LIB = "<library>"`, storage/houdini-env.ts). Texture layers store
# ABSOLUTE paths into the Daz library, so swapping that prefix for the variable
# is what makes a copied setup survive a moved library — or a second machine
# whose library sits on another drive.
LIB_VAR = "$DAZ3D_LIB"


def _norm_path(value):
    return value.replace("\\", "/").rstrip("/")


def _looks_absolute(value):
    """A Windows drive path or a UNC share — the only shapes worth rewriting."""
    return len(value) > 2 and (value[1] == ":" or value.startswith(("//", "\\\\")))


def _rewrite_lib_paths(payloads, lib_root):
    """Point every Daz-library path at $DAZ3D_LIB, in place.

    Walks EVERY string value rather than a list of known texture fields: layers
    hold a texture and an alpha texture, UV operations can hold a
    copy-from-external path, and a future DazToHue field would be missed by any
    hand-kept list. Only values under the library root match, so nothing else
    can be caught by accident.

    Values driven by an EXPRESSION are skipped — the expression is what Houdini
    writes back, so rewriting the evaluated string would be discarded.

    Returns (rewritten count, sorted absolute paths left alone) — the second is
    reported, since a texture outside the Daz library cannot be made portable
    and the user should know which ones stayed pinned.
    """
    root = _norm_path(lib_root).lower()
    rewritten = [0]
    foreign = set()

    def visit(rec):
        if not rec or rec.get("expr"):
            return
        value = rec.get("v")
        if not isinstance(value, str) or not value:
            return
        if value.startswith(LIB_VAR):
            return  # already portable
        if not _looks_absolute(value):
            return
        norm = _norm_path(value)
        if root and norm.lower().startswith(root + "/"):
            rec["v"] = LIB_VAR + norm[len(root) :]
            rewritten[0] += 1
        else:
            foreign.add(norm)

    def walk(instances):
        for instance in instances:
            for rec in instance["f"].values():
                visit(rec)
            for sub in instance["b"].values():
                walk(sub)

    for payload in payloads.values():
        if payload is None:
            continue
        walk(payload["instances"])
        for rec in payload["extras"].values():
            visit(rec)
    return (rewritten[0], sorted(foreign))


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


# A channel reference naming another NODE — `ch("/obj/.../parm")`, `chs(...)`,
# `opparm`, or any relative hop. The HDA's own "Linking" feature builds exactly
# these: linking a node rewrites every linkable parm to `ch("<source>/<parm>")`
# so the target live-mirrors the source WITHIN one network.
_NODE_REF_EXPR = re.compile(r"\b(ch|chs|chf|chi|chramp|opparm|opdigits)\s*\(|\.\./|/obj/")


def _portable_expr(expr):
    """The expression to carry, or None to carry the VALUE instead.

    A transfer crosses FILES. An expression that names another node cannot mean
    the same thing on the other side — and the dangerous case is not that it
    breaks, it is that it RESOLVES: DTH node names are identical across
    projects, so `ch("/obj/DazToHue/DazToHueMaterial/…")` copied into another
    project silently rebinds to THAT project's own node and produces wrong
    values with no error. Measured: the HDA's Linking feature puts exactly this
    shape on every linkable parm of a linked node.

    So a node-referencing expression is flattened to the value it had in the
    source — which is what the user actually meant to copy. Expressions with no
    node reference (arithmetic, `$F`, a bare constant) travel as written.
    """
    if not expr:
        return None
    return None if _NODE_REF_EXPR.search(expr) else expr


def _read(node, name):
    """{"v": value, "expr": expression|None} for a parm or parm tuple.

    An expression travels only when it is PORTABLE — see `_portable_expr`. One
    that names another node is dropped and its evaluated value carried instead,
    because the transfer crosses files.
    """
    parm = node.parm(name)
    if parm is not None:
        try:
            expr = _portable_expr(parm.expression())
        except hou.OperationFailed:
            expr = None
        return {"v": parm.eval(), "expr": expr}
    tup = node.parmTuple(name)
    if tup is not None:
        exprs = []
        for one in tup:
            try:
                exprs.append(_portable_expr(one.expression()))
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


def _export_folder(node, folder):
    """A whole plain-folder subtree: its flat values plus any nested multiparms.

    The skeleton node's tabs are shaped this way (settings AND lists in one
    block), where the material node's sections are each a single multiparm.
    Same walker underneath — `_leaves_and_blocks` already separates the two.
    """
    leaves, blocks = _leaves_and_blocks(folder)
    return {
        "fields": {leaf.name(): _read(node, leaf.name()) for leaf in leaves},
        "blocks": {block.name(): _export_block(node, block, []) for block in blocks},
    }


def _import_folder(node, folder, payload):
    """Apply a folder subtree. Its lists are copied WHOLESALE.

    A configuration block is not a list you append to: adding 22 bone renames on
    top of 22 existing ones produces 44 rules, not a merged setup. So each nested
    multiparm is cleared and rebuilt to exactly the source's contents, and flat
    settings simply overwrite.
    """
    if payload is None:
        return 0
    changed = 0
    for name, rec in payload["fields"].items():
        _write(node, name, rec)
        changed += 1
    leaves, blocks = _leaves_and_blocks(folder)
    by_name = {b.name(): b for b in blocks}
    for name, instances in payload["blocks"].items():
        block = by_name.get(name)
        if block is None:
            continue
        count_parm = _count_parm(node, block, [])
        if count_parm is not None:
            count_parm.set(0)
        _import_block(node, block, [], instances)
        changed += len(instances)
    return changed


def _folder_settings_count(node, folder):
    """Non-default settings + list entries in a folder — "how much is set here".

    A raw parm count would read the same for an untouched node and a heavily
    configured one; what the user recognises is how much they changed.
    """
    leaves, blocks = _leaves_and_blocks(folder)
    total = 0
    for leaf in leaves:
        parm = node.parm(leaf.name())
        if parm is None:
            tup = node.parmTuple(leaf.name())
            if tup is not None and not all(p.isAtDefault() for p in tup):
                total += 1
            continue
        try:
            if not parm.isAtDefault():
                total += 1
        except hou.OperationFailed:
            pass
    for block in blocks:
        parm = _count_parm(node, block, [])
        if parm is not None:
            total += int(parm.eval())
    return total


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


# --- merging material slots by surface ---------------------------------------
#
# MIRROR: `apps/web/src/lib/rom/houdini-material-merge.ts` implements the same
# rule for the confirm dialog's preview, and is pinned by the same cases against
# the same two real projects. Change one, change both.


def _surface_tokens(group):
    """The claims in a `material_group` string, in order.

    Compared VERBATIM everywhere below — the attribute name is the HDA's
    business, and an exact compare cannot mistake one claim for another. A
    pattern token (`@fbx_material_name=GP*`) therefore matches nothing and
    evicts nothing: the conservative direction, since a wrong eviction deletes
    the user's work while a missed one leaves a duplicate they can see.
    """
    return [t for t in (group or "").split() if t]


def _node_slot_claims(node):
    """Every material slot on a node as `{index, name, surfaces}`, in order."""
    parm = node.parm("material")
    if parm is None:
        return []
    base = _offset(parm)
    slots = []
    for i in range(base, base + int(parm.eval())):
        name_parm = node.parm(_instance_name(SLOT_NAME_FIELD, [i]))
        group_parm = node.parm(_instance_name(SLOT_GROUP_FIELD, [i]))
        slots.append(
            {
                "index": i,
                "name": name_parm.eval() if name_parm is not None else "",
                "surfaces": _surface_tokens(
                    group_parm.eval() if group_parm is not None else ""
                ),
            }
        )
    return slots


def _payload_slot_claims(payload):
    """The same shape for the slots a transfer is about to install."""
    if payload is None:
        return []
    return [
        {
            "index": -1,
            "name": _instance_field(inst, SLOT_NAME_FIELD) or "",
            "surfaces": _surface_tokens(_instance_field(inst, SLOT_GROUP_FIELD) or ""),
        }
        for inst in payload["instances"]
    ]


def _plan_surface_merge(target_slots, incoming):
    """What installing `incoming` does to the slots a target already has.

    **A Daz surface can belong to exactly one material slot.** That invariant is
    what makes this well-defined, and neither obvious mode obeys it:

      * *Replace* wipes the list — measured, copying one `MI_Skin` onto a real
        25-slot node left it holding 1 slot and no way back but the backup.
      * *Append* merging by slot NAME leaves the target's own `Body`, `Head`,
        `Legs`… beside an incoming `Skin` that already merges all three, so the
        same surfaces end up claimed twice.

    So an incoming slot evicts exactly the slots claiming the surfaces it
    claims. A target slot claiming a MIX of taken and untaken surfaces is
    trimmed rather than dropped — dropping it whole would orphan the surfaces
    nothing else claims.

    The eviction set comes from the incoming slots' own `material_group`, read
    out of the source at transfer time, so nothing here knows what a Genesis 9
    skin is made of and no generation list has to be kept up to date.

    Returns `(evicted, trimmed, unclaimed)`:
      evicted   target slot dicts to remove
      trimmed   `(slot, kept tokens)` pairs to rewrite
      unclaimed incoming tokens NO target slot claims — a handful is ordinary,
                all of them means the two nodes describe different figures
    """
    incoming_surfaces = set()
    # First-seen order, so the report is stable and matches the JS mirror (whose
    # Set preserves insertion order).
    incoming_order = []
    incoming_names = set()
    for slot in incoming:
        if slot["name"]:
            incoming_names.add(slot["name"])
        for token in slot["surfaces"]:
            if token not in incoming_surfaces:
                incoming_surfaces.add(token)
                incoming_order.append(token)

    evicted, trimmed, claimed = [], [], set()
    for slot in target_slots:
        for token in slot["surfaces"]:
            if token in incoming_surfaces:
                claimed.add(token)
        # A name collision is its own eviction reason, independent of surfaces:
        # two slots called `Skin` render one material name (`MI_Skin`) and a
        # baker naming it could resolve to either. The incoming one is what the
        # user just asked for, so it wins.
        if slot["name"] in incoming_names:
            evicted.append(slot)
            continue
        kept = [t for t in slot["surfaces"] if t not in incoming_surfaces]
        if len(kept) == len(slot["surfaces"]):
            continue
        # Emptied by the merge — every surface it existed to claim has moved. A
        # slot that claimed NOTHING is left alone: it lost nothing, and deleting
        # an empty slot the user made is not this rule's job.
        if not kept:
            evicted.append(slot)
        else:
            trimmed.append((slot, kept))

    unclaimed = [t for t in incoming_order if t not in claimed]
    return (evicted, trimmed, unclaimed)


def _apply_surface_merge(node, payload):
    """Make room for the incoming slots. Returns (evicted, trimmed, unclaimed) names."""
    evicted, trimmed, unclaimed = _plan_surface_merge(
        _node_slot_claims(node), _payload_slot_claims(payload)
    )
    # Trim BEFORE removing: a removal renumbers every instance after it
    # (measured), which would make each index taken above stale.
    for slot, kept in trimmed:
        parm = node.parm(_instance_name(SLOT_GROUP_FIELD, [slot["index"]]))
        if parm is not None:
            parm.set(" ".join(kept))
    count_parm = node.parm("material")
    if count_parm is not None:
        for slot in sorted(evicted, key=lambda s: s["index"], reverse=True):
            count_parm.removeMultiParmInstance(slot["index"])
    return (
        [s["name"] for s in evicted],
        [s["name"] for s, _ in trimmed],
        unclaimed,
    )


def _import_section(node, section, payload, replace):
    """Apply one section. Returns (before, after, evicted, trimmed, unclaimed)."""
    folder = _folder_template(node, section["multi"])
    if folder is None or payload is None:
        return (0, 0, [], [], [])
    parm = _count_parm(node, folder, [])
    if parm is None:
        return (0, 0, [], [], [])
    before = int(parm.eval())

    evicted, trimmed, unclaimed = [], [], []
    if section.get("merge_by_surface"):
        # Deliberately ignores `replace`: for material slots BOTH modes are
        # wrong, and the only correct way to make room is to take back exactly
        # the claims the incoming slots make (`_plan_surface_merge`).
        evicted, trimmed, unclaimed = _apply_surface_merge(node, payload)
    elif replace:
        parm.set(0)

    _import_block(node, folder, [], payload["instances"])
    for name, rec in payload["extras"].items():
        _write(node, name, rec)
    return (before, int(parm.eval()), evicted, trimmed, unclaimed)


# --- node inspection ---------------------------------------------------------


def _dth_nodes(root="/"):
    """Every node the panel can work on, in scene order.

    Both kinds come back from ONE scan: opening a `.hip` costs tens of seconds,
    and making the drawer re-scan when the user switches tab would spend that
    again for a file already open.
    """
    try:
        children = hou.node(root).allSubChildren()
    except (hou.OperationFailed, hou.PermissionError):
        return []
    wanted = {kind["type"] for kind in NODE_KINDS.values()}
    return [n for n in children if n.type().name() in wanted]


# `$JOB` is process state, and a `.hip` load OVERWRITES it — so after opening
# several projects in one hython run, an unread value would silently be the
# PREVIOUS file's (measured: loading Kira after Ita left Ita's `$JOB` visible
# until the load replaced it). Seeding this before every load makes each
# reported value provably the one that file carries.
JOB_SENTINEL = "Z:/__dth_no_job__"


def _load(path):
    hou.putenv("JOB", JOB_SENTINEL)
    hou.hipFile.load(path, suppress_save_prompt=True, ignore_load_warnings=True)


def _scene_job():
    """The `$JOB` the open scene carries, '' when it carries none.

    Measured 2026-08-07: every scene answers with something — even one saved
    without ever setting `$JOB` reloads carrying Houdini's default — so the
    empty string is a guard for a case that has not been observed, not a state
    the UI has to render.
    """
    value = hou.getenv("JOB") or ""
    return "" if value == JOB_SENTINEL else _norm_path(value)


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
    """(names, materials referenced, groups referenced, layers, channel UVs)."""
    if payload is None:
        return ([], set(), set(), 0, set())
    names, materials, groups, layers, channel_uvs = [], set(), set(), 0, set()
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
            source_uv = _instance_field(layer, LAYER_SOURCE_UV_FIELD)
            if source_uv and source_uv not in INTRINSIC_UV_NAMES:
                channel_uvs.add(source_uv)
    return (names, materials, groups, layers, channel_uvs)


def _slot_names(payload):
    """Slot names in a materials payload, in order."""
    if payload is None:
        return []
    return [
        _instance_field(inst, SLOT_NAME_FIELD) or "" for inst in payload["instances"]
    ]


def _matches_material(baker_material, selected, prefix):
    """A baker names its material as rendered (`MI_Skin`); the slot is `Skin`."""
    if not baker_material:
        return False
    for name in selected:
        if baker_material == name or baker_material == prefix + name:
            return True
    return False


def _filter_payloads(payloads, selected, prefix):
    """Restrict the materials and bakers payloads to the chosen slot names.

    The unit a user actually reuses is a MATERIAL — "the same skin", "that one
    dress" — not a whole node, so a slot and the bakers naming it travel
    together. `selected` empty means every material.
    """
    if not selected:
        return payloads
    out = dict(payloads)
    materials = payloads.get("materials")
    if materials is not None:
        out["materials"] = {
            "instances": [
                inst
                for inst in materials["instances"]
                if (_instance_field(inst, SLOT_NAME_FIELD) or "") in selected
            ],
            "extras": materials["extras"],
        }
    bakers = payloads.get("bakers")
    if bakers is not None:
        out["bakers"] = {
            "instances": [
                inst
                for inst in bakers["instances"]
                if _matches_material(
                    _instance_field(inst, BAKER_MATERIAL_FIELD), selected, prefix
                )
            ],
            "extras": bakers["extras"],
        }
    return out


def _material_slots(node, bakers_payload):
    """Each material slot with the bakers that name it — the panel's pick list.

    A user reuses "the same skin" or "that one dress", so the slot and its
    bakers are shown (and copied) as one unit. `surfaces` is the slot's own
    claim list — for a G9 skin the fifteen-odd merge that makes the setup worth
    copying at all, and the input the panel's merge preview runs on.
    """
    materials = _export_section(node, SECTION_BY_KEY["materials"])
    if materials is None:
        return []
    prefix_rec = materials["extras"].get("material_prefix")
    prefix = prefix_rec["v"] if prefix_rec else ""
    slots = []
    for instance in materials["instances"]:
        name = _instance_field(instance, SLOT_NAME_FIELD) or ""
        if not name:
            continue
        group = _instance_field(instance, "material_group#") or ""
        count, layers, uvs = 0, 0, set()
        if bakers_payload is not None:
            for baker in bakers_payload["instances"]:
                if not _matches_material(
                    _instance_field(baker, BAKER_MATERIAL_FIELD), [name], prefix
                ):
                    continue
                count += 1
                for layer in baker["b"].get(BAKER_LAYER_BLOCK, []):
                    layers += 1
                    source_uv = _instance_field(layer, LAYER_SOURCE_UV_FIELD)
                    if source_uv and source_uv not in INTRINSIC_UV_NAMES:
                        uvs.add(source_uv)
        slots.append(
            {
                "name": name,
                "displayName": prefix + name,
                # The Daz surfaces merged into this slot, as the raw group
                # expressions the merge rule compares ("@fbx_material_name=Body").
                "surfaces": _surface_tokens(group),
                "bakers": count,
                "layers": layers,
                # UV names these bakers read that only a UV CHANNEL produces —
                # empty means this material copies fine without the channels.
                "channelUvs": sorted(uvs),
            }
        )
    return slots


def _blank_info(node, kind):
    return {
        "path": node.path(),
        "name": node.name(),
        "nodeType": kind,
        "networkBox": _network_box_label(node),
        "materials": 0,
        "uvChannels": 0,
        "bakers": 0,
        "layers": 0,
        "bakerNames": [],
        "materialNames": [],
        "slots": [],
        "sectionCounts": [],
    }


def _node_info(node):
    type_name = node.type().name()
    if type_name == SKELETON_TYPE:
        info = _blank_info(node, "skeleton")
        info["sectionCounts"] = [
            {
                "key": section["key"],
                "label": section["label"],
                "count": (
                    _folder_settings_count(node, _folder_template(node, section["folder"]))
                    if _folder_template(node, section["folder"]) is not None
                    else 0
                ),
            }
            for section in SKELETON_SECTIONS
        ]
        return info

    payload = _export_section(node, SECTION_BY_KEY["bakers"])
    names, _, _, layers, _ = _baker_summary(payload)
    info = _blank_info(node, "material")
    info.update(
        {
            "materials": _section_count(node, SECTION_BY_KEY["materials"]),
            "uvChannels": _section_count(node, SECTION_BY_KEY["uvChannels"]),
            "bakers": len(names),
            "layers": layers,
            "bakerNames": names,
            "materialNames": sorted(_material_names(node)),
            "slots": _material_slots(node, payload),
        }
    )
    return info


# --- operations --------------------------------------------------------------


def op_scan(request):
    projects = []
    for path in request.get("hipPaths", []):
        entry = {"hipPath": path, "ok": True, "error": "", "nodes": [], "job": "", "hipDir": ""}
        try:
            _load(path)
            entry["nodes"] = [_node_info(n) for n in _dth_nodes()]
            # Read in the SAME pass as the nodes — opening a `.hip` costs tens
            # of seconds, and the Defaults tab must not pay it a second time.
            entry["job"] = _scene_job()
            entry["hipDir"] = _norm_path(hou.getenv("HIP") or "")
        except Exception as exc:
            entry["ok"] = False
            entry["error"] = str(exc).strip() or exc.__class__.__name__
        projects.append(entry)
    return {"op": "scan", "projects": projects, "targets": []}


def op_defaults(request):
    """Repoint each project's `$JOB` at the folder the studio expects.

    `$JOB` is scene state saved with the `.hip` (`hou.putenv`, the programmatic
    File → Set Project), so an EXISTING project keeps whatever it was created
    with — which is the whole reason this exists. Houdini collapses a picked
    path to a variable only when it sits under `$HIP` or `$JOB`, so a `$JOB` on
    `<char>/houdini/houdini-project` (below the exports) can never help and a
    hand-picked export comes back ABSOLUTE.

    Only ever repairs what DIFFERS: a project already on the right folder is
    reported and left untouched, so a run never rewrites a `.hip` for nothing.
    Same guarantees as the transfer — dry run, and one rolling backup beside
    Houdini's own before any save.
    """
    dry_run = bool(request.get("dryRun"))
    results = []
    for target in request.get("targets", []):
        path = target.get("hipPath", "")
        want = _norm_path(target.get("jobDir", ""))
        result = {
            "hipPath": path,
            "ok": True,
            "error": "",
            "previousJob": "",
            "job": want,
            "changed": False,
            "backupPath": "",
        }
        if not want:
            result["ok"] = False
            result["error"] = "No project folder was given for this scene."
            results.append(result)
            continue
        try:
            _load(path)
            current = _scene_job()
            result["previousJob"] = current
            # Case-insensitive: these are Windows paths, and a case-only
            # difference is the same folder — rewriting for it would churn the
            # file forever.
            if current.lower() == want.lower():
                result["job"] = current
                results.append(result)
                continue
            result["changed"] = True
            if not dry_run:
                result["backupPath"] = _backup(path)
                hou.putenv("JOB", want)
                hou.hipFile.save(path)
        except Exception as exc:
            result["ok"] = False
            result["changed"] = False
            result["error"] = str(exc).strip() or exc.__class__.__name__
        results.append(result)
    return {"op": "defaults", "projects": [], "targets": [], "defaults": results, "dryRun": dry_run}


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
    if request.get("nodeType") == "skeleton":
        return op_transfer_skeleton(request)

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

    # The materials block is always exported: even when its section was not
    # selected it carries the prefix that maps a slot name (`Skin`) to the name
    # a baker uses (`MI_Skin`), which the filter below needs.
    all_materials = _export_section(node, SECTION_BY_KEY["materials"])
    prefix_rec = (all_materials or {"extras": {}})["extras"].get("material_prefix")
    prefix = prefix_rec["v"] if prefix_rec else ""

    payloads = {}
    for key in keys:
        payloads[key] = _export_section(node, SECTION_BY_KEY[key])
    selected_materials = [m for m in request.get("materials", []) if m]
    payloads = _filter_payloads(payloads, selected_materials, prefix)

    # Texture paths: absolute into the Daz library as the source stored them,
    # or pointed at $DAZ3D_LIB so the copy survives a moved library. Done on the
    # exported payload, so every target gets the same rewritten values.
    rewritten_paths, foreign_paths = (0, [])
    if request.get("useLibVar"):
        rewritten_paths, foreign_paths = _rewrite_lib_paths(
            payloads, request.get("dazLibRoot", "")
        )

    (
        baker_names,
        needed_materials,
        needed_groups,
        source_layers,
        needed_channel_uvs,
    ) = _baker_summary(payloads.get("bakers"))
    # UV names the copied bakers read that only a UV channel produces. Reported
    # whenever the channels are NOT part of this run, so "do I need the UV
    # channels too?" is answered by the tool rather than guessed: a clothing
    # material reads only intrinsic names and comes back empty.
    missing_uv_sources = sorted(needed_channel_uvs) if "uvChannels" not in keys else []
    # Material names the copy itself will install at the target.
    incoming_materials = set()
    if payloads.get("materials") is not None:
        for name in _slot_names(payloads["materials"]):
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
            "missingUvSources": list(missing_uv_sources),
            "unclaimedSurfaces": [],
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
                    # The dry run runs the SAME plan, it just doesn't write it —
                    # a preview computed by a second rule would be a preview of
                    # something else.
                    if section.get("merge_by_surface"):
                        evicted, trimmed, unclaimed = _plan_surface_merge(
                            _node_slot_claims(target_node), _payload_slot_claims(payload)
                        )
                        result["sections"].append(
                            {
                                "key": key,
                                "before": before,
                                "after": before - len(evicted) + incoming,
                                "evicted": [s["name"] for s in evicted],
                                "trimmed": [s["name"] for s, _ in trimmed],
                            }
                        )
                        result["unclaimedSurfaces"] = unclaimed
                    else:
                        result["sections"].append(
                            {
                                "key": key,
                                "before": before,
                                "after": incoming if replace else before + incoming,
                                "evicted": [],
                                "trimmed": [],
                            }
                        )
                    continue
                try:
                    before, after, evicted, trimmed, unclaimed = _import_section(
                        target_node, section, payload, replace
                    )
                    result["sections"].append(
                        {
                            "key": key,
                            "before": before,
                            "after": after,
                            "evicted": evicted,
                            "trimmed": trimmed,
                        }
                    )
                    if section.get("merge_by_surface"):
                        result["unclaimedSurfaces"] = unclaimed
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
        "materials": selected_materials,
        "useLibVar": bool(request.get("useLibVar")),
        "rewrittenPaths": rewritten_paths,
        "foreignPaths": foreign_paths,
        "dryRun": dry_run,
        "replace": replace,
    }


def op_transfer_skeleton(request):
    """Copy whole skeleton-tab subtrees from one node onto others.

    Simpler than the material transfer by nature: the sections are folders, not
    lists to merge, so there is no per-material filter and no append mode — see
    `_import_folder` on why a configuration block is copied wholesale.
    """
    source = request["source"]
    dry_run = bool(request.get("dryRun"))
    keys = [k for k in request.get("sections", []) if k in SKELETON_SECTION_BY_KEY]
    if not keys:
        raise ValueError("no sections selected")

    _load(source["hipPath"])
    node = hou.node(source["nodePath"])
    if node is None or node.type().name() != SKELETON_TYPE:
        raise hou.Error("The source skeleton node was not found: %s" % source["nodePath"])

    payloads = {}
    # Counted NOW, while the source scene is still the open one: loading a
    # target replaces the whole scene, and every node reference from the source
    # goes stale with it (measured — the dry run read a dead node and threw).
    source_counts = {}
    for key in keys:
        folder = _folder_template(node, SKELETON_SECTION_BY_KEY[key]["folder"])
        payloads[key] = _export_folder(node, folder) if folder is not None else None
        source_counts[key] = _folder_settings_count(node, folder) if folder is not None else 0

    by_file = []
    for target in request.get("targets", []):
        for entry in by_file:
            if entry["hipPath"] == target["hipPath"]:
                entry["nodePaths"].append(target["nodePath"])
                break
        else:
            by_file.append({"hipPath": target["hipPath"], "nodePaths": [target["nodePath"]]})

    results = []
    for entry in by_file:
        hip = entry["hipPath"]
        touched = False
        try:
            _load(hip)
        except Exception as exc:
            for node_path in entry["nodePaths"]:
                results.append(
                    {
                        "hipPath": hip,
                        "nodePath": node_path,
                        "ok": False,
                        "error": str(exc).strip() or exc.__class__.__name__,
                        "sections": [],
                        "added": [],
                        "replaced": True,
                        "missingMaterials": [],
                        "missingGroups": [],
                        "missingUvSources": [],
                        "unclaimedSurfaces": [],
                        "backupPath": "",
                    }
                )
            continue

        for node_path in entry["nodePaths"]:
            target_node = hou.node(node_path)
            result = {
                "hipPath": hip,
                "nodePath": node_path,
                "ok": True,
                "error": "",
                "sections": [],
                "added": [],
                "replaced": True,
                "missingMaterials": [],
                "missingGroups": [],
                "missingUvSources": [],
                "unclaimedSurfaces": [],
                "backupPath": "",
            }
            if target_node is None or target_node.type().name() != SKELETON_TYPE:
                result["ok"] = False
                result["error"] = "Skeleton node not found: %s" % node_path
                results.append(result)
                continue

            for key in keys:
                section = SKELETON_SECTION_BY_KEY[key]
                folder = _folder_template(target_node, section["folder"])
                if folder is None or payloads.get(key) is None:
                    continue
                before = _folder_settings_count(target_node, folder)
                if dry_run:
                    # Wholesale copy: what the source holds is what the target
                    # will hold.
                    after = source_counts.get(key, 0)
                else:
                    try:
                        _import_folder(target_node, folder, payloads[key])
                        after = _folder_settings_count(target_node, folder)
                        touched = True
                    except Exception as exc:
                        result["ok"] = False
                        result["error"] = str(exc).strip() or exc.__class__.__name__
                        break
                result["sections"].append(
                    {
                        "key": key,
                        "before": before,
                        "after": after,
                        "evicted": [],
                        "trimmed": [],
                    }
                )
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
                continue
            for result in results:
                if result["hipPath"] == hip and result["ok"]:
                    result["backupPath"] = backup

    return {
        "op": "transfer",
        "projects": [],
        "targets": results,
        "sections": keys,
        "materials": [],
        "dryRun": dry_run,
        "replace": True,
    }


OPS = {"scan": op_scan, "transfer": op_transfer, "defaults": op_defaults}


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
    payload.setdefault("materials", [])
    payload.setdefault("useLibVar", False)
    payload.setdefault("rewrittenPaths", 0)
    payload.setdefault("foreignPaths", [])
    payload.setdefault("dryRun", False)
    payload.setdefault("replace", False)
    payload.setdefault("defaults", [])

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
