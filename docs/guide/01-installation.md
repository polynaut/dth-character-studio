# 1 · Install the app

The download button in the header picks the right build for the machine you're
reading this on.

## Windows

Download the installer (`…_x64-setup.exe`) and run it.

- It's **code-signed** (publisher: *Open Source Developer Remo Vincenzo Vetere*),
  so Windows SmartScreen lets it through without drama.
- It installs **per user** — no administrator rights needed.
- The app **updates itself**: it checks on launch and installs new versions with
  one click.

## macOS

Download the `…_aarch64.dmg` and drag the app to Applications.

- **Apple Silicon only** (M1 and newer). There is no Intel build.
- The app is **Developer-ID signed, notarized and stapled**, so it opens
  normally — no Gatekeeper right-click dance.
- It **updates itself** on macOS too.

&nbsp;

> [!IMPORTANT]
> **The automation is Windows-only.** On macOS the studio is a character
> definition and generation tool: you define the ROM and **Save** writes both
> artifacts — the Daz apply-script (`.dsa`) and the Houdini PoseAsset CSV — and
> those files are the product. Running them is then yours to do by hand.
>
> Windows-only, because each one drives another application or reads the
> Windows registry:
>
> - Everything that **drives Daz Studio** for you — the
>   [DTH Export batch](./05-rom-in-daz.md#batch-export--dth-export),
>   [Tools → Scan & index](./tools.md#tab-1--scan-amp-index), opening a scene in
>   a running Daz, and the bundled
>   [Runner plugin](./02-setup.md#daz-studio-plugins).
> - The **DTH Exporter Plugin** itself, which is a Windows Daz plugin — so
>   [direct export](./05-rom-in-daz.md#direct-export-optional-recommended) and
>   the [bone-scale reference skeletons](./custom-morphs.md) that depend on it.
> - Everything that **drives Houdini** through `hython` —
>   [Generate project](./06-into-houdini.md#generate-the-houdini-project-automatically),
>   [Fill network](./houdini-utils.md#the-general-tab), and the whole
>   [Utils drawer](./houdini-utils.md).
> - The **installation cards** in Settings, which read DIM's and SideFX's
>   Windows registration — on macOS you fill the folder paths in yourself.
>
> You can still run the generated script in Daz Studio for Mac and import the
> CSV in Houdini for Mac by hand; that is the classic workflow the studio
> automates on Windows.

&nbsp;

Launch **DTH Character Studio**. You'll land on the Home screen — empty for now.
Before creating anything, do the [one-time setup](./02-setup.md).

[← Guide overview](./README.md) · [Next: One-time setup →](./02-setup.md)
