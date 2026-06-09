import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(__dirname, 'profiles');
const SITE_INFO_DIR = join(__dirname, 'assistos-info');

function loadProfileFiles() {
    const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.md'));
    return files.map((file) => {
        const title = file.replace(/\.md$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const content = readFileSync(join(PROFILES_DIR, file), 'utf8');
        return { type: 'profile', title, content };
    });
}

function loadSiteInfoFiles() {
    const files = readdirSync(SITE_INFO_DIR).filter((f) => f.endsWith('.md'));
    return files.map((file) => {
        const content = readFileSync(join(SITE_INFO_DIR, file), 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return { type: 'site', title, content };
    });
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

    async loadContext({ registerDocument }) {
        const siteInfo = loadSiteInfoFiles();
        for (const doc of siteInfo) {
            registerDocument(doc);
        }

        const profiles = loadProfileFiles();
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
