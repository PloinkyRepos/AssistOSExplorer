export function validateHeadlessWebMeetProfile({
  enabled,
  headed,
  media,
  screen,
} = {}) {
  if (!enabled) return Object.freeze({ enabled: false });
  if (headed) {
    throw new Error('SMOKE_WEBMEET_HEADLESS forbids headed Playwright execution.');
  }
  if (screen) {
    throw new Error('SMOKE_WEBMEET_HEADLESS excludes the opt-in screen-sharing gate.');
  }
  if (!media) {
    throw new Error('SMOKE_WEBMEET_HEADLESS requires SMOKE_WEBMEET_MEDIA=1.');
  }
  return Object.freeze({
    enabled: true,
    headed: false,
    media: true,
    screen: false,
  });
}
