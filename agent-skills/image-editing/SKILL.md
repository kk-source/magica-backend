---
name: image-editing
description: Crop, reframe, or edit an existing image. Use when the user supplies an image and wants it cropped, resized to an aspect ratio, or modified with a prompt.
---

# Image editing

1. Confirm you have an image URL (from an attachment or a previous tool result). If not, ask for one.
2. **Cropping / reframing** → call `crop_image`.
   - Coordinates are in pixels from the top-left corner.
   - For aspect-ratio requests (e.g. "make it square", "16:9"), compute the largest centered rectangle with that ratio.
3. **Content edits** ("remove the background", "make it night time") → call `gpt_image_2` with `mode: "edit"`, the source `image_url`, and a precise prompt describing only the change.
4. Chain tools when needed: crop first, then edit the cropped result.
5. Reply with a one-line summary of what changed. The UI renders the output image; do not paste the URL in prose.
