---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Two new utility scripts in **Scripts › DTH-Character-Studio**, for copying a
character's shape onto a clean figure. **Save Morph Snapshot** scans the selected
figure and writes every dial it actually has *set* at frame 0 to a JSON file;
**Apply Morph Snapshot** replays that snapshot — onto a figure you have selected,
or onto a stock figure of the same Genesis generation it loads for you. Only
dials whose own value differs from their default are recorded, so a shape
product's control dial is stored and the hundred morphs it drives are left to
follow it; dials the target figure does not carry (clothing, hair, a geograft the
original wore) are named in the report rather than counted away. Neither script
saves the scene. Snapshots age out after 30 days with the other scan files.
