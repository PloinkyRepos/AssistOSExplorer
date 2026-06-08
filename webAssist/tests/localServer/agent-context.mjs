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
        registerDocument({
            type: 'site',
            title: 'About AssistOS',
            content: `AssistOS is a research initiative launched in 2022 by Axiologic Research, driven by a singular ambition: to pioneer technologies that transform artificial intelligence into a true human assistant. Our work spans both open-source contributions and commercial applications, all unified by the belief that we are at the dawn of a fundamental shift in how humans interact with computers.

In October 2024, AssistOS received a significant boost through EU funding as part of the Achilles Project consortium. This partnership focuses on advancing research results from low Technology Readiness Levels toward production-ready products and technologies by 2027.`,
        });

        registerDocument({
            type: 'site',
            title: 'Vision',
            content: `Human-AI Collaboration: Our foundational research hypothesis is that user experience and human-computer interaction are about to change radically. While conversational interfaces have proven remarkably powerful, we recognize that the future isn't purely chat-based. The most effective AI assistants will seamlessly blend natural language with legacy interaction paradigms.

AI Democratizes Dev Tools: AI assistance will unlock the power of computing for domains that have historically been reserved for programmers. With AI as an intermediary, the rigor and benefits of tools like version control become accessible to everyone.

Tell AI What, Not How: The focus will shift from meticulous manual labor on details to the art of crafting specifications and orchestrating AI pipelines that produce the desired artifacts.`,
        });

        registerDocument({
            type: 'profile',
            title: 'Developer',
            content: `Software developers and engineers interested in AI-powered development tools, IDE integration, and version control systems.

Keywords: developer, software engineer, IDE, version control, AI tools, open-source, production-ready, DevOps, API integration.

Engagement Path: Early access to AI development tools, open-source contribution opportunities, IDE plugin development, integration with existing workflows.`,
        });

        registerDocument({
            type: 'profile',
            title: 'Designer',
            content: `UX/UI designers and design system creators interested in AI-assisted design workflows, component libraries, and design-to-code pipelines.

Keywords: designer, UX, UI, design systems, AI design tools, component libraries, design tokens.

Engagement Path: AI-assisted design tool exploration, design system automation, design-to-code workflow integration.`,
        });

        registerDocument({
            type: 'profile',
            title: 'Researcher',
            content: `Academic and industry researchers interested in AI methodology, human-computer interaction, and research tooling automation.

Keywords: researcher, academic, HCI, AI methodology, research automation, knowledge management.

Engagement Path: Research collaboration opportunities, AI methodology testing, knowledge management tool development.`,
        });

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
