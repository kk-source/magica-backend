---
name: image-generation
description: Generate new images from a text description. Use when the user asks to create, draw, design, or imagine an image that does not exist yet.
---

# Image generation

1. Turn the request into a concrete prompt: subject, setting, style, lighting, composition, and any text that must appear.
2. Call `gpt_image_2` with `mode: "text"` and that prompt. Do not pass `image_url`.
3. If the request is ambiguous in a way that changes the result a lot (e.g. "a logo" with no brand name), ask one short clarifying question first; otherwise make reasonable choices and state them.
4. For variations, call the tool again with a modified prompt rather than repeating the same one.
5. Reply with one line describing the image. The UI renders it.
