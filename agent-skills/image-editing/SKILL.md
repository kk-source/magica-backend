---
name: image-editing
description: Crop, reframe, or edit an existing image. Use when the user supplies an image and wants it cropped, resized to an aspect ratio, or modified with a prompt.
---

# Image editing

1. Confirm you have an image URL (from an attachment or a previous tool result). If not, ask for one.
2. **Cropping / reframing** → call `crop_image`.
   - Pass `aspect_ratio` for ratio requests ("make it square" → "1:1", "for a story" → "9:16"); the tool computes exact pixels itself.
   - To focus on part of the image, add `region` in percent (0–100, from the top-left). Estimate where the subject is; you never need pixel sizes.
3. **Content edits** ("remove the background", "make it night time") → call `gpt_image_2` with the source URL in `input_images` and a precise prompt describing only the change.
4. Chain tools when needed: crop first, then edit the cropped result.
5. Reply with a one-line summary of what changed. The UI renders the output image; do not paste the URL in prose.
