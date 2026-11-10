# Huajuan (花卷)

English | [简体中文](README_ZH.md)

Huajuan is an AI agent workspace for tasks that take more than one step. Describe what you need, and it can plan the work, gather information, and create documents, spreadsheets, or media files.

## Workbench

- Huajuan stores conversations and project data in MongoDB and keeps files on a private mounted volume.
- For tasks with a plan, you can follow progress and review tool results and output files.
- The workbench can search the web, read pages, work with files and spreadsheets, control a browser, and use tools from MCP connections.
- Huajuan can delegate independent research to a read-only assistant and check its sources before using the findings.
- For longer tasks, the assistant can save progress and summarize the context. You can stop a running task.
- The interface has light and dark themes, a mobile layout, and keyboard controls.

## Administration

Sign in with a registered account listed in `ADMIN_EMAILS`, then open Settings and select Admin (`/settings?section=admin`).

### Model services

Choose Chat (Chat Completions), Message (Anthropic Messages), or Response (Responses) to match your provider. Enter the HTTPS API URL and key, load the model list, and save the model you want to use.

Set the model's supported input types, context window, maximum output tokens, and usage rates. Changes apply to new tasks. Running tasks keep their model connection and rates.

### Global skills

The Global skills panel uses Skills CLI to install skills from public GitHub repositories and to update or remove installed skills. Enabled skills are available to all users. Huajuan reads the relevant instructions and attachments as needed.

MongoDB stores skill contents and attachments. Skills CLI works under `STORAGE_ROOT/skills`.

### Images and audio

Open Images and audio in Admin (`/settings?section=admin&adminSection=media`) to configure service URLs, API keys, and shared settings. Use the Image generation and Text to speech tabs to manage image settings and voices.

Once the services are set up, users can ask Huajuan to generate images or speech. The app keeps each user's generated files and usage costs separate.

The server encrypts model and media API keys with `APP_SECRETS_KEY`. Admin shows whether each key has been saved.

## Deploy on Railway

Huajuan uses Node.js 26, Next.js 16, React 19, and MongoDB. Deploy with the included `railpack.json` and mount a persistent volume. The Railpack configuration includes Git for Skills CLI.

| Environment variable | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection URI |
| `APP_SECRETS_KEY` | Base64-encoded random 32-byte key for encrypting service credentials |
| `ADMIN_EMAILS` | Comma-separated admin email addresses. Register each account before adding it. |
| `STORAGE_ROOT` | Mount path of the Railway volume used for file storage |
| `PUBLIC_APP_URL` | Public HTTPS URL for passkey registration and sign-in |
| `NEXT_PUBLIC_APP_URL` | Public site URL for MCP OAuth callbacks |

## Run locally

In `.env.local`, point `MONGO_URI` at a development database and set `STORAGE_ROOT` to a writable directory. Set `APP_SECRETS_KEY` using the format above.

```sh
npm ci
npm run dev
```

Build with `npm run build` and start the production server with `npm start`.

## Tests

Run `npm run lint` to check the code and `npm test` to run the server-side tests.

For UI tests, install Chromium with `npx playwright install chromium --only-shell`. Start the app on port 3100 with an isolated test database using `node tests/helpers/dev-server.mjs`. In a second terminal, run `npm run test:ui`.

## Architecture references

- [OpenCode Agent](https://opencode.ai/docs/agents/)
- [Skills CLI](https://github.com/vercel-labs/skills)
