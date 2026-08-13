"""DazToHue material utilities — the hython half of the studio's "Utils" panel.

Runs headless under `hython`, driven by a JSON request file and answering into a
JSON result file (the same write-a-job / read-a-result handoff as `456.py`, minus
the polling: this one is synchronous and the studio waits for the process).

    hython material_utils.py <requestFile> <resultFile>

Six operations:

  scan      list every DazToHueMaterial node in a set of `.hip` files, with the
            counts the panel shows (materials / UV channels / bakers / layers)
            — plus each scene's `$JOB` and timeline FPS, read in the same pass.
  transfer  copy one source node's material SETUP onto one or more target nodes
            — any combination of the material slots, the UV channels and the
            texture bakers — appending or replacing, with a dry-run mode that
            changes nothing and reports what a real run would do.
  defaults  repoint a project's `$JOB` at the folder the studio expects, so a
            hand-picked export collapses to a variable instead of an absolute
            path — and put its timeline on the pipeline's 30 fps (`op_defaults`).
  prefill   fill the blank DazToHue parms the studio already knows (the
            Generate-project wiring, for projects that already exist), feature
            detected per parm (`op_prefill`).
  repath    make the references a project ALREADY stores portable — express
            each absolute one relative to `$HIP`/`$JOB`/`$DAZ3D_LIB`, and
            rebuild any DazToHue import path whose file isn't there
            (`op_repath`).
  refresh   run the DazToHue shelf's own "Refresh Assets" tool against a
            project, the way a user would from inside Houdini (`op_refresh`).

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

Nothing here writes to a source file, and a target `.hip` is only ever saved by
a real (non-dry) run of `transfer` / `defaults` / `prefill` / `repath` /
`refresh` — each after a single rolling backup beside Houdini's own.
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

OCCLUSION_TYPE = "DazToHueOcclusion"
GROOM_OCCLUSION_TYPE = "DazToHueGroomOcclusion"

# The two occlusion nodes, same folder-subtree shape as the skeleton node.
# Folder names MEASURED off the installed HDA's dialog script (DazToHue.hda,
# 2026-08-12) — including `occludion_…`, which is how the asset spells it; the
# name is the contract, so it is reproduced verbatim rather than corrected.
# `node_linking_folder` is deliberately absent: it is the HDA's own parameter
# LINKING block, and a reference copied into another file would rebind to that
# file's identically-named node (see `_portable_expr`, which is why every other
# linked parm travels as its value).
OCCLUSION_SECTIONS = (
    {"key": "visualise", "folder": "visualise_folder", "label": "Visualise"},
    {"key": "culling", "folder": "occludion_culling_folder", "label": "Occlusion Culling"},
)
OCCLUSION_SECTION_BY_KEY = {s["key"]: s for s in OCCLUSION_SECTIONS}

GROOM_OCCLUSION_SECTIONS = (
    {"key": "visualise", "folder": "visualise_folder", "label": "Visualise"},
    {"key": "options", "folder": "groom_occlusion_options_folder", "label": "Options"},
    {"key": "skin", "folder": "groom_occlusion_skin_folder", "label": "Skin"},
    {
        "key": "occlusionMask",
        "folder": "groom_occlusion_occlusion_folder",
        "label": "Occlusion Mask",
    },
    {"key": "textureStamp", "folder": "groom_occlusion_texture_folder", "label": "Texture Stamp"},
)
GROOM_OCCLUSION_SECTION_BY_KEY = {s["key"]: s for s in GROOM_OCCLUSION_SECTIONS}

# The kinds whose sections are plain FOLDERS copied as whole subtrees (as
# opposed to the material node, whose sections are multiparm lists that merge).
# One registry so `_node_info` and the folder transfer stay kind-agnostic: a
# future DTH node with the same shape is an entry here and nothing else.
FOLDER_KINDS = {
    "skeleton": {
        "type": SKELETON_TYPE,
        "sections": SKELETON_SECTIONS,
        "by_key": SKELETON_SECTION_BY_KEY,
        "noun": "Skeleton",
    },
    "occlusion": {
        "type": OCCLUSION_TYPE,
        "sections": OCCLUSION_SECTIONS,
        "by_key": OCCLUSION_SECTION_BY_KEY,
        "noun": "Occlusion",
    },
    "groomOcclusion": {
        "type": GROOM_OCCLUSION_TYPE,
        "sections": GROOM_OCCLUSION_SECTIONS,
        "by_key": GROOM_OCCLUSION_SECTION_BY_KEY,
        "noun": "Groom occlusion",
    },
}
FOLDER_KIND_BY_TYPE = {kind["type"]: key for key, kind in FOLDER_KINDS.items()}

# What the panel can transfer, keyed by the `nodeType` a request names.
NODE_KINDS = {"material": {"type": MATERIAL_TYPE, "sections": [s["key"] for s in SECTIONS]}}
NODE_KINDS.update(
    {
        key: {"type": kind["type"], "sections": [s["key"] for s in kind["sections"]]}
        for key, kind in FOLDER_KINDS.items()
    }
)

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

# The roots a stored path can be expressed relative to. `$JOB` FIRST and it wins
# outright — see `_ref_roots`, which no longer sorts by length.
#
# `$JOB` is the character folder (v0.64) and `$HIP` is the houdini folder INSIDE
# it. The order here IS the priority (no length sort), and it is `$HIP` first as
# of v66 — which is what Houdini itself does. Measured 2026-08-10 with
# `hou.text.collapseCommonVars` on a real project:
#
#     <char>/houdini/daz-export/primary/x.dth  ->  $HIP/daz-export/primary/x.dth
#     <char>/export/                           ->  $JOB/export/
#
# Since v0.68 put `daz-export` INSIDE the houdini folder, every import, CSV and
# reference path is below `$HIP` — no `..`, and shorter. `$JOB` still catches
# what `$HIP` cannot reach without climbing out (`<char>/export`, Houdini's own
# output beside the houdini folder), exactly as the picker falls back.
#
# v63 had these the other way round for a reason that expired with that move:
# back then the exports sat BESIDE the houdini folder, so `$HIP` could only
# reach them as `$HIP/../…`, which encodes the scene's DEPTH. It still does —
# see `_rehome_hip_ref`, which rewrites that form to `$JOB` and is unchanged.
REF_ROOT_VARS = ("$HIP", "$JOB", LIB_VAR)

# What "Generate project" wires onto a fresh network, keyed by the payload field
# the studio sends. Existing projects can't be regenerated, so the Utils drawer
# offers the same fill as an action — the name list is the one measured off the
# installed HDA in `houdini.rs`, and must stay in step with it.
#
# STRING parms only, and only ones that are currently BLANK. Two deliberate
# limits:
#   * `import_skinning_method` is a menu, so it has no "empty" state — a default
#     and a deliberate choice are indistinguishable, and overwriting the user's
#     is not worth guessing. Generation sets it on a fresh node; this doesn't.
#   * a parm the user already filled is left alone, the same posture 456.py
#     takes with a blank export directory ("respect what the user configured").
PREFILL_PARMS = (
    (
        "daztohueimport",
        (
            ("import_character_name", "characterName"),
            ("import_character_dtu_file", "dth"),
            ("import_character_fbx_file", "fbx"),
            ("import_character_alembic_file", "abc"),
            ("import_character_rom_fbx_file", "romFbx"),
        ),
    ),
    # Absent from DazToHue 2.5 (measured — the node has a `pose_asset_import_csv`
    # BUTTON instead), PRESENT from 2.5.1 on ("Auto CSV File Path", measured
    # 2026-08-10). It is reported as missing rather than skipped silently, so on
    # 2.5 the row says why, and on 2.5.1 it simply starts offering it — no code
    # change was needed for the release, only a scan-cache key that notices the
    # HDA changed (see `hdaLibraryKey`, and the gotcha that earned it).
    ("daztohueposeasset", (("pose_asset_csv_file_path", "csv"),)),
    ("daztohueexport", (("export_directory", "exportDirectory"),)),
)

# The DazToHueImport file parms, with the extension each one holds. A Daz export
# writes all three beside each other with the SAME basename
# (`primary/Ita.dth` + `.fbx` + `.abc`, measured), which is what lets a broken
# one be rebuilt from a sibling that still resolves — no scene lookup, and no
# guess: the derived file has to actually exist before it is written.
DTH_IMPORT_FILE_PARMS = (
    ("import_character_dtu_file", ".dth"),
    ("import_character_fbx_file", ".fbx"),
    ("import_character_alembic_file", ".abc"),
)

# The DazToHueMaterial baker LAYER texture parms, by name prefix:
# `material_texture_baker_layer_texture<baker>_<layer>`. A prefix rather than a
# multiparm walk on purpose — the indices are 0-based here and reading them
# wrong is the documented trap, and this needs none of them.
#
# This is the SECOND scoped existence check, and it is scoped for the same
# reason `DTH_IMPORT_FILE_PARMS` is: a whole-scene sweep flags four of Houdini's
# own scratch files on a healthy project. Measured on a real one (Kira, 11
# bakers / 43 layers, 2026-08-13): 86 FileReference parms on the material node,
# of which 51 are these, and ALL 51 resolve — zero false positives.
DTH_TEXTURE_PARM_PREFIX = "material_texture_baker_layer_texture"


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
                all of them means the two nodes describe different figures.
                EMPTY when the target has no slots at all: on a node with
                nothing on it there is no slot that COULD claim a surface, so
                every incoming one would be listed by arithmetic while saying
                nothing about the figures. Measured 2026-08-10 — a freshly
                generated project reported all 15 as unmatched, in a report
                written just after the run had created them.
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

    # Vacuous on an empty target — see the docstring.
    unclaimed = [] if not target_slots else [t for t in incoming_order if t not in claimed]
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


def _scene_fps():
    """The timeline FPS the open scene carries, `0.0` when it can't be read.

    Scene state saved with the `.hip`, exactly like `$JOB` — which is why it is
    checkable and repairable at all. It needs no sentinel of its own: `$JOB` got
    one because a `.hip` saved without ever setting it leaves the PREVIOUS file's
    value visible (measured), whereas every scene carries an FPS and a load
    applies it. `0.0` is therefore the guard for a hython that cannot answer at
    all, not a state the UI has to render — and every reader treats it as
    "unknown", never as "wrong".
    """
    try:
        return float(hou.fps())
    except Exception:
        return 0.0


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
    folder_kind = FOLDER_KIND_BY_TYPE.get(type_name)
    if folder_kind is not None:
        info = _blank_info(node, folder_kind)
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
            for section in FOLDER_KINDS[folder_kind]["sections"]
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
    # The character's current export root, when the scan is scoped to one. The
    # dry `_repair_import_refs` below needs it for the same reason `op_repath`
    # does: after a whole-folder move no sibling import path survives to read the
    # new location off, so without it the scan reports nothing broken and the
    # studio's repath button — gated on this very number — stays disabled.
    export_dir = _norm_path(request.get("exportDir", ""))
    projects = []
    for path in request.get("hipPaths", []):
        entry = {
            "hipPath": path,
            "ok": True,
            "error": "",
            "nodes": [],
            "job": "",
            "fps": 0.0,
            "imports": [],
            "exportSets": [],
            # Every key `projectRefInfoSchema` names, because this dict is what a
            # project that FAILS to load ships with. `hipRelative` was missing
            # here and is not defaulted on the zod side, so one unreadable `.hip`
            # failed the parse of the WHOLE report — every other project in the
            # sweep with it.
            "refs": {
                "collapsible": 0,
                "foreign": 0,
                "broken": [],
                "hipRelative": [],
                "missingTextures": [],
            },
            "prefill": {"fillable": [], "missing": []},
        }
        try:
            _load(path)
            entry["nodes"] = [_node_info(n) for n in _dth_nodes()]
            # Read in the SAME pass as the nodes — opening a `.hip` costs tens
            # of seconds, and the General tab must not pay it a second time.
            entry["job"] = _scene_job()
            entry["fps"] = _scene_fps()
            entry["imports"] = _scene_dth_imports()
            entry["exportSets"] = _scene_export_sets()
            entry["refs"] = _project_ref_info(export_dir)
            entry["prefill"] = _prefill_scan()
        except Exception as exc:
            entry["ok"] = False
            entry["error"] = str(exc).strip() or exc.__class__.__name__
        projects.append(entry)
    return {"op": "scan", "projects": projects, "targets": []}


# --- reference paths ---------------------------------------------------------
#
# A project is movable only when every reference is expressed relative to
# something that travels with it. Repointing `$JOB` (op_defaults) fixes what the
# user picks AFTERWARDS; this fixes what is already stored.


def _ref_roots():
    """`[(var, normalized root)]` in REF_ROOT_VARS order — `$HIP` first (v66).

    Deliberately NOT sorted by length: the declared order is the priority. `$HIP`
    nests inside `$JOB`, so preferring it means everything under the houdini
    folder — which is where `daz-export` has lived since v0.68 — anchors on the
    `.hip` itself, and `$JOB` catches only what is outside it. That is the order
    Houdini's own picker uses (see REF_ROOT_VARS for the measurement).
    """
    roots = []
    for var in REF_ROOT_VARS:
        value = _norm_path(hou.getenv(var[1:]) or "")
        if value:
            roots.append((var, value))
    return roots


def _collapse_ref(value, roots):
    """`D:/chars/Ita/daz3d/x.fbx` → `$JOB/daz3d/x.fbx`, or None to leave it.

    Deliberately NOT `hou.text.collapseCommonVars`, which is what Houdini's file
    picker uses. Measured 2026-08-07: that call is CASE- and SEPARATOR-sensitive
    — on a real project 83 of 131 texture paths were stored lowercase
    (`d:/daz 3d/…`) and it left every one of them alone, which would have
    reported them as "cannot be made portable" while the studio could plainly
    see the root. Windows paths are case-insensitive, so the compare is too —
    the same fold `_rewrite_lib_paths` already applies.
    """
    if not value or value.startswith("$"):
        return None  # already relative to something
    if not _looks_absolute(value):
        return None
    norm = _norm_path(value)
    lowered = norm.lower()
    for var, root in roots:
        if lowered == root.lower():
            return var
        if lowered.startswith(root.lower() + "/"):
            return var + norm[len(root) :]
    return None


def _rehome_hip_ref(value, roots):
    """`$HIP/../daz3d/x.fbx` → `$JOB/daz3d/x.fbx`, or None to leave it alone.

    Everything the studio generates is `$JOB`-anchored now (RUNTIME_VERSION 63),
    but projects made before that carry `$HIP/../…`. Those still RESOLVE, so
    `_collapse_ref` never saw them — it only rewrites absolute paths, and a
    value starting with `$` is already relative to something. They are worth
    rewriting anyway: `$HIP` encodes the scene's DEPTH, so moving the `.hip` one
    folder down breaks every one of them, and it disagrees with what Houdini's
    own picker writes into the same node.

    Only `$HIP` itself — `$HIPNAME` and `$HIPFILE` are different variables that
    merely share the prefix.

    And only a path that ESCAPES the houdini folder (`$HIP/../…`). A `$HIP` path
    that stays inside it is not a pre-v63 leftover: it is where Houdini itself
    writes, and its stock defaults say so — a Karma ROP's `$HIP/render/…`, a File
    Cache SOP's `$HIP/geo/…`. Those are meant to follow the scene file, which is
    exactly what `$HIP` does and `$JOB` does not, so re-anchoring them would
    change what the user's own nodes mean. `_file_ref_parms` hands us EVERY file
    parm in the scene, not just the DTH network's, so without this the health
    badge fires on any project someone has actually worked in.
    """
    if not value:
        return None
    if value[:5] not in ("$HIP/", "$HIP\\"):
        return None
    tail = value[5:].replace("\\", "/")
    if not (tail == ".." or tail.startswith("../")):
        return None
    try:
        expanded = _norm_path(hou.expandString(value))
    except Exception:
        return None
    if not expanded:
        return None
    # `..` is what makes this worth doing; resolve it before matching a root.
    expanded = _norm_path(os.path.normpath(expanded).replace("\\", "/"))
    return _collapse_ref(expanded, roots)


def _shorten_job_ref(node, value, roots):
    """`$JOB/houdini/daz-export/x.dth` → `$HIP/daz-export/x.dth`, or None.

    The other half of the v66 anchor swap. Projects generated between v63 and
    v65 hold `$JOB/<houdiniSubdir>/…` for paths that now have a shorter, and
    picker-agreeing, `$HIP/…` spelling. Both resolve — this is a shortening, not
    a repair — so it is offered by *Make paths portable* and is deliberately NOT
    part of `_project_ref_info`: badging a project that works would teach the eye
    to ignore the badge that means something is actually broken.

    **Only on DazToHue nodes.** `_file_ref_parms` hands us every file parm in the
    scene, and a `$JOB/…` path on the user's OWN nodes is their choice of anchor:
    the two spellings differ the moment the `.hip` moves relative to `$JOB`, so
    re-anchoring a cache or render output would change what their node means. The
    studio only rewrites the paths it emits itself.
    """
    if not value or value[:5] not in ("$JOB/", "$JOB\\"):
        return None
    try:
        if "daztohue" not in node.type().name().lower():
            return None
    except Exception:
        return None
    try:
        expanded = _norm_path(hou.expandString(value))
    except Exception:
        return None
    if not expanded:
        return None
    expanded = _norm_path(os.path.normpath(expanded).replace("\\", "/"))
    collapsed = _collapse_ref(expanded, roots)
    # Only a move to `$HIP` counts: re-collapsing to the same `$JOB/…` it came
    # from is not a rewrite, and reporting it would inflate every dry run.
    if collapsed is None or not collapsed.startswith("$HIP/"):
        return None
    return collapsed


def _file_ref_parms(node):
    """Every FILE-valued string parm on a node, with its raw stored value.

    Restricted to file references on purpose: a path that is not one is not a
    reference to make portable, and rewriting an arbitrary string that happens
    to look like a path is how a tool starts corrupting scenes.
    """
    out = []
    try:
        parms = node.parms()
    except (hou.OperationFailed, hou.PermissionError):
        return out
    for parm in parms:
        try:
            template = parm.parmTemplate()
            if not isinstance(template, hou.StringParmTemplate):
                continue
            if template.stringType() != hou.stringParmType.FileReference:
                continue
            # An expression is what Houdini writes back, so rewriting the value
            # it happens to evaluate to would simply be discarded.
            if parm.expression():
                continue
        except hou.OperationFailed:
            pass
        except Exception:
            continue
        try:
            raw = parm.unexpandedString()
        except Exception:
            continue
        if raw:
            out.append((parm, raw))
    return out


def _missing_texture_refs(node):
    """Baker LAYER textures on this node whose file is not there.

    Returns absolute paths, not `<node> <parm>` labels like `broken` does: a
    missing texture is a missing FILE, and one uninstalled product takes out the
    same file from a dozen layers at once. The caller de-duplicates, so the count
    the badge shows is "how many textures are gone", not "how many parms mention
    one".

    Why this is worth reporting at all, measured 2026-08-13 on DazToHue 2.5 /
    Houdini 22.0: pointing a baker's layer texture at a file that does not exist
    and baking prints `DazToHue: export started` / `baking material textures` /
    `export finished in 0:00:02` and raises NOTHING — no dialog, no node error.
    The HDA is black-boxed so the cook itself cannot be read, but its bake path
    can: `do_bake_material_textures` is a bare `cook(force=True)`, and the whole
    material PythonModule contains ONE `os.path.exists`, in the texture
    browser's drag-and-drop handler. There is no check to inherit, so the studio
    is the only thing in the pipeline that can say the file is gone.

    Blank is not missing: an unset layer texture is a layer driven by its colour
    parms, which is a normal setup and not a fault.
    """
    out = []
    try:
        # Exactly how `_dth_nodes` picks the same node — an equality test against
        # MATERIAL_TYPE, not a substring of a literal. The drawer's node list and
        # this check have to agree about what a material node IS, or a renamed
        # type would silently stop the texture check while the drawer went on
        # listing the node as scanned.
        if node.type().name() != MATERIAL_TYPE:
            return out
    except Exception:
        return out
    for parm, _raw in _file_ref_parms(node):
        try:
            if not parm.name().startswith(DTH_TEXTURE_PARM_PREFIX):
                continue
            value = parm.eval()
        except Exception:
            continue
        if not value:
            continue
        # Absolute only — `eval()` has already expanded `$DAZ3D_LIB` and friends,
        # so anything still relative would be stat'd against hython's CWD, which
        # has nothing to do with the scene: every such parm would report missing.
        # A feature whose whole claim is zero false positives under-reports here
        # rather than guess an anchor, and it keeps the promise the wire contract
        # makes (`missingTextures` is documented as absolute paths).
        if not _looks_absolute(value):
            continue
        if not os.path.exists(value):
            out.append(_norm_path(value))
    return out


def _relocated_donor(broken, export_dir):
    """A replacement folder+stem for imports that ALL broke, or None.

    The sibling rule below cannot help when the export folder itself moved: every
    import path breaks in the same instant, so there is no survivor to read the
    new location off. That is exactly what the export-root move did
    (`<char>/<daz>/dth-exports` → `<char>/<houdini>/daz-export`), and the
    character's current export root — passed in by the studio, which derives it —
    is the one thing that still knows where the files went.

    The stored path keeps its own SCENE SUBFOLDER and basename: a character
    exports each scene into its own folder under the root, so `…/summertide/
    Kira_Summertide.dth` has to land under `<new root>/summertide/`, not at the
    root. Only the root part is exchanged, which is the same prefix-swap the
    generated `.dsa` performs.

    Each broken entry is probed with its OWN extension, not the `.dth`: the three
    parms share a stem, so any one of them can confirm the relocation, and a node
    whose `.dth` parm was never filled in would otherwise never repair at all
    while its `.fbx` and `.abc` sat at the new root in plain sight.

    Returns `(folder, stem)` only when the derived file EXISTS on disk. That is
    the same standard the sibling donor holds itself to, and it is worth being
    precise about what it does and does not prove: the file is really there, so
    the path written can always be opened — it is not proof that it is the same
    file the parm used to name. The shortest candidate is the root itself, which
    a flat export layout needs, and which is also the loosest match here: a
    hand-picked `.dth` from somewhere else entirely, broken for unrelated
    reasons, is re-aimed at a same-stem file in this character's export root if
    one happens to exist. `None` otherwise, so an unrelated breakage with no
    match falls through to being REPORTED rather than "repaired" into a second
    wrong path.
    """
    if not export_dir:
        return None
    root = _norm_path(export_dir).rstrip("/")
    if not root or not os.path.isdir(root):
        return None
    for _parm, _name, ext, value in broken:
        stored = _norm_path(value)
        if not stored:
            continue
        stem = os.path.splitext(os.path.basename(stored))[0]
        parent = os.path.dirname(stored)
        # Walk the stored path's tail from longest to shortest: `<sub>/<file>`
        # for the usual per-scene layout, then the bare file for a flat one.
        # Longest first, so a scene subfolder is preferred over the root.
        tails = []
        while parent and len(tails) < 3:
            tails.append(os.path.basename(parent))
            parent = os.path.dirname(parent)
        candidates = []
        for depth in range(len(tails), -1, -1):
            candidates.append("/".join([root] + list(reversed(tails[:depth]))))
        for folder in candidates:
            if os.path.exists(_norm_path(os.path.join(folder, stem + ext))):
                return (folder, stem)
    return None


def _repair_import_refs(node, roots, dry_run, export_dir=""):
    """Rebuild a DazToHueImport path that points at a file which isn't there.

    Pre-v0.63 projects hold a `.dth` addressed through the RETIRED `dth-exports`
    junction (`$HIP/houdini-project/dth-exports/…`) while its `.fbx`/`.abc`
    siblings name the real location — measured on a real project.

    The fix comes from the node's OWN siblings, never from a scene: a Daz export
    writes all three files together with the same basename, so a sibling that
    still resolves gives both the folder and the stem. That matters because the
    node → scene mapping is genuinely ambiguous (a project can hold several
    import nodes naming the same files), and this needs none of it.

    When NOTHING resolves — the export folder itself moved — `_relocated_donor`
    supplies the same two values from the character's current export root.

    Only ever applied when the derived file EXISTS, so a repair is a verified
    fact rather than a guess. Returns `[(label, old, new)]`.

    The replacement is stored in its PORTABLE form straight away rather than
    absolute, so the collapse pass has nothing left to do to it. That is not
    cosmetic: collapsing it afterwards would make a real run report one more
    rewrite than its own dry run did, and a dry run that undercounts is worse
    than no dry run.
    """
    fixed = []
    resolved = {}
    broken = []
    for name, ext in DTH_IMPORT_FILE_PARMS:
        parm = node.parm(name)
        if parm is None:
            continue
        try:
            value = parm.eval()
        except Exception:
            continue
        if not value:
            continue
        if os.path.exists(value):
            resolved[ext] = value
        else:
            broken.append((parm, name, ext, value))
    if not broken:
        return fixed
    if resolved:
        # Any sibling that resolves will do — they all live in the export folder.
        donor = list(resolved.values())[0]
        folder = os.path.dirname(donor)
        stem = os.path.splitext(os.path.basename(donor))[0]
    else:
        relocated = _relocated_donor(broken, export_dir)
        if relocated is None:
            return fixed
        folder, stem = relocated
    for parm, name, ext, _value in broken:
        candidate = _norm_path(os.path.join(folder, stem + ext))
        if not os.path.exists(candidate):
            continue
        portable = _collapse_ref(candidate, roots) or candidate
        old = parm.unexpandedString()
        if not dry_run:
            parm.set(portable)
        fixed.append((node.path() + " " + name, old, portable))
    return fixed


# --- prefilling an existing network ------------------------------------------


def _prefill_parms_for(node):
    """The (parm, payload key) pairs this node kind takes, or ()."""
    name = node.type().name().lower()
    if "daztohue" not in name:
        return ()
    for prefix, parms in PREFILL_PARMS:
        # `daztohuegroomimport` does not contain `daztohueimport`, so the groom
        # chain is excluded by the substring itself — the explicit guard is
        # there because that is easy to break and hard to notice.
        if prefix in name and "groom" not in name:
            return parms
    return ()


def _prefill_scan():
    """`{fillable, missing}` for the open scene — what the drawer's row shows.

    `fillable` is a parm that EXISTS here and is currently blank; `missing` is
    one this DazToHue version doesn't have at all (today: the PoseAsset CSV
    path). Reporting the second is the point — it tells the user why a value
    they expected isn't offered, instead of leaving a silent gap.
    """
    info = {"fillable": [], "missing": []}
    for node in hou.node("/").allSubChildren():
        for parm_name, _key in _prefill_parms_for(node):
            label = node.path() + " " + parm_name
            parm = node.parm(parm_name)
            if parm is None:
                info["missing"].append(label)
            elif not str(parm.unexpandedString() or "").strip():
                info["fillable"].append(label)
    return info


class _AutoAnswer(object):
    """Answer every HDA dialog with button 0 for the duration of one call.

    The import node's `.dth` parm has a CALLBACK: picking a file asks "fill the
    rest automatically?" and, on yes, fills the sibling paths AND does the real
    load — which is what puts the Alembic on its rest frame. `parm.set()` never
    runs a callback (Houdini's documented behaviour), so a studio-prefilled
    project holds correct paths whose load never happened. Firing the callback
    is the fix; standing in for `hou.ui` is what makes it possible headless,
    where the dialog would raise, and unattended in a GUI, where it would wait
    forever on a click. Same shape as 456.py's DialogAnswers.
    """

    def __init__(self):
        self._saved = {}
        self._made_module = False

    def _yes(self, *args, **kwargs):
        return 0

    def __enter__(self):
        ui = getattr(hou, "ui", None)
        if ui is None:
            import types

            ui = types.ModuleType("ui")
            hou.ui = ui
            self._made_module = True
        for name in ("displayMessage", "displayConfirmation", "setStatusMessage", "triggerUpdate"):
            self._saved[name] = getattr(ui, name, None)
        ui.displayMessage = self._yes
        ui.displayConfirmation = lambda *a, **k: True
        ui.setStatusMessage = lambda *a, **k: None
        ui.triggerUpdate = lambda *a, **k: None
        return self

    def __exit__(self, *exc):
        if self._made_module:
            del hou.ui
            return False
        for name, original in self._saved.items():
            if original is None:
                try:
                    delattr(hou.ui, name)
                except AttributeError:
                    pass
            else:
                setattr(hou.ui, name, original)
        return False


def fire_import_callback(node):
    """Run the import node's `.dth` parm callback — the HDA's own "I was given
    a character" routine (auto-fill + load).

    Guarded on the file EXISTING: a project generated before the Daz export has
    run holds paths to files that aren't there yet, and asking the HDA to load
    them would fail or load nothing. Best-effort by construction — a callback
    that raises leaves the paths exactly as the prefill wrote them, which is
    the behaviour this replaces.
    """
    parm = node.parm("import_character_dtu_file")
    if parm is None:
        return False
    try:
        value = str(parm.evalAsString() or "").strip()
    except Exception:
        return False
    if not value or not os.path.exists(value):
        return False
    try:
        with _AutoAnswer():
            parm.pressButton()
        return True
    except Exception:
        return False


#: The export nodes, by type name — the same pair 456.py triggers.
EXPORT_TYPE_NAMES = ("daztohueexport", "daztohuegroomexport")


def _network_character_name(network):
    """The character name of one DazToHue network — its import node's
    `import_character_name`.

    MEASURED off the installed HDA (2.5) and off two real `.hip` files, because
    the first attempt at this read a parm that does not exist. The export node
    has NO character name of its own; it builds its output path from a GEOMETRY
    attribute:

        character_name = hou.pwd().geometry().attribValue("character_name")
        export_directory = hou.pwd().parm("export_directory").eval() + character_name + "/"

    and that attribute comes from the import node, which the HDA sets from the
    Daz payload (`import_node.parm("import_character_name").set(data["Character
    Name"])`) and which the studio prefills when it generates a project.

    So the parm is read, not the attribute: reading the attribute means COOKING
    the network — loading FBX and Alembic — which is minutes per project inside
    a scan whose whole point is to be cheap. The cost is that a network which
    overwrites the attribute downstream (a wrangle) would report its parm value
    rather than the folder it really writes; nothing measured does that, and the
    reader treats a mismatch as "not in this project", which un-ticks a row
    rather than ticking a wrong one.

    Verified against `3d-workflow_LaraCroft_G81.hiplc` (LaraClassic, LaraNaked)
    and `..._THICK.hiplc` (LaraClassic_Thick, LaraNaked_Thick) — the first
    project's two names being exactly the two folders in that character's
    `export/`.
    """
    for child in network.children():
        # `daztohuegroomimport` does NOT contain `daztohueimport`, so the groom
        # importer is excluded by the same test 456.py uses for the scene id.
        if "daztohueimport" not in child.type().name().lower():
            continue
        parm = child.parm("import_character_name")
        if parm is None:
            continue
        try:
            value = str(parm.evalAsString() or "").strip()
        except Exception:
            continue
        if value:
            return value
    return ""


def _scene_export_sets():
    """The EXPORT-SET names this project writes — one per export node, from its
    own network's import node ({@link _network_character_name}).

    The HDA appends that name to `export_directory`, so it IS the folder under
    the character's `export/` and therefore the set that reaches Unreal.
    Nothing else on the studio side knows it.

    Why it earns a line in the scan: without it "does this Unreal project
    already have what this run produces?" is unanswerable, and the dialog fell
    back to "does it hold ANY set of this character?" — which pre-ticked an
    Unreal project for a run about to export a variant that project had never
    seen. Read in the same pass as the nodes; opening a `.hip` is the expensive
    part and it is already open.
    """
    found = []
    seen = set()
    for node in hou.node("/").allSubChildren():
        if node.type().name().lower() not in EXPORT_TYPE_NAMES:
            continue
        value = _network_character_name(node.parent())
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        found.append(value)
    return found


def _scene_dth_imports():
    """EVERY `.dth` this project's networks import, normalized + deduped.

    The studio WROTE those files at paths it computes, so each one identifies
    the Daz scene behind a network exactly — far steadier than a node or
    network-box name, which the user renames freely. Read in the scan pass and
    stored with the project, so the DTH Export dialog can tell which projects
    a scene selection actually involves WITHOUT opening a `.hip` (tens of
    seconds each). The same FIELD 456.py matches on at export time.

    Not the same normalization, though, and the reader is built for that:
    456.py's `normalize()` goes through `os.path.realpath` (mapped drive → UNC,
    junction spellings), which needs the file to be reachable from THIS
    process; the scan stays on `os.path.normpath` like its sibling
    `_wired_scene_dth`, because a scan entry is cached for months and a
    physical resolution would bake one machine's mount layout into it. So a
    spelling here can differ from the one the run compares — which is exactly
    why `hipsForSelectedScenes` only DROPS a project on a positive match
    against a deselected scene, never on a failure to match anything.
    """
    found = []
    seen = set()
    for node in hou.node("/").allSubChildren():
        name = node.type().name().lower()
        if "daztohueimport" not in name or "groom" in name:
            continue
        parm = node.parm("import_character_dtu_file")
        if parm is None:
            continue
        try:
            value = str(parm.evalAsString() or "").strip()
        except Exception:
            continue
        if not value:
            continue
        # Expansion of a `$HIP`/`$JOB`-relative parm leaves `..` hops — collapse
        # them, or the path can never match the studio's absolute key.
        key = _norm_path(os.path.normpath(value)).lower()
        if key and key not in seen:
            seen.add(key)
            found.append(key)
    return found


def _wired_scene_dth():
    """The scene the open hip's network imports, as a normalized lowercase
    absolute `.dth` path — read (expanded) off the first DazToHueImport node
    whose dtu parm is set. '' when no import is wired yet."""
    for node in hou.node("/").allSubChildren():
        name = node.type().name().lower()
        if "daztohueimport" not in name or "groom" in name:
            continue
        parm = node.parm("import_character_dtu_file")
        if parm is None:
            continue
        try:
            value = str(parm.evalAsString() or "").strip()
        except Exception:
            value = ""
        if value:
            # Expansion of a `$HIP`-relative parm leaves `..` hops — collapse
            # them, or the path can never match the studio's absolute key.
            return _norm_path(os.path.normpath(value)).lower()
    return ""


def op_prefill(request):
    """Fill the blank DazToHue parms the studio already knows the answer to.

    The companion to Generate project, for projects that already exist and so
    can never be regenerated. Same values, same names, same feature detection: a
    parm this DazToHue release doesn't carry is REPORTED as missing rather than
    failing anything, so the day the CSV-path release lands the same action
    starts filling it with no code change.

    Non-destructive by construction — only blank parms are written, so running
    it can never overwrite something the user set by hand.

    Values arrive PER TARGET: `$HIP`-relative paths depend on how deep that
    particular `.hip` sits, which differs between a generated project and a
    hand-made one. A target may also carry `sceneValues` — per-scene value sets
    keyed by absolute `.dth` path — and the set matching the network's own wired
    import wins over the default (primary) `values`: a project wired to an
    outfit scene must be offered the OUTFIT's paths, not the primary's. One
    scene per hip — read off the first wired import node.
    """
    dry_run = bool(request.get("dryRun"))
    results = []
    for target in request.get("targets", []):
        path = target.get("hipPath", "")
        values = target.get("values") or {}
        result = {
            "hipPath": path,
            "ok": True,
            "error": "",
            "filled": [],
            "skippedMissing": [],
            "skippedSet": [],
            "backupPath": "",
        }
        try:
            _load(path)
            scene_values = target.get("sceneValues") or {}
            if scene_values:
                picked = scene_values.get(_wired_scene_dth())
                if picked:
                    values = picked
            changed = 0
            # The `.dth` FIRST, through the HDA's own callback: it fills the
            # sibling paths and does the load that puts the Alembic on its rest
            # frame (see fire_import_callback). Everything it fills then reads
            # as "already set" below and is left alone — the loop only writes
            # blanks — so the studio fills the gaps rather than overruling the
            # tool. A project whose exports don't exist yet skips this and gets
            # the plain paths, exactly as before.
            for node in hou.node("/").allSubChildren():
                if "daztohueimport" not in node.type().name().lower():
                    continue
                parm = node.parm("import_character_dtu_file")
                dth = str(values.get("dth") or "")
                if parm is None or not dth:
                    continue
                if str(parm.unexpandedString() or "").strip():
                    continue
                if dry_run:
                    continue
                parm.set(dth)
                if fire_import_callback(node):
                    result["filled"].append(
                        {"label": node.path() + " import_character_dtu_file (auto-filled)", "value": dth}
                    )
                    changed += 1
            for node in hou.node("/").allSubChildren():
                for parm_name, key in _prefill_parms_for(node):
                    label = node.path() + " " + parm_name
                    parm = node.parm(parm_name)
                    if parm is None:
                        result["skippedMissing"].append(label)
                        continue
                    value = str(values.get(key) or "")
                    if not value:
                        continue  # the studio has no answer for this one
                    if str(parm.unexpandedString() or "").strip():
                        result["skippedSet"].append(label)
                        continue
                    if not dry_run:
                        parm.set(value)
                    result["filled"].append({"label": label, "value": value})
                    changed += 1
            if changed and not dry_run:
                result["backupPath"] = _backup(path)
                hou.hipFile.save(path)
        except Exception as exc:
            result["ok"] = False
            result["error"] = str(exc).strip() or exc.__class__.__name__
            result["filled"] = []
        results.append(result)
    return {"op": "prefill", "projects": [], "targets": [], "prefill": results, "dryRun": dry_run}


def _project_ref_info(export_dir=""):
    """What a repath WOULD do to the open scene — read-only, for the scan.

    Runs the exact helpers `op_repath` runs (with `dry_run`), so the tab can
    never promise a number the action then doesn't deliver — and, just as
    load-bearing, never UNDER-reports one either: `export_dir` has to be the same
    value `op_repath` gets, or the scan misses every repair only the relocation
    donor can make and the studio disables the button on the strength of it.
    """
    roots = _ref_roots()
    info = {"collapsible": 0, "foreign": 0, "broken": [], "hipRelative": [], "missingTextures": []}
    missing_textures = set()
    for node in hou.node("/").allSubChildren():
        for label, _old, _new in _repair_import_refs(node, roots, True, export_dir):
            info["broken"].append(label)
        missing_textures.update(_missing_texture_refs(node))
        for parm, raw in _file_ref_parms(node):
            if _rehome_hip_ref(raw, roots) is not None:
                # Pre-v63 `$HIP/../…` — a path that LEAVES the houdini folder.
                # It resolves today, but is depth-fragile and at odds with what
                # Houdini's picker writes, so the card names it. A `$HIP` path
                # that stays inside (Houdini's own render/cache defaults) is
                # deliberately not counted — see `_rehome_hip_ref`.
                info["hipRelative"].append(node.path() + " " + parm.name())
            elif _collapse_ref(raw, roots) is not None:
                info["collapsible"] += 1
            elif raw and not raw.startswith("$") and _looks_absolute(raw):
                info["foreign"] += 1
    # Sorted so the badge's wording is stable between two scans of an unchanged
    # project — `allSubChildren()` order is not a promise.
    info["missingTextures"] = sorted(missing_textures)
    return info


def op_repath(request):
    """Make a project's stored references portable, and repair broken ones.

    Two fixes in one pass because they touch the same parms and want the same
    single backup: rebuild any DazToHueImport path whose file isn't there, then
    express every absolute reference relative to `$HIP` / `$JOB` /
    `$DAZ3D_LIB`.

    `$JOB` must already be correct — the caller passes the folder it expects and
    a mismatch is REFUSED rather than repathed, because collapsing against a
    stale `$JOB` would bake the old project folder into every path it touched.
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
            "collapsed": 0,
            "repaired": [],
            "foreign": [],
            "backupPath": "",
        }
        export_dir = _norm_path(target.get("exportDir", ""))
        try:
            _load(path)
            current = _scene_job()
            if want and current.lower() != want.lower():
                raise hou.Error(
                    "This project's $JOB is still %s — repair it first, or every "
                    "path here would be stored relative to the old project folder." % current
                )
            roots = _ref_roots()
            changed = 0
            foreign = set()
            for node in hou.node("/").allSubChildren():
                for label, old, new in _repair_import_refs(node, roots, dry_run, export_dir):
                    result["repaired"].append({"label": label, "from": old, "to": new})
                    changed += 1
                for parm, raw in _file_ref_parms(node):
                    # Three passes, most specific first: re-anchor a pre-v63
                    # `$HIP/../…` on `$JOB`, shorten a v63–v65 `$JOB/houdini/…`
                    # to `$HIP/…` on the studio's own nodes, then the ordinary
                    # absolute-path collapse. Explicit `is None` rather than
                    # `or`: these return None to mean "not mine", and a
                    # falsy-but-real answer must not fall through to the next.
                    collapsed = _rehome_hip_ref(raw, roots)
                    if collapsed is None:
                        collapsed = _shorten_job_ref(node, raw, roots)
                    if collapsed is None:
                        collapsed = _collapse_ref(raw, roots)
                    if collapsed is None:
                        # Absolute and under none of the known roots: it cannot
                        # be made portable, so it is REPORTED rather than
                        # silently left looking handled.
                        if raw and not raw.startswith("$") and _looks_absolute(raw):
                            foreign.add(_norm_path(raw))
                        continue
                    if not dry_run:
                        parm.set(collapsed)
                    result["collapsed"] += 1
                    changed += 1
            result["foreign"] = sorted(foreign)
            if changed and not dry_run:
                result["backupPath"] = _backup(path)
                hou.hipFile.save(path)
        except Exception as exc:
            result["ok"] = False
            result["error"] = str(exc).strip() or exc.__class__.__name__
            result["collapsed"] = 0
            result["repaired"] = []
        results.append(result)
    return {"op": "repath", "projects": [], "targets": [], "repath": results, "dryRun": dry_run}


#: How close a scene's FPS has to be to count as the wanted one. Houdini's FPS
#: is a float and 29.97/23.976 are real values, so an exact compare on a number
#: that made a JSON round trip is the wrong kind of strict. MIRROR of `sameFps`
#: in `lib/rom/houdini-defaults.ts` — the studio decides what to send, this
#: decides whether to write it, and the two must agree or the drawer offers a
#: repair that then reports "already correct".
FPS_EPSILON = 0.001


def op_defaults(request):
    """Repoint each project's `$JOB`, and put its timeline on the studio's FPS.

    Both are scene state saved with the `.hip` — `$JOB` via `hou.putenv` (the
    programmatic File → Set Project), the FPS via `hou.setFps` — so an EXISTING
    project keeps whatever it was created with, which is the whole reason this
    exists. Houdini collapses a picked path to a variable only when it sits
    under `$HIP` or `$JOB`, so a `$JOB` on `<char>/houdini/houdini-project`
    (below the exports) can never help and a hand-picked export comes back
    ABSOLUTE. And a scene left on Houdini's own default 24 fps puts every
    imported ROM frame between two of its own, while the PoseAsset CSV names
    frame numbers generated at 30.

    They travel together because they are one file open, one backup, one save —
    and each is compared separately, so a project needing only one gets only
    that one written.

    `fps` is what the caller wants; it is only ever applied when it is a real
    positive number AND the scene's own reads differently. `hou.setFps` is
    called with the value alone, so what it does to any keyframes already in the
    scene is Houdini's documented default — NOT something this studio has
    measured. The rolling backup below is what makes that recoverable.

    Only ever repairs what DIFFERS: a project already on the right folder and
    the right timeline is reported and left untouched, so a run never rewrites a
    `.hip` for nothing. Same guarantees as the transfer — dry run, and one
    rolling backup beside Houdini's own before any save.
    """
    dry_run = bool(request.get("dryRun"))
    results = []
    for target in request.get("targets", []):
        path = target.get("hipPath", "")
        want = _norm_path(target.get("jobDir", ""))
        try:
            want_fps = float(target.get("fps") or 0)
        except (TypeError, ValueError):
            want_fps = 0.0
        result = {
            "hipPath": path,
            "ok": True,
            "error": "",
            "previousJob": "",
            "job": want,
            "previousFps": 0.0,
            "fps": want_fps,
            "changed": False,
            "changedJob": False,
            "changedFps": False,
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
            current_fps = _scene_fps()
            result["previousFps"] = current_fps
            # Case-insensitive: these are Windows paths, and a case-only
            # difference is the same folder — rewriting for it would churn the
            # file forever. An EMPTY current is the sentinel case — the scene
            # never carried a `$JOB` the scan could read — and a project can
            # reach this run for its FPS alone, so unknown has to stay
            # unwritten HERE too, not just unqueued in the drawer.
            if current and current.lower() != want.lower():
                result["changedJob"] = True
            else:
                result["job"] = current
            # A scene whose FPS could not be read (0) is left alone for the same
            # reason an unknown `$JOB` is: nothing was seen, so nothing is known
            # to be wrong. Same for a caller that sent no value. `>=` because
            # `sameFps` says same on `< FPS_EPSILON` — this is its exact
            # complement, so the drawer never queues a repair this refuses.
            if (
                want_fps > 0
                and current_fps > 0
                and abs(current_fps - want_fps) >= FPS_EPSILON
            ):
                result["changedFps"] = True
            else:
                result["fps"] = current_fps
            result["changed"] = result["changedJob"] or result["changedFps"]
            if not result["changed"]:
                results.append(result)
                continue
            if not dry_run:
                result["backupPath"] = _backup(path)
                if result["changedJob"]:
                    hou.putenv("JOB", want)
                if result["changedFps"]:
                    hou.setFps(want_fps)
                hou.hipFile.save(path)
        except Exception as exc:
            result["ok"] = False
            result["changed"] = False
            result["changedJob"] = False
            result["changedFps"] = False
            result["error"] = str(exc).strip() or exc.__class__.__name__
        results.append(result)
    return {"op": "defaults", "projects": [], "targets": [], "defaults": results, "dryRun": dry_run}


# --- running the DazToHue shelf's own "Refresh Assets" ------------------------
#
# Same strategy as `create_houdini_project` (houdini.rs), for the same reason:
# the shelf tool's script IS the ground truth of what "refresh the assets" means
# in this DazToHue release, so executing it tracks every release automatically
# instead of the studio reimplementing a guess at it. Nothing here knows what
# the tool does — which is exactly why it can't fall out of date.

#: The tool to run, as a normalized label (`Refresh Assets` → `refreshassets`).
REFRESH_TOOL_TOKEN = "refreshassets"
#: What marks a shelf — and, in the fallback, a tool — as DazToHue's.
DTH_TOOL_TOKEN = "daztohue"


def _normalize_label(text):
    """Lowercase alphanumerics only: `Refresh  Assets!` → `refreshassets`.

    Neither the exact spacing nor the capitalisation of a shelf tool's label is
    a contract, so neither is matched on.
    """
    return "".join(ch for ch in (text or "").lower() if ch.isalnum())


def _tool_label(tool):
    """A shelf tool's human name — its label, or its internal name."""
    for read in (tool.label, tool.name):
        try:
            value = read()
        except Exception:
            continue
        if value:
            return value
    return ""


def _tool_haystack(tool):
    """Label AND internal name, normalized and joined — what a match looks in.

    Takes a shelf as happily as a tool: both carry `label()` and `name()`.
    """
    parts = []
    for read in (tool.label, tool.name):
        try:
            parts.append(_normalize_label(read()))
        except Exception:
            pass
    return " ".join(parts)


def _shelf_tools():
    """`(tools on a DazToHue shelf, every tool)`.

    The shelf is checked FIRST because a label like "Refresh Assets" is generic
    enough that another package could carry one — and a stray tool of that name
    doing something else to the user's scene is the one outcome worth ruling
    out. Every tool is the fallback, since a user can drag the tool onto a shelf
    of their own and the DazToHue shelf then no longer holds it.
    """
    try:
        every = list(hou.shelves.tools().values())
    except Exception:
        return ([], [])
    dth = []
    try:
        for shelf in hou.shelves.shelves().values():
            if DTH_TOOL_TOKEN not in _tool_haystack(shelf):
                continue
            dth.extend(shelf.tools())
    except Exception:
        dth = []
    return (dth, every)


def _refresh_tool():
    """The "Refresh Assets" shelf tool, or None plus what WAS on offer.

    The second half of that answer is the point: this studio has never measured
    the tool's exact label, so a miss must be diagnosable rather than a flat
    "not found" — the same reason `create_houdini_project` reports every
    DazToHue node type hython could see. The list is scoped to DazToHue's own
    tools; naming all several hundred of Houdini's would tell nobody anything.
    """
    dth, every = _shelf_tools()
    for pool in (dth, every):
        for tool in pool:
            if REFRESH_TOOL_TOKEN in _tool_haystack(tool):
                return (tool, [])
    offered = dth or [t for t in every if DTH_TOOL_TOKEN in _tool_haystack(t)]
    return (None, sorted({label for label in map(_tool_label, offered) if label}))


def op_refresh(request):
    """Run "Refresh Assets" on each project, the way a user would in Houdini.

    Why it exists: a `.hip` stores the DazToHue asset definitions it was built
    with, so switching the installed DazToHue release leaves every existing
    project on the old ones. The shelf tool is the vendor's own answer to that,
    and until now the only way to reach it was to open each project by hand.

    Deliberately NOT modelled as a check with a verdict: nothing in a scanned
    project says whether it needs this, and nothing afterwards says whether it
    worked. So it is offered as an action the user chooses, and reported by what
    actually happened rather than by a promise.

    `changed` is `hou.hipFile.hasUnsavedChanges()` read after the tool ran — the
    scene reporting itself modified. It is NOT a claim about what the tool
    touched, and a project that reports no change is saved not at all rather
    than rewritten for nothing.

    A dry run still loads each project and runs the tool; it simply never saves.
    That is a weaker promise than the other operations' dry runs and the drawer
    says so: this executes third-party code, so "the file was not saved" is the
    honest guarantee — not "nothing was written".
    """
    dry_run = bool(request.get("dryRun"))
    # Shelf tools are process state, not scene state — resolved once, before any
    # project is opened, so a missing tool costs no `.hip` load at all.
    tool, offered = _refresh_tool()
    results = []
    for target in request.get("targets", []):
        path = target.get("hipPath", "")
        result = {
            "hipPath": path,
            "ok": True,
            "error": "",
            "tool": "",
            "changed": False,
            "availableTools": [],
            "backupPath": "",
        }
        if tool is None:
            result["ok"] = False
            result["error"] = (
                'No "Refresh Assets" tool was found on the DazToHue shelf. hython '
                "reads the shelves from the Houdini documents folder set in "
                "Settings — check that DazToHue is installed for this Houdini "
                "version."
            )
            result["availableTools"] = offered
            results.append(result)
            continue
        try:
            result["tool"] = _tool_label(tool)
            _load(path)
            # `kwargs` empty, as in `create_houdini_project`: a shelf script that
            # reaches for the pane it was clicked in has none here, and that
            # surfaces as this project's own error rather than taking the run down.
            exec(tool.script(), {"hou": hou, "kwargs": {}})
            changed = bool(hou.hipFile.hasUnsavedChanges())
            result["changed"] = changed
            if changed and not dry_run:
                result["backupPath"] = _backup(path)
                hou.hipFile.save(path)
        except Exception as exc:
            result["ok"] = False
            result["changed"] = False
            result["error"] = str(exc).strip() or exc.__class__.__name__
        results.append(result)
    return {"op": "refresh", "projects": [], "targets": [], "refresh": results, "dryRun": dry_run}


def _backup(path):
    """One rolling backup per project, inside Houdini's own `backup/` folder.

    Deliberately NOT timestamped: a `.hiplc` here is ~8 MB and an unbounded
    trail would quietly fill the user's drive. The most recent pre-transfer
    state is what a mistake needs.

    Taken on every real run and reported in `backupPath`, but the studio only
    ever SHOWS it on a failure, where it becomes the offer to revert
    (`restore_houdini_backup`). A run that worked has nothing to undo.

    Lifetime is the drawer SESSION: the studio collects every `backupPath` it
    was handed and offers to delete them when the panel closes
    (`discardHoudiniBackups`), because an ~8 MB copy beside every project the
    user ever ran this on is how a disk fills. Nothing here depends on that —
    a copy that survives is simply the next run's rolling target.
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
    kind = FOLDER_KINDS.get(request.get("nodeType"))
    if kind is not None:
        return op_transfer_folders(request, kind)

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
                        # The backup travels with the FAILURE too, not only with
                        # the successes: a save that raised is the one moment
                        # the pre-run state is worth having, and the studio
                        # offers it as a revert from exactly this field.
                        result["backupPath"] = backup
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


def op_transfer_folders(request, kind):
    """Copy whole folder subtrees from one node onto others.

    Serves every FOLDER_KINDS entry — the skeleton node's tabs, and both
    occlusion nodes' — because they are one shape: plain folders mixing flat
    settings with nested multiparm lists. Simpler than the material transfer by
    nature: the sections are folders, not lists to merge, so there is no
    per-material filter and no append mode — see `_import_folder` on why a
    configuration block is copied wholesale.
    """
    by_key = kind["by_key"]
    node_type = kind["type"]
    noun = kind["noun"]
    source = request["source"]
    dry_run = bool(request.get("dryRun"))
    keys = [k for k in request.get("sections", []) if k in by_key]
    if not keys:
        raise ValueError("no sections selected")

    _load(source["hipPath"])
    node = hou.node(source["nodePath"])
    if node is None or node.type().name() != node_type:
        raise hou.Error(
            "The source %s node was not found: %s" % (noun.lower(), source["nodePath"])
        )

    payloads = {}
    # Counted NOW, while the source scene is still the open one: loading a
    # target replaces the whole scene, and every node reference from the source
    # goes stale with it (measured — the dry run read a dead node and threw).
    source_counts = {}
    missing = []
    for key in keys:
        folder = _folder_template(node, by_key[key]["folder"])
        if folder is None:
            missing.append(by_key[key])
            continue
        payloads[key] = _export_folder(node, folder)
        source_counts[key] = _folder_settings_count(node, folder)
    # LOUD, not skipped. The folder names are the contract with the installed
    # HDA and they are the thing most likely to be wrong (they were read off a
    # black-boxed asset's dialog script — see `.ai/gotchas.md`), so a DTH
    # release that renames one must fail this run rather than let it report a
    # cheerful "Transfer complete" over a copy that never happened.
    if missing:
        raise hou.Error(
            "The source %s node has no %s folder (looked for %s). This DazToHue "
            "version may name it differently — nothing was copied."
            % (
                noun.lower(),
                ", ".join(s["label"] for s in missing),
                ", ".join(s["folder"] for s in missing),
            )
        )

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
            if target_node is None or target_node.type().name() != node_type:
                result["ok"] = False
                result["error"] = "%s node not found: %s" % (noun, node_path)
                results.append(result)
                continue

            # Every folder resolved BEFORE anything is written: a target missing
            # one is reported as a failure for that target and left completely
            # alone, rather than half-copied. (The source is checked up front and
            # is the same node type, so this is the anomalous case — a target
            # built on a different DazToHue version.)
            folders = {key: _folder_template(target_node, by_key[key]["folder"]) for key in keys}
            absent = [by_key[key]["label"] for key in keys if folders[key] is None]
            if absent:
                result["ok"] = False
                result["error"] = "No %s folder on this node — nothing was copied to it." % (
                    ", ".join(absent)
                )
                results.append(result)
                continue

            for key in keys:
                folder = folders[key]
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
                        # See the material transfer above — a failed save is
                        # precisely when the pre-run backup has to be reachable.
                        result["backupPath"] = backup
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


OPS = {
    "scan": op_scan,
    "transfer": op_transfer,
    "defaults": op_defaults,
    "repath": op_repath,
    "prefill": op_prefill,
    "refresh": op_refresh,
}


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
    payload.setdefault("repath", [])
    payload.setdefault("prefill", [])
    payload.setdefault("refresh", [])

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
