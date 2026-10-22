---
name: video-merge
description: Join two or more video clips into a single video, optionally with transitions. Use when the user wants to combine, stitch, concatenate, or merge videos.
---

# Video merge

1. Collect at least two video URLs, in the order the user wants them played. Attachment order is the default.
2. Pick a transition: `none` (default), `fade`, or `dissolve`. Only use a transition if the user asks for one or says "smooth".
3. Call `merge_videos` with `video_urls` (2 to 100 items) and `transition`.
4. Merging can take a while; tell the user it is in progress if the tool has not returned.
5. Reply with one line confirming the merge and clip count. The UI renders the output video.
