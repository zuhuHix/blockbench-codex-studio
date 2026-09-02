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
  const result = await client.callTool({ name, arguments: args });
  if (result.isError)
    throw new Error(
      result.content?.find((item) => item.type === "text")?.text ??
        `${name} failed.`,
    );
  return textResult(result);
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(description, read, accept) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function saveViewport(output) {
  const result = await client.callTool({
    name: "capture_viewport",
    arguments: {},
  });
  const image = result.content?.find((item) => item.type === "image");
  if (!image || image.type !== "image")
    throw new Error("No viewport image was returned.");
  await writeFile(output, Buffer.from(image.data, "base64"));
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
  } else if (action === "uv-inspect") {
    const selection = await call("get_selection");
    const faceMappings = [];
    for (const element of selection.elements) {
      faceMappings.push(
        await call("get_cube_face_uvs", { elementId: element.id }),
      );
    }
    console.log(
      JSON.stringify(
        {
          project: await call("get_project_summary"),
          selection,
          faceMappings,
          coverage: await call("measure_uv_coverage"),
          seams: await call("audit_uv_seams"),
        },
        null,
        2,
      ),
    );
  } else if (action === "uv-stage") {
    const before = {
      coverage: await call("measure_uv_coverage"),
      seams: await call("audit_uv_seams"),
    };
    const staged = await call("project_connected_uv", {
      label: "Project continuous selected UVs",
    });
    const validation = await call("validate_draft", {
      transactionId: staged.draft.transactionId,
    });
    console.log(JSON.stringify({ before, staged, validation }, null, 2));
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
    const output = argument ?? "blockbench-live-viewport.png";
    await saveViewport(output);
    console.log(output);
  } else if (action === "phase4") {
    const elementIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const outputPrefix = argument ?? "phase4-live";
    await call("set_selection", { elementIds });
    await waitFor(
      "the Phase 4 fixture selection",
      () => call("get_selection"),
      (selection) =>
        JSON.stringify(selection.ids) === JSON.stringify(elementIds),
    );
    const beforeFaces = await Promise.all(
      elementIds.map((elementId) => call("get_cube_face_uvs", { elementId })),
    );
    const before = {
      coverage: await call("measure_uv_coverage"),
      seams: await call("audit_uv_seams"),
    };
    await saveViewport(`${outputPrefix}-before.png`);

    const staged = await call("project_connected_uv", {
      label: "Phase 4 continuous UV acceptance",
    });
    const validation = await call("validate_draft", {
      transactionId: staged.draft.transactionId,
    });
    if (!validation.valid) throw new Error(JSON.stringify(validation));
    await call("commit_draft", {
      transactionId: staged.draft.transactionId,
    });
    const after = await waitFor(
      "the projected UV commit",
      async () => ({
        coverage: await call("measure_uv_coverage"),
        seams: await call("audit_uv_seams"),
      }),
      (result) => result.seams.continuous,
    );
    await saveViewport(`${outputPrefix}-after.png`);

    await call("undo");
    const restoredFaces = await waitFor(
      "the one-step UV undo",
      () =>
        Promise.all(
          elementIds.map((elementId) =>
            call("get_cube_face_uvs", { elementId }),
          ),
        ),
      (faces) => JSON.stringify(faces) === JSON.stringify(beforeFaces),
    );
    const restored = {
      coverage: await call("measure_uv_coverage"),
      seams: await call("audit_uv_seams"),
    };
    await saveViewport(`${outputPrefix}-restored.png`);
    console.log(
      JSON.stringify(
        {
          before,
          validation,
          after,
          coverageIncrease:
            after.coverage.coveragePercent - before.coverage.coveragePercent,
          undoRestoredExactly:
            JSON.stringify(restoredFaces) === JSON.stringify(beforeFaces),
          restored,
          viewports: [
            `${outputPrefix}-before.png`,
            `${outputPrefix}-after.png`,
            `${outputPrefix}-restored.png`,
          ],
        },
        null,
        2,
      ),
    );
  } else {
    throw new Error(`Unknown action: ${action}`);
  }
} finally {
  await client.close();
}
