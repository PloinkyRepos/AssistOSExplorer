export const DATASTORE_TYPES = {
    SESSIONS: 'sessions',
    PROFILES_INFO: 'profilesInfo',
    LEADS: 'leads',
    INFO: 'info',
    CONFIG: 'config',
};

export const SESSION_SECTIONS = {
    PROFILE: 'Profile',
    PROFILE_DETAILS: 'Profile Details',
    HISTORY: 'History',
};

export const SESSION_SECTION_INDEX = {
    PROFILE: 1,
    PROFILE_DETAILS: 2,
    HISTORY: 3,
};

export const SESSION_FILE_SUFFIX = {
    PROFILE: 'profile',
    HISTORY: 'history',
};

export function getSessionProfileFileName(sessionId) {
    return `${sessionId}-${SESSION_FILE_SUFFIX.PROFILE}`;
}

export function getSessionHistoryFileName(sessionId) {
    return `${sessionId}-${SESSION_FILE_SUFFIX.HISTORY}`;
}

export const LEAD_SECTIONS = {
    LEAD_INFO: 'Lead Info',
    CONTACT_INFO: 'Contact Info',
    SUMMARY: 'Summary',
};

export const LEAD_FIELDS = {
    STATUS: 'Status',
    PROFILE: 'Profile',
    SESSION_ID: 'Session ID',
    CREATED_AT: 'Created At',
    UPDATED_AT: 'Updated At',
};

export const PROFILE_SECTIONS = {
    CHARACTERISTICS: 'Characteristics',
    INTERESTS: 'Interests',
    QUALIFYING_CRITERIA: 'Qualifying criteria',
};
