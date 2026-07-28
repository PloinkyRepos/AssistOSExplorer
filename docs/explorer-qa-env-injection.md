# Explorer QA Box Inputs

QA uses the same hard-cut runtime contract as local and production boxes. The
old remote deployment workflows were removed because they configured edge state
through an agent-owned publication path.

Before activating a QA box, an operator must:

1. revoke obsolete connector/API credentials and remove obsolete plaintext
   publication state;
2. configure a dedicated existing Cloudflare tunnel connector token plus a
   separate least-privilege API token, or explicitly choose local-only mode;
3. configure a literal public IPv4 for LiveKit media and dedicated external
   TURN endpoints/secret;
4. explicitly recreate the Box under the semantic Box contract; and
5. run the exact-publication and two-account browser release gates.

Ploinky writes topology before agent hooks start. QA workflows must never copy
browser URLs, private target addresses, relay credentials, or product-specific
publication settings into agent environments. Invalid or incomplete public
mode remains failed; it does not switch to local-only mode.
