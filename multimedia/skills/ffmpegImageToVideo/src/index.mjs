import ffmpegImageToVideo from "./ffmpegImageToVideo.js";

export async function action(args = {}) {
  const { input, ...context } = args || {};
  return ffmpegImageToVideo(input, context);
}
