---
title: Export design screens to docs/screens
type: wayfinder:task
mode: AFK
status: closed
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

Export every top-level frame of docs/split.pen as a PNG into docs/screens/ (named NN-<frame name>.png) through the Pencil MCP, and write docs/screens/README.md indexing the 31 frames as mobile, Web App or landing. Later decisions react to these images.

## Resolution

All 31 top-level frames of `docs/split.pen` are exported as 1x PNGs to `docs/screens/`, named `NN-<frame name>.png` (390×844 for the 27 mobile screens, 1440×2500 for the landing page, 1440×900 for the 3 web app layouts), with an index at `docs/screens/README.md`. Dimensions of a sample were verified, and screen 23 was opened to check the render.

Divergences already visible, for **Reconcile the designs with the decisions**: the currency picker (screen 23, 幣別與匯率選擇) offers JPY and EUR, but v1 supports TWD and USD only; the landing page (screen 21) still carries the 小芽 brand in a different form from the settled name 小芽分帳.

A first export attempt wrote the 82 sub-frames by mistake (status bars, content, navigation); those files were deleted at once and replaced with the 31 screens.
