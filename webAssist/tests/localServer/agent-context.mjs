const PROFILE_FILES = [
    'ai-researcher.md',
    'designer.md',
    'node-developer.md',
    'tester.md',
];

const SITE_INFO_FILES = [
    'chapter_01_vision.md',
    'chapter_02_achilles_ide_as_assistos_explorer.md',
    'chapter_03_installation_and_architecture.md',
    'chapter_04_observability.md',
    'chapter_05_ploinky_environment.md',
];

async function loadProfileFiles(httpFetch) {
    const results = [];
    for (const file of PROFILE_FILES) {
        const response = await httpFetch(`/profiles/${file}`);
        if (response.ok) {
            const content = await response.text();
            const title = file.replace(/\.md$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            results.push({ type: 'profile', title, content });
        }
    }
    return results;
}

async function loadSiteInfoFiles(httpFetch) {
    const results = [];
    for (const file of SITE_INFO_FILES) {
        const response = await httpFetch(`/assistos-info/${file}`);
        if (response.ok) {
            const content = await response.text();
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title = titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            results.push({ type: 'site', title, content });
        }
    }
    return results;
}

module.exports = {
    async describeSite() {
        return {
            name: 'AssistOS',
            description: 'AI-assisted websites and research initiative by Axiologic Research.',
            url: 'http://localhost:3000',
            types: ['site', 'profile', 'config'],
        };
    },

    async configureInteraction() {
        return {
            welcomeMessage: 'Welcome to AssistOS. We collect minimal session data to improve your experience.',
            contactRules: 'Email contact is available after lead creation. Meeting scheduling is available for qualified leads.',
            leadPolicy: {
                statuses: ['new', 'qualified', 'contacted', 'converted', 'archived'],
                retention: 'Active sessions retained for 90 days. Leads retained indefinitely unless archived.',
                disclosure: 'Owner contact routes may be disclosed only after lead creation. No personal data shared with third parties.',
            },
        };
    },

    async loadContext({ registerDocument, httpFetch }) {
        const siteInfo = await loadSiteInfoFiles(httpFetch);
        for (const doc of siteInfo) {
            registerDocument(doc);
        }

        const profiles = await loadProfileFiles(httpFetch);
        for (const profile of profiles) {
            registerDocument(profile);
        }

        registerDocument({
            type: 'contact',
            title: 'Contact',
            content: `Name: Mircea
Email: contact@assistos.io

Routes:
- Email contact is available after lead creation.
- Meeting scheduling is available for qualified leads.`,
        });

        registerDocument({
            type: 'interaction-policy',
            title: 'Visitor Policy',
            content: `Visitor Notice: Welcome to AssistOS. We collect minimal session data to improve your experience.

Retention: Active sessions are retained for 90 days. Leads are retained indefinitely unless archived.

Lead Statuses:
- new: Initial visitor contact
- qualified: Profile matched, contact information collected
- contacted: Owner has reached out
- converted: Lead resulted in engagement
- archived: No longer active

Disclosure Policy:
- Owner contact routes may be disclosed only after lead creation.
- No personal data is shared with third parties.`,
        });
    },
};
