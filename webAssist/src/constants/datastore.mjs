export const DATASTORE_TYPES = {
    SESSIONS: 'sessions',
    PROFILES: 'profiles',
    LEADS: 'leads',
    VISITS: 'visits',
    INFO: 'info',
    CONFIG: 'config',
};

export const SESSION_SECTIONS = {
    TARGET_PROFILES: 'Target Profiles',
    PROFILE_DETAILS: 'Profile Details',
    CONTACT_INFORMATION: 'Contact Information',
    CONSENT: 'Consent',
    HISTORY: 'History',
};

export const SESSION_SECTION_INDEX = {
    TARGET_PROFILES: 1,
    PROFILE_DETAILS: 2,
    CONTACT_INFORMATION: 3,
    CONSENT: 4,
    HISTORY: 5,
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
    CONSENT: 'Consent',
    CONTACT_ROUTE: 'Contact Route',
    SUMMARY: 'Summary',
};

export const LEAD_FIELDS = {
    STATUS: 'Status',
    PROFILE: 'Profile',
    SESSION_ID: 'Session ID',
    CONSENT_GRANTED: 'Consent Granted',
    CREATED_AT: 'Created At',
    UPDATED_AT: 'Updated At',
};

export const VISIT_SECTIONS = {
    VISIT_INFO: 'Visit Info',
};
