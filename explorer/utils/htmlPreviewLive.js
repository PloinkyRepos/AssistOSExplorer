import { HTML_PREVIEW_LIVE_UPDATE_EVENT } from "./appEvents.js";

export { HTML_PREVIEW_LIVE_UPDATE_EVENT };

export function normalizePreviewSourcePath(pathValue) {
    return String(pathValue || '').trim().replace(/\\/g, '/');
}
