# Privacy

Plainstamp is built so that the server cannot keep your questions.

- The Worker holds no state. It does not log request bodies, answers or IP addresses, and there is no analytics on text.
- The Helpful / Not helpful buttons send one word, "up" or "down", to the Worker, which adds one row to a Cloudflare Analytics Engine counter. The row has no question, answer, IP address or identifier, only the time it was added, and the Worker rejects any other content. Your choice is also kept in your browser so the buttons stay greyed out.
- Your chat history and selected states stay in your browser (localStorage). The clear button deletes them.
- The database holds public official documents only. There are no user tables.
- Your question (and your short chat history, your selected states and the optional situation text) is sent to Google's Gemini API to write the answer, so Google sees it. Plainstamp uses Google's **free tier**. Under Google's terms for that tier, Google may use prompts and answers to improve its products, and human reviewers may read them after the data is detached from the account, key and project. Google's terms tell users not to submit sensitive, confidential or personal information to the free tier. We cannot change that without a paid plan. Retention is not stated in those terms for the free tier (checked 2026-10-19 at ai.google.dev/gemini-api/terms).
- The service is for adults: Google's terms for the API require users to be 18 or older.
- To limit abuse the Worker counts requests per client without keeping anything: the rate limiter key is a salted hash of the visitor's network prefix (IPv4 /24 or IPv6 /64) that changes every day. The address itself is not stored or logged by the Worker, and the hash is not written anywhere by our code.
- If a Cloudflare Turnstile bot check is enabled, your browser loads a script from challenges.cloudflare.com, so Cloudflare sees your IP address and browser details for that check, as it does for any page it serves. We only receive a pass or fail result. Cloudflare's own retention is covered by its privacy terms.
- Please don't type personal data such as names, addresses or ID numbers into the chat.

Platform-level logs kept by the hosting provider, if any, are outside the project's control; the Worker code does not write request data to them.
