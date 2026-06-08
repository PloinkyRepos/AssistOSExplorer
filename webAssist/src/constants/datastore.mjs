export const DATASTORE_TYPES = {
    SESSIONS: 'sessions',
    PROFILES: 'profiles',
    LEADS: 'leads',
    VISITS: 'visits',
    INFO: 'info',
    CONFIG: 'config',
};

export const SESSION_SECTIONS = {
    PROFILE_DETAILS: 'Profile Details',
    CONTACT_INFORMATION: 'Contact Information',
    HISTORY: 'History',
};

export const SESSION_SECTION_INDEX = {
    PROFILE_DETAILS: 1,
    CONTACT_INFORMATION: 2,
    HISTORY: 3,
};

export const SESSION_FILE_SUFFIX = {
    PROFILE: 'profile',
    HISTORY: 'history',
};

export const LEAD_FILE_SUFFIX = 'lead';

export function getSessionProfileFileName(sessionId) {
    return `${sessionId}-${SESSION_FILE_SUFFIX.PROFILE}`;
}

export function getSessionHistoryFileName(sessionId) {
    return `${sessionId}-${SESSION_FILE_SUFFIX.HISTORY}`;
}

export function getSessionLeadFileName(sessionId) {
    return `${sessionId}-${LEAD_FILE_SUFFIX}`;
}

export const LEAD_SECTIONS = {
    LEAD_INFO: 'Lead Info',
    MATCH_EXPLANATION: 'Match Explanation',
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

export const VISIT_SECTIONS = {
    VISIT_INFO: 'Visit Info',
};
