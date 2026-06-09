const WAC_TO_DATASTORE_MAP = {
    site: { type: 'info', fileName: 'about' },
    service: { type: 'info', fileName: 'services' },
    offer: { type: 'info', fileName: 'offers' },
    faq: { type: 'info', fileName: 'faq' },
    goal: { type: 'info', fileName: 'goals' },
    project: { type: 'info', fileName: 'projects' },
    notice: { type: 'info', fileName: 'notices' },
    page: { type: 'info', fileName: 'pages' },
    profile: { type: 'profiles', fileName: 'catalog' },
    contact: { type: 'config', fileName: 'owner' },
    'interaction-policy': { type: 'config', fileName: 'policy' },
};

function normalizeDocContent(doc) {
    const lines = [];
    if (doc.title) {
        lines.push(`# ${doc.title}`);
        lines.push('');
    }
    if (doc.status) {
        lines.push(`- **Status**: ${doc.status}`);
    }
    if (doc.validUntil) {
        lines.push(`- **Valid Until**: ${doc.validUntil}`);
    }
    if (doc.updatedAt) {
        lines.push(`- **Updated**: ${doc.updatedAt}`);
    }
    if (doc.source) {
        lines.push(`- **Source**: ${doc.source}`);
    }
    if (lines.length > 1) {
        lines.push('');
    }
    lines.push(doc.content);
    return lines.join('\n');
}

function groupDocumentsByTarget(documents) {
    const groups = {};
    for (const doc of documents) {
        const mapping = WAC_TO_DATASTORE_MAP[doc.type];
        if (!mapping) {
            continue;
        }
        const key = `${mapping.type}/${mapping.fileName}`;
        if (!groups[key]) {
            groups[key] = {
                type: mapping.type,
                fileName: mapping.fileName,
                sections: {},
            };
        }
        const sectionName = doc.title || `${doc.type} ${Object.keys(groups[key].sections).length + 1}`;
        groups[key].sections[sectionName] = normalizeDocContent(doc);
    }
    return groups;
}

export async function saveWacDocuments({ store, documents }) {
    if (!store) {
        throw new Error('saveWacDocuments requires a data store.');
    }
    if (!Array.isArray(documents) || documents.length === 0) {
        return { saved: 0, files: [] };
    }

    const groups = groupDocumentsByTarget(documents);
    const savedFiles = [];

    for (const [key, group] of Object.entries(groups)) {
        const existingSections = {};
        try {
            const existing = await store.getFile(group.type, group.fileName);
            for (const section of (existing.sections || [])) {
                existingSections[section.name] = section.content;
            }
        } catch {
        }

        const mergedSections = { ...existingSections, ...group.sections };
        const result = await store.replaceFile(group.type, group.fileName, mergedSections);
        savedFiles.push({
            type: result.type,
            fileName: result.fileName,
            sections: result.sections.length,
        });
    }

    return {
        saved: documents.length,
        files: savedFiles,
    };
}
