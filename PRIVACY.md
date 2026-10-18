# Privacy

Plainstamp is built so that the server cannot keep your questions.

- The Worker holds no state. It does not log request bodies, answers or IP addresses, and there is no analytics on text.
- Your chat history and selected states stay in your browser (localStorage). The clear button deletes them.
- The database holds public official documents only. There are no user tables.
- Your question is sent to the language model provider to produce the answer, so the provider sees it. Provider, tier and retention terms: to be filled in before launch.
- Please don't type personal data such as names, addresses or ID numbers into the chat.

Platform-level logs kept by the hosting provider, if any, are outside the project's control; the Worker code does not write request data to them.
