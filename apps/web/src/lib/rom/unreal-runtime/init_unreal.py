# Unreal runs `init_unreal.py` from every enabled plugin's `Content/Python`.
# This one belongs to the studio's own DTHCharacterStudioRunner plugin, so it never
# competes with the project's own init script or with mrpdean's DazToHue one.
import unreal

try:
    import dth_runner

    dth_runner.start()
except Exception:
    import traceback

    # A bridge that cannot start must not take the editor's Python startup with
    # it — the DazToHue plugin's own init runs from a different folder and is
    # none of our business.
    unreal.log_error("DTH Runner: failed to start\n" + traceback.format_exc())
