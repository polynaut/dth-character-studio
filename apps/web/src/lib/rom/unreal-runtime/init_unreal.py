# Unreal runs `init_unreal.py` from every enabled plugin's `Content/Python`.
# This one belongs to the studio's own DTHStudioBridge plugin, so it never
# competes with the project's own init script or with mrpdean's DazToHue one.
import unreal

try:
    import dth_bridge

    dth_bridge.start()
except Exception:
    import traceback

    # A bridge that cannot start must not take the editor's Python startup with
    # it — the DazToHue plugin's own init runs from a different folder and is
    # none of our business.
    unreal.log_error("DTH bridge: failed to start\n" + traceback.format_exc())
