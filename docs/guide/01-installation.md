# 1 · Install the app

The download button in the header picks the right build for the machine you're
reading this on.

## Windows

Download the installer (`…_x64-setup.exe`) and run it. It's **code-signed**
(publisher: *Open Source Developer Remo Vincenzo Vetere*), installs **per user**
(no admin rights), and **updates itself** — it checks on launch and installs new
versions with one click.

## macOS

Download the `…_aarch64.dmg` and drag the app to Applications. **Apple Silicon
only** (M1 and newer); there is no Intel build. It is Developer-ID signed,
notarized and stapled, so it opens without the Gatekeeper right-click dance, and
it updates itself too.

&nbsp;

> [!IMPORTANT]
> **The automation is Windows-only.** On macOS the studio still defines characters
> and generates both artifacts — **Save** writes the Daz apply-script (`.dsa`) and
> the Houdini PoseAsset CSV, and those files are the product. You run them by hand:
> the script works in Daz Studio for Mac and the CSV imports in Houdini for Mac.
>
> What needs Windows, because it drives another application or reads the registry:
> everything that **drives Daz Studio** (the [DTH Export batch](./dth-export.md),
> [Tools → Scan & index](./tools.md#tab-1--scan-amp-index), the bundled
> [Runner plugin](./02-setup.md#daz-studio-plugins)); the **DTH Exporter Plugin**
> and so [the export](./05-rom-in-daz.md#what-a-run-exports) and
> the [bone-scale reference skeletons](./custom-morphs.md); everything that
> **drives Houdini** through `hython`
> ([Generate project](./06-into-houdini.md#generate-the-houdini-project-automatically),
> [Fill network](./houdini-project-checks.md#the-general-tab), the whole
> [Utils drawer](./houdini-utils.md)); and the **installation cards** in Settings,
> which read DIM's and SideFX's Windows registration.

&nbsp;

Launch **DTH Character Studio**. You'll land on the Home screen — empty for now.
Before creating anything, do the [one-time setup](./02-setup.md).

[← Guide overview](./README.md) · [Next: One-time setup →](./02-setup.md)
