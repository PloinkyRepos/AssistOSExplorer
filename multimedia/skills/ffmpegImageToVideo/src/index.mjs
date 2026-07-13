import ffmpegImageToVideo from "./ffmpegImageToVideo.mjs";

export async function action(args = {}) {
  const { input, ...context } = args || {};
  return ffmpegImageToVideo(input, context);
}
