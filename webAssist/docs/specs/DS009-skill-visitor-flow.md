# DS009 - System Prompt: visitor-flow

## Goal
Coordinate one complete visitor turn through Achilles `MainAgent` with a static system prompt so `webAssist` runtime does not hardcode skill calls in application code.

## Mechanism
The `visitor-flow` behavior is defined in `webAssist/src/prompts/visitor-flow-system-prompt.mjs` and passed into `MainAgent.executePrompt(..., { systemPrompt })`.

## Allowed Skills
- `create-lead`
- `book-meeting`
- `update-session-profile`

## Input Contract
The runtime prompt includes explicit sections with:
- User message
- Session profile object
- Current lead object
- Session profile markdown snapshot
- Combined profiles catalog text
- Combined site info text

## Orchestration Contract
1. Read context from runtime-provided input sections.
   - Use `currentLead` as source of truth for existing lead data tied to `sessionId`.
2. Build an internal decision object (response draft, profiles, profileDetails, contactInformation).
3. Ensure decision constraints:
   - use only profiles defined in `combinedProfilesInfo` as qualification candidates;
   - evaluate profile matching through multi-turn questioning;
   - profile filenames in `profiles`;
   - `profileDetails` and lead summary in English;
   - `contactInformation` is structured key-value data with explicit user-provided fields (no fixed schema);
   - visitor full name is requested during qualification; when missing, this is explicitly noted in `profileDetails`;
   - at least one direct contact channel should be collected when available (for example email, phone, social profile, or equivalent);
   - `profileDetails` captures conversation essence relevant to profiling and progression, not transcript copy;
   - `profileDetails` must include what the agent asked, what the user answered, pending questions, and profile-relevant discussed aspects;
   - if no profile matches after multiple attempts, switch to dismissive mode (website-only answers, no profiling questions) until new profile-relevant evidence appears;
   - when info is missing, answer current question and ask exactly one strategic follow-up question.
4. Call `update-session-profile` with `{ sessionId, profiles, profileDetails, contactInformation }` before final answer.
5. Build final visitor response in visitor language.
6. Return plain-text final answer through `final_answer`.

## Runtime Continuity Rule
`webAssist` runtime does not synthesize flow markers. Conversational continuity is authored directly by orchestrator through `profileDetails`. History files are appended by runtime after final answer for audit and admin consumers.

## Output Contract
The orchestrator must end with a plain-text visitor response string.
Persistence payload fields are passed to `update-session-profile` tool before the final answer.
