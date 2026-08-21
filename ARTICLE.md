# DeepSeek Chat API: Reverse Engineering и полноценный клиент с tools

## TL;DR

Полностью рабочий клиент для DeepSeek Chat API с поддержкой:
- Proof-of-Work (WASM) на стороне прокси
- SSE streaming с парсингом diff-формата
- Function calling через ReAct-паттерн
- Rate limiting с авто-retry на фронте
- Сохранение сессии в localStorage

Код: `cors-proxy.js` (Node.js) + `public/index.html` (vanilla JS)

---

## Архитектура DeepSeek Chat API

### Эндпоинты

```
POST /api/v0/chat_session/create      → создаёт сессию, возвращает sessionId
POST /api/v0/chat/create_pow_challenge → выдаёт challenge для PoW
POST /api/v0/chat/completion           → основной эндпоинт, требует x-ds-pow-response
```

### Proof-of-Work

DeepSeek защищает API PoW на SHA3 (Keccak-256). Challenge содержит:
```json
{
  "algorithm": "sha3_256",
  "challenge": "random_string",
  "salt": "random_salt",
  "difficulty": 18.5,
  "expire_at": 1234567890,
  "signature": "base64",
  "target_path": "/api/v0/chat/completion"
}
```

Решение: найти `nonce`, где `SHA3(salt + "_" + expire_at + "_" + challenge + nonce) < target`.

**Важно**: PoW одноразовый — нужен на **каждый** запрос к `/completion`.

### Формат стриминга

DeepSeek использует нестандартный SSE diff-формат:
```
data: {"v":"текст","p":"/path/to/field"}
data: {"v":"\n\n","p":"/path/to/field"}
data: [DONE]
```

Каждый чанк — операция patch к документу. На фронте/прокси собираем `v` в порядке прихода.

---

## Прокси (cors-proxy.js)

### Зачем нужен

1. **CORS** — DeepSeek не отдаёт нужные заголовки
2. **PoW** — WASM-солвер тяжелый для браузера, удобнее на сервере
3. **Tools** — цикл ReAct требует множественных запросов с новым PoW
4. **API Key** — не светится на фронте

### Основные компоненты

```javascript
// 1. WASM солвер (порт Python-референса)
async function initPowSolver() {
  const wasm = await WebAssembly.instantiate(bytes, importObject);
  return wasm.instance.exports;
}

function solvePow(challenge) {
  const prefix = `${salt}_${expire_at}_`;
  wasm.wasm_solve(retptr, challengePtr, challengeLen, prefixPtr, prefixLen, difficulty);
  // читаем answer из памяти
  return base64(JSON.stringify({algorithm, challenge, salt, answer, signature, target_path}));
}

// 2. Получение свежего PoW на каждый 턴
async function getPowHeader() {
  const challenge = await fetchChallenge();
  return solvePow(challenge);
}

// 3. ReAct loop с инструментами
async function handleChatCompletionWithTools(req, res) {
  let messages = req.body.messages;
  const maxTurns = 10;
  
  while (turn < maxTurns) {
    const pow = await getPowHeader();           // свежий PoW
    const prompt = buildPrompt(messages);       // system + history → string
    const response = await fetchDeepSeek({prompt, pow});
    const content = parseSSE(response);         // собираем diff-чанки
    const toolCall = extractToolCall(content);  // ```json {...}``` или bare JSON
    
    if (toolCall) {
      const result = await executeTool(toolCall);
      messages.push({role: "assistant", content});
      messages.push({role: "tool", content: JSON.stringify(result)});
      continue;  // следующий 턴 с результатом
    }
    
    streamToClient(response);  // финальный ответ
    return;
  }
}
```

### Инструменты (fs, shell)

```javascript
const TOOLS = [
  {name: "read_file",   params: {path: "string"}},
  {name: "write_file",  params: {path: "string", content: "string"}},
  {name: "edit_file",   params: {path: "string", oldString: "string", newString: "string"}},
  {name: "list_files",  params: {path: "string"}},
  {name: "run_shell",   params: {command: "string", cwd: "string", timeout: "number"}},
  {name: "grep",        params: {pattern: "string", path: "string", include: "string"}}
];
```

Выполняются синхронно в event loop Node.js. `run_shell` через `spawn("zsh", ["-c", cmd])`.

---

## Фронтенд (index.html)

### Vanilla JS, без фреймворков

- **Marked.js** + **Highlight.js** для markdown/code
- **localStorage** для истории сообщений и сессии
- **AbortController** для отмены стрима
- Кастомный скроллбар, тема dark/light, копирование код-блоков

### Поток данных

```
User input → sendChatCompletion()
  → POST /api/v0/chat/completion (messages[], prompt)
  ← SSE stream
  → parseStreamResponse() → собирает data.v
  → appendMessage('assistant', content)
  → saveMessages() → localStorage
```

### Rate limit handling

```javascript
while (attempt < maxRetries) {
  const response = await fetch(endpoint, payload);
  if (response.status === 429) {
    const wait = parseWaitTime(response);  // "Wait 4s"
    for (let i = wait; i > 0; i--) {
      showStatus(`Retrying in ${i}s...`);
      await sleep(1000);
    }
    payload.client_stream_id = generateId();  // новый stream_id
    continue;
  }
  // handle success
}
```

---

## Особенности реализации

| Проблема | Решение |
|----------|---------|
| PoW в браузере тормозит UI | WASM в Web Worker / на прокси |
| DeepSeek не отдаёт `messages` | Прокси собирает `prompt = system + history` |
| Стриминг + tool calls | Буферизируем полностью, стриммим только финал |
| Сессия теряется при reload | `sessionId` + `lastResponseId` в localStorage |
| CORS | Прокси на том же origin |

---

## Запуск

```bash
# .env
DEEPSEEK_API_KEY=sk-xxx

# Terminal 1
node cors-proxy.js

# Terminal 2 (опционально, для HTTPS)
ngrok http 3000
```

Открыть `http://localhost:3000`

---

## Файлы проекта

```
├── cors-proxy.js          # Express + PoW + Tools + ReAct loop
├── public/
│   ├── index.html         # Весь фронтенд (HTML+CSS+JS)
│   └── sha3_wasm_bg.7b9ca65ddd.wasm  # PoW WASM модуль
├── package.json
└── .env
```

---

## Что можно улучшить

1. **Нативный function calling** — миграция на OpenAI/Claude API или локальную модель с tools support
2. **Web Worker для PoW** — снять нагрузку с main thread
3. **WebSocket** вместо polling для длинных tool-цепочек
4. **Persist tools history** — показать пользователю что выполнялось
5. **Sandbox для shell** — Docker/VM вместо прямого zsh

---

## Полезные ссылки

- [DeepSeek API неофициальная дока](https://github.com/deepseek-ai/api-docs)
- [SHA3 WASM референс](https://github.com/ethereum/js-sha3)
- [ReAct paper](https://arxiv.org/abs/2210.03629)
- [SSE spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)