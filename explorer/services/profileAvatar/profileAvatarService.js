export {
    getFallbackLetter,
    normalizeAvatarConfig,
    renderAxiFaceMarkup
} from './avatarConfig.js';

export {
    ensureAxiFaceLoaded,
    getCurrentProfileAvatar,
    invalidateProfileAvatarCache,
    loadAxiFaceGeneratedFacePalettes,
    loadAxiFaceGeneratedFaceStyles,
    loadAxiFacePacks,
    saveCurrentProfileAvatar
} from './avatarApi.js';

export {
    createParticipantProfileAvatarController
} from './participantAvatarController.js';
