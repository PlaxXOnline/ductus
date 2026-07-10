---
'@ductus/core': minor
---

Neuer LLM-Provider `mistral`: spricht die Mistral-Chat-API
(api.mistral.ai, OpenAI-kompatibel) mit Bearer-Auth über die bestehende
BYOK-Schicht an — `llm.provider: mistral` plus explizites `model`
(z. B. `mistral-large-latest`) genügt; Key wie gehabt über `llm.apiKeyEnv`.
Gleiche Retry-, Kostenschätzungs- und NFR4-Garantien (Key erscheint nie in
Fehlermeldungen) wie bei den übrigen Providern.
