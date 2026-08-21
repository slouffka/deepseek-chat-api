## DeepSeek Proxy TODO

- [ ] Implement zsh/rg fallbacks to common utils.
- [x] Implement port loading from .env
- [x] Fix non-editable proxy url input
- [x] Fix chat messages and streaming.
- [x] Fix thinking toggle.
- [x] Extract styles and js and split into multiple modules. The index.html is
too big already.
- [x] Convert send message button into icon button and put it inside chat input (textarea).
- [x] Implement beautiful and clean clear chat alert instead of default.
- [x] Use full chat container width for messages. Only let them stay short if
they actually short.
- [x] Fix chat message formatting broken after page reload.

- [ ] Implement automatic api key extraction via web login (really hard to
  implement without using real browser (CDP). cannot bypass bot detection in
  headless mode).

- [x] Implement chat session management.
- [ ] Enable autoscrolling with user override by scroll and scollbar.
- [x] Enable custom scrollbar.
- [ ] Restore debug info output.
- [x] Implement tool calling using chat api.
- [x] Implement system prompt support.
- [ ] Implement multiple chat roles.
- [ ] Try to push this chat api to the limits.
- [ ] Try to understand what's possible.
- [ ] Try to implement mcp server support.
- [ ] Try to implement multi-agentic workflow.
- [ ] Remove default api url from config cause it's useless without cors proxy.

