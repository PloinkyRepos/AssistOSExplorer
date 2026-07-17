# ffmpegImageToVideo

Generate an MP4 from a list of images, optional audio, and rendering parameters (`duration`, `fps`, `width`, `height`, `bg`). Uploads the rendered video to the blob store and returns the resulting metadata.

## Input Format
Provide `input` as a JSON object. Example:

```json
{
  "images": ["blob-id-1", "blob-id-2"],
  "audio": "audio-blob-id",
  "duration": 6,
  "fps": 25,
  "width": 1280,
  "height": 720
}
```

## Output Format
Returns a JSON object containing upload metadata such as `id`, `downloadUrl`, `localPath`, `mime`, and `size`.
