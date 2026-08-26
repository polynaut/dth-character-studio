//! FFI contract tests — the Rust half.
//!
//! The shared fixtures under `contracts/` (repo root) ARE the wire format of
//! the structured command returns. Each fixture must ROUND-TRIP through the
//! serde structs here (deserialize → re-serialize → byte-identical JSON
//! value): a renamed, added or removed field — or a casing change — fails
//! this test. The matching vitest (`apps/web/src/lib/rom/api/
//! native-contract.test.ts`) parses the SAME fixtures through the zod schemas
//! the api layer validates with, so the two sides of the invoke boundary
//! cannot drift apart silently. Adding a structured command return = add a
//! fixture + a case on BOTH sides.

use serde_json::Value;

fn round_trip<T: serde::de::DeserializeOwned + serde::Serialize>(fixture: &str) {
    let value: Value = serde_json::from_str(fixture).expect("fixture is valid JSON");
    let typed: T =
        serde_json::from_value(value.clone()).expect("fixture deserializes into the struct");
    assert_eq!(
        serde_json::to_value(&typed).expect("struct re-serializes"),
        value,
        "re-serialized JSON differs from the fixture"
    );
}

#[test]
fn pose_asset_frames_matches_the_shared_fixture() {
    round_trip::<Vec<crate::poses::PoseAssetFrames>>(include_str!(
        "../../../contracts/pose-asset-frames.json"
    ));
}

#[test]
fn houdini_installs_matches_the_shared_fixture() {
    round_trip::<Vec<crate::houdini_install::HoudiniInstall>>(include_str!(
        "../../../contracts/houdini-installs.json"
    ));
}

#[test]
fn unreal_engine_installs_match_the_shared_fixture() {
    round_trip::<Vec<crate::unreal_install::UnrealEngineInstall>>(include_str!(
        "../../../contracts/unreal-installs.json"
    ));
}

#[test]
fn unreal_plugin_sources_match_the_shared_fixture() {
    round_trip::<Vec<crate::unreal_install::UnrealPluginSource>>(include_str!(
        "../../../contracts/unreal-plugins.json"
    ));
}

#[test]
fn unreal_project_state_matches_the_shared_fixture() {
    round_trip::<crate::unreal_install::UnrealProjectState>(include_str!(
        "../../../contracts/unreal-project-state.json"
    ));
}

#[test]
fn unreal_open_projects_match_the_shared_fixture() {
    round_trip::<crate::unreal_install::UnrealOpenProjects>(include_str!(
        "../../../contracts/unreal-open-projects.json"
    ));
}

#[test]
fn scene_wearables_matches_the_shared_fixture() {
    round_trip::<crate::poses::SceneWearables>(include_str!(
        "../../../contracts/scene-wearables.json"
    ));
}

#[test]
fn sweep_report_matches_the_shared_fixture() {
    round_trip::<crate::housekeeping::SweepReport>(include_str!(
        "../../../contracts/sweep-report.json"
    ));
}

#[test]
fn install_report_matches_the_shared_fixture() {
    round_trip::<crate::report::InstallReport>(include_str!(
        "../../../contracts/install-report.json"
    ));
}

#[test]
fn dedup_report_matches_the_shared_fixture() {
    round_trip::<crate::dedup::DedupReport>(include_str!(
        "../../../contracts/dedup-report.json"
    ));
}

#[test]
fn material_util_report_matches_the_shared_fixture() {
    round_trip::<crate::houdini_material::MaterialUtilReport>(include_str!(
        "../../../contracts/material-util-report.json"
    ));
}

#[test]
fn export_zip_report_matches_the_shared_fixture() {
    round_trip::<crate::character_zip::ExportZipReport>(include_str!(
        "../../../contracts/export-zip-report.json"
    ));
}

#[test]
fn dim_owners_match_the_shared_fixture() {
    round_trip::<Vec<crate::dim::DimOwner>>(include_str!("../../../contracts/dim-owners.json"));
}

#[test]
fn remap_results_match_the_shared_fixture() {
    round_trip::<Vec<crate::drives::RemapResult>>(include_str!(
        "../../../contracts/remap-results.json"
    ));
}
