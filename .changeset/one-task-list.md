---
'@dth/web': minor
---

**The live run display is one task list and one progress bar.**

It used to be three readouts side by side — a narrow column of task cards, a
tail-mode log window and a two-level meter row — which between them said the
same thing three ways and left no room for any of them to say anything useful.
Now there is a single list of what the run does, and one bar underneath it
carrying the newest thing the run said as a single line.

**One row per job**, which is what the extra room bought:

- every selected **Daz scene** says what the run does to it — *ROM + Export*,
  *ROM only*, *Export only*. That choice is made once, in a dropdown that is
  long closed by the time anyone is watching the run;
- every **DazToHue network** is its own row, named as the network is, with the
  Houdini project it belongs to beside it;
- every **export set going into an Unreal project** is its own row. Sending two
  characters to one Unreal project is two imports, so it is two rows — each
  naming the set, the project it lands in, and whether it is a **Re-import** of
  assets already there or a **First import**.

Rows are ticked off as they finish and stay in the list, so it reads as the
whole run rather than only what is left, and the mark on the right says which
application is doing it. The bar measures the whole run — every row, plus the
share of the one being worked that its leg can actually report.

The log window's **transcript** is what this gives up: only the newest line
survives, on the bar. Each leg's full output is on disk either way — the
Runner's progress log, `.dth_houdini_console.log` in the character folder, and
the Unreal editor's own log — which is where a post-mortem was read from
anyway.
