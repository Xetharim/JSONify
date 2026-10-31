# JSONify

JSONify is a local-first workspace for formatting, validating, repairing, comparing, querying, and converting JSON and related data. It runs in your browser, and its bundled parsers and validators work offline. API tools send network requests only when you explicitly start one.

## Start here

### Run from a downloaded or cloned project

Requirements: Node.js 20 or newer and pnpm 11.25.0. From the project folder, run:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Then open <http://127.0.0.1:4173>. The start command builds the local browser libraries and runs the optional Node service used by scheduled requests, endpoint monitors, and webhooks.

To get the project from GitHub first:

```sh
git clone <repository-url>
cd <repository-folder>
pnpm install --frozen-lockfile
pnpm start
```

If pnpm is not installed, install Node.js and enable Corepack, then activate the version used by this project:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
```

You can also open `index.html` directly. Browser-based tools and the bundled standards libraries work that way too, but local background services need `pnpm start`, and API requests may be limited by the browser's CORS rules.

## Use JSONify

1. Paste data into **Input**, drag a file onto the editor, or select **Open a file**.
2. Choose a section: **Format**, **Convert**, **Validate**, **Inspect**, **Repair**, or **Data tools**.
3. Choose an action and its options. The selected action is highlighted; use **Find a tool** or `Ctrl`/`⌘` + `K` if you’re not sure where a tool lives.
4. Review **Output**, then use **Copy** or **Download**. **Clear** resets the editors.

Try **Try a sample** for a ready-to-run example. `Ctrl`/`⌘` + `Enter` runs the selected action.

### Common tasks

| Task | Steps |
| --- | --- |
| Format or minify JSON | Choose **Format**, paste JSON, then select **Format** or **Minify**. Choose the indentation size for formatted output. |
| Fix common JSON mistakes | Choose **Repair**, paste the malformed text, and select **Repair JSON**. Review the repair report before using the result. |
| Validate JSON, CSV, or JSON Lines | Choose **Validate**, select the input format, paste data, and select **Validate**. |
| Convert CSV or JSON Lines to JSON | Choose **Convert**, paste or open the source, then select **CSV → JSON** or **JSONL → JSON**. For JSON to CSV, select **To CSV**. |
| Check data against a schema | Choose **Validate**, open **JSON Schema validation**, paste a schema or generate one from the input, then choose the draft and validate. External `$ref` schemas can be registered in **Offline reference schemas**; JSONify does not fetch them. |
| Compare two JSON documents | Choose **Inspect**, paste the second document, optionally list ignored keys or paths, then select **Compare documents**. |
| Query JSON | Choose **Inspect**, enter an RFC 9535 JSONPath expression (for example, `$.users[?@.active == true].name`), then select **Extract**. |
| Convert YAML or XML | Choose **Data tools**, select **YAML to JSON**, **JSON to YAML**, **XML to JSON**, or **JSON to XML**, then run the tool. Set a root element name for JSON to XML if needed. |
| Inspect an API response | Choose **Convert**, enter the endpoint, and select **Send request**. Open **Request settings** for method, headers, query parameters, authentication, body, saved requests, and assertions. |

### Tool sections

- **Format**: format, minify, sort keys, and load a sample.
- **Convert**: CSV, JSON Lines, TypeScript, API inspector, and local API services.
- **Validate**: JSON/CSV/JSON Lines syntax, JSON Schema drafts 7/2019-09/2020-12, schema designer, and mock data generation.
- **Inspect**: JSONPath queries, tree view, document comparison, search, and data quality checks.
- **Repair**: repair common JSON syntax mistakes and inspect the repair report.
- **Data tools**: use the grouped selector for data browsing, analysis, transformation, format conversion, and developer utilities. The help text below the selector explains the chosen tool and its options.

## Privacy and data

JSON documents are processed locally in your browser. API requests go to the endpoint you specify only after you select **Send request**. If the optional local Node service is running, it proxies those requests from `127.0.0.1` to avoid some browser CORS restrictions. Use endpoints you trust.

API collections, environments, presets, and recent request history are stored in browser storage. Secrets are not included in saved request definitions. The local Node service stores schedules, monitor results, and webhook payloads in `.jsonify-state.json`; this file is ignored by Git. Review exported workspaces and API history before sharing, since they can include private data.

YAML comments and source formatting do not have a JSON equivalent. Custom YAML tags and non-string map keys are represented with explicit `$yamlTag` and `$yamlMap` envelopes. XML conversion preserves ordered nodes and metadata in a JSON envelope, but conversion to ordinary JSON necessarily maps XML into a data structure.

## GitHub Pages

The core browser app can be hosted as a static site: publish the repository root so `index.html`, `css/`, `js/`, and `vendor/` are served together. The optional Node services (API proxy, scheduled requests, monitors, webhooks, and load checks) require the Node server and are not available on static-only hosting. The included GitHub Actions workflow runs tests and checks the generated browser bundle on pushes and pull requests.

## Development

```sh
pnpm test
pnpm run build:vendor
```

The tests use Node's built-in test runner. `vendor/jsonify-libs.js` is generated from the locked dependencies; rebuild it after changing dependencies and commit the updated bundle. Third-party license details are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
