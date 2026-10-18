# Privacy

Plainstamp is built so that the server cannot keep your questions.

- The Worker holds no state. It does not log request bodies, answers or IP addresses, and there is no analytics on text.
- Your chat history and selected states stay in your browser (localStorage). The clear button deletes them.
- The database holds public official documents only. There are no user tables.
- Your question is sent to the language model provider to produce the answer, so the provider sees it. Provider, tier and retention terms: to be filled in before launch.
- To limit abuse the Worker counts requests per client without keeping anything: the rate limiter key is a salted hash of the visitor's network prefix (IPv4 /24 or IPv6 /64) that changes every day. The address itself is not stored or logged by the Worker, and the hash is not written anywhere by our code.
- If a Cloudflare Turnstile bot check is enabled, your browser loads a script from challenges.cloudflare.com, so Cloudflare sees your IP address and browser details for that check, as it does for any page it serves. We only receive a pass or fail result. Cloudflare's own retention is covered by its privacy terms.
- Please don't type personal data such as names, addresses or ID numbers into the chat.

Platform-level logs kept by the hosting provider, if any, are outside the project's control; the Worker code does not write request data to them.
