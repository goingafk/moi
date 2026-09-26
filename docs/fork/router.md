# Auto routing

Auto mode classifies each message with Jev or Laya, then moi chooses a model in code from the configured eligibility table and current provider usage. The classifier judges only difficulty and task kind; it never chooses a provider or performs quota maths.

## Set it up

Open Settings → Routing:

1. Save a TypeSafe key for Jev, configure a Laya endpoint, or do both. The TypeSafe key is write-only in the browser and lives in moi's OS keychain or its owner-only file fallback.
2. Choose the primary classifier. The other configured classifier is the fallback.
3. Adjust the Claude reserve and eligibility table if needed.
4. Optionally turn on **Auto for new chats**. The global default remains Manual until changed.

You can also choose **Auto** directly in the composer model picker. Existing chats keep their saved mode.

## How a chat is routed

The first message in an Auto chat may choose Claude, Codex, or a configured tool-capable Ollama model. Later messages are classified again, but stay on the chat's bound agent; only the model can change. When another agent sits in a strictly better routing group, the route row offers **Continue in <agent>**, which opens a new manual chat with that model and the message prefilled.

Each routed turn shows one quiet row between the user message and assistant work. It includes the selected model and reason. **Use this model** changes that chat to Manual with the routed model.

If both classifiers fail or selection finds no eligible model, sending still continues: moi tries the last compatible routed model, the current chat model, then the workspace default. The route row marks the fallback.

## Read the decisions

Settings → Routing shows the latest 20 decisions. The full local JSONL file is `routing-decisions.jsonl` in moi's data directory. Each row contains a short message preview, classification, candidate scores and drop reasons, the chosen model, fallback/suggestion, and latency. It does not contain API keys or the full message.

The log is not rotated in this phase. Monitor its size on long-running installations.
