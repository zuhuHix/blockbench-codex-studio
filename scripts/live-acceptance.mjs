import { writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = process.env.BLOCKBENCH_CODEX_TOKEN;
if (!token) throw new Error("BLOCKBENCH_CODEX_TOKEN is required.");
const action = process.argv[2] ?? "inspect";
const argument = process.argv[3];
const port = process.env.BLOCKBENCH_CODEX_PORT ?? "48172";
const client = new Client({
  name: "blockbench-live-acceptance",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(
  new URL(`http://127.0.0.1:${port}/mcp`),
  { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
);

function textResult(result) {
  const content = result.content?.find((item) => item.type === "text");
  if (!content || content.type !== "text")
    throw new Error("MCP tool returned no text result.");
  return JSON.parse(content.text);
}

async function call(name, args = {}) {
  return textResult(await client.callTool({ name, arguments: args }));
}

try {
  await client.connect(transport);
  if (action === "inspect") {
    console.log(
      JSON.stringify(
        {
          project: await call("get_project_summary"),
          selection: await call("get_selection"),
          connectivity: await call("inspect_connectivity"),
        },
        null,
        2,
      ),
    );
  } else if (action === "stage") {
    const staged = await call("connect_selected_chain", {
      label: "Connect specimen tentacles",
    });
    const validation = await call("validate_draft", {
      transactionId: staged.draft.transactionId,
    });
    console.log(JSON.stringify({ staged, validation }, null, 2));
  } else if (action === "commit") {
    if (!argument) throw new Error("commit requires a transaction ID.");
    console.log(
      JSON.stringify(
        await call("commit_draft", { transactionId: argument }),
        null,
        2,
      ),
    );
  } else if (action === "viewport") {
    const result = await client.callTool({
      name: "capture_viewport",
      arguments: {},
    });
    const image = result.content?.find((item) => item.type === "image");
    if (!image || image.type !== "image")
      throw new Error("No viewport image was returned.");
    const output = argument ?? "blockbench-live-viewport.png";
    await writeFile(output, Buffer.from(image.data, "base64"));
    console.log(output);
  } else {
    throw new Error(`Unknown action: ${action}`);
  }
} finally {
  await client.close();
}
