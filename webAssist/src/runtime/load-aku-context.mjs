import { AgenticKnowledgeUnits } from 'achillesAgentLib';
import { resolveSiteAkuDir } from './akuStore.mjs';

const SESSION_KU_PREFIX = 'ku_sess_';
const LEAD_KU_PREFIX = 'ku_lead_';
const MAX_HISTORY_EVENTS = 20;

function getSessionKuId(sessionId) {
    return `${SESSION_KU_PREFIX}${sessionId}`;
}

function getLeadKuId(sessionId) {
    return `${LEAD_KU_PREFIX}${sessionId}`;
}

/**
 * Build a manual context pack from search results, including full state for KUs.
 * This avoids the redundancy filtering in buildScopedContextPack that treats
 * KUs and their events as redundant.
 */
async function buildManualContextPack(aku, searchResults, options = {}) {
    const { budgetChars = 6000, includeState = true, maxStateChars = 1500 } = options;
    
    // Deduplicate by ku_id, preferring KUs over events
    const kuMap = new Map();
    for (const result of searchResults) {
        const existing = kuMap.get(result.ku_id);
        if (!existing || (result.record_type === 'ku' && existing.record_type !== 'ku')) {
            kuMap.set(result.ku_id, result);
        }
    }
    
    const results = [];
    let usedChars = 0;
    
    for (const result of kuMap.values()) {
        // Load full KU details including state if requested
        let state = null;
        if (includeState && result.record_type === 'ku') {
            try {
                const ku = await aku.loadKU(result.ku_id);
                state = ku.state || null;
                // Truncate state to maxStateChars to fit more KUs in context
                if (state && state.length > maxStateChars) {
                    state = state.slice(0, maxStateChars) + '...';
                }
            } catch {
                // KU not found, skip state
            }
        }
        
        const item = {
            search_id: result.search_id,
            ku_id: result.ku_id,
            record_type: result.record_type,
            title: result.title || '',
            summary: result.summary || '',
            status: result.status,
            tags: result.tags || [],
            keywords: result.keywords || [],
            path: result.path || '',
            score: result.score,
            matched_on: result.matched_on || [],
            state: state,
        };
        
        // Estimate chars for this item
        const itemChars = JSON.stringify(item).length;
        if (usedChars + itemChars > budgetChars) {
            break;  // Budget exceeded
        }
        
        results.push(item);
        usedChars += itemChars;
    }
    
    return {
        context_pack_id: `manual_${Date.now()}`,
        query: '',
        algorithm: 'manual_search_with_state',
        budget_chars: budgetChars,
        used_chars: usedChars,
        generated_at: new Date().toISOString(),
        results,
        omitted: {
            count: searchResults.length - results.length,
            reason: 'budget limit or deduplication',
        },
    };
}

function formatConversationHistory(events, maxEntries = 10) {
    if (!Array.isArray(events) || events.length === 0) {
        return 'No previous conversation history found.';
    }

    const turnEvents = events
        .filter(e => e.event_type === 'turn' && e.metadata?.speaker && e.metadata?.message)
        .slice(-maxEntries * 2);

    if (turnEvents.length === 0) {
        return 'No previous conversation history found.';
    }

    return turnEvents
        .map(e => `- **${e.metadata.speaker}**: ${e.metadata.message}`)
        .join('\n');
}

function formatSessionProfile(state, metadata = {}) {
    if (!state || !state.trim()) {
        return {
            isNewSession: true,
            profileDetails: [],
            contactInformation: {},
            sessionProfileText: 'No previous session record found. This is a new session.',
        };
    }

    const profileDetails = metadata.profileDetails || [];
    const contactInformation = metadata.contactInformation || {};

    return {
        isNewSession: false,
        profileDetails,
        contactInformation,
        sessionProfileText: state,
    };
}

export async function loadAkuContext({
    agentRoot,
    dataDir,
    siteId,
    sessionId,
    message,
    contextBudgetChars = 6000,
}) {
    if (!siteId) {
        throw new Error('loadAkuContext requires a siteId.');
    }
    if (!sessionId) {
        throw new Error('loadAkuContext requires a sessionId.');
    }

    const akuRootDir = resolveSiteAkuDir(agentRoot, siteId, dataDir);
    const aku = new AgenticKnowledgeUnits({
        rootDir: akuRootDir,
        actor: `webassist/${siteId}`,
        contextBudgetChars,
    });

    const akuExists = await aku.exists();
    if (!akuExists) {
        return {
            siteId,
            sessionId,
            akuContext: null,
            sessionProfile: {
                isNewSession: true,
                profileDetails: [],
                contactInformation: {},
                sessionProfileText: 'No previous session record found.',
            },
            conversationHistoryText: 'No previous conversation history found.',
            currentLead: { exists: false },
            akuContextText: 'No site context available.',
        };
    }

    await aku.loadAKU();

    const sessionKuId = getSessionKuId(sessionId);
    const leadKuId = getLeadKuId(sessionId);
    const query = message || '';
    
    // Use direct search instead of buildScopedContextPack to avoid redundancy filtering
    // that treats KUs and their events as redundant
    const searchResult = await aku.search(query, {
        explain: true,
        limit: 20,
        maxResultsPerKU: 0,  // No limit per KU
    });
    
    // Manually build context pack with KUs and their state
    const akuContext = await buildManualContextPack(aku, searchResult.results, {
        budgetChars: contextBudgetChars,
        includeState: true,
    });

    let sessionProfile;
    let conversationHistoryText;
    let sessionKU = null;

    try {
        sessionKU = await aku.loadKU(sessionKuId);
        const profileMetadata = sessionKU.manifest?.metadata || {};
        sessionProfile = formatSessionProfile(sessionKU.state, profileMetadata);

        const allEvents = sessionKU.events || [];
        conversationHistoryText = formatConversationHistory(allEvents, 10);
    } catch (error) {
        if (error?.code === 'AKU_NOT_FOUND' || error?.message?.includes('not found')) {
            sessionProfile = {
                isNewSession: true,
                profileDetails: [],
                contactInformation: {},
                sessionProfileText: 'No previous session record found. This is a new session.',
            };
            conversationHistoryText = 'No previous conversation history found.';
        } else {
            throw error;
        }
    }

    let currentLead = { exists: false };

    try {
        const leadKU = await aku.loadKU(leadKuId);
        currentLead = {
            exists: true,
            kuId: leadKuId,
            profile: leadKU.manifest?.metadata?.profile || '',
            sessionId,
            contactInfo: leadKU.manifest?.metadata?.contactInfo || {},
            state: leadKU.state || '',
        };
    } catch {
        currentLead = { exists: false };
    }

    const akuContextText = formatAkuContextForPrompt(akuContext);

    return {
        siteId,
        sessionId,
        akuContext,
        sessionProfile: {
            siteId,
            sessionId,
            ...sessionProfile,
        },
        conversationHistoryText,
        currentLead,
        akuContextText,
    };
}

function formatAkuContextForPrompt(contextPack) {
    if (!contextPack || !contextPack.results || contextPack.results.length === 0) {
        return 'No relevant site context found.';
    }

    const lines = [];
    const kuResults = contextPack.results.filter(r => r.record_type === 'ku');

    for (const result of kuResults) {
        const kuType = result.ku_type || result.type || 'unknown';
        const kuName = result.title || result.ku_name || result.ku_id;
        const summary = result.summary || '';
        // Use full state if available, otherwise fall back to summary
        const content = result.state || summary;

        lines.push(`[KU:${kuType}] ${kuName} — score: ${result.score?.toFixed(2) || 'N/A'}`);
        if (summary && !result.state) {
            lines.push(`  Summary: ${summary}`);
        }
        if (content) {
            lines.push(`  Content: ${content}`);
        }
        lines.push('');
    }

    return lines.join('\n').trim() || 'No relevant site context found.';
}

export async function getAkuInstance({ agentRoot, dataDir, siteId }) {
    const akuRootDir = resolveSiteAkuDir(agentRoot, siteId, dataDir);
    const aku = new AgenticKnowledgeUnits({
        rootDir: akuRootDir,
        actor: `webassist/${siteId}`,
    });

    const akuExists = await aku.exists();
    if (!akuExists) {
        throw new Error(`AKU not initialized for site: ${siteId}`);
    }

    await aku.loadAKU();
    return aku;
}

export { getSessionKuId, getLeadKuId, formatConversationHistory };
