/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// @ts-nocheck -- Blockbench supplies a global Vue 2 runtime whose component instance type is not published.
import {
  createChatSession,
  fetchChatEvents,
  publishSnapshot,
  sendChatMessage,
  stopChat,
  type BridgeSettings,
  type ChatEvent,
} from "./bridge-client.js";
import { captureSnapshot, captureViewport } from "./snapshot.js";

const modelKey = "blockbench_codex_model";

export function createAssistantPanel(
  settings: () => BridgeSettings | undefined,
  configure: () => void,
): { panel: Panel; styles: { delete(): void } } {
  const panel = new Panel("blockbench_codex_assistant", {
    name: "Codex Studio",
    icon: "smart_toy",
    growable: true,
    resizable: true,
    default_position: {
      slot: "right_bar",
      float_position: [80, 60],
      float_size: [470, 760],
      height: 600,
    },
    component: {
      data() {
        return {
          prompt: "",
          model: localStorage.getItem(modelKey) ?? "gpt-5.6-terra",
          modelMenuOpen: false,
          sessionId: "",
          events: [] as ChatEvent[],
          messages: [] as Array<{ role: string; text: string }>,
          lastEventId: 0,
          working: false,
          connected: false,
          showDetails: false,
          previewFirst: true,
          viewportAttached: false,
          poller: undefined as ReturnType<typeof setInterval> | undefined,
          reconnecting: false,
        };
      },
      computed: {
        selection(): readonly BlockbenchNode[] {
          return Cube.selected;
        },
        projectName(): string {
          return Project?.name ?? "No project";
        },
        toolEvents(): readonly ChatEvent[] {
          return this.events.filter(
            (event: ChatEvent) => event.type === "tool",
          );
        },
      },
      async mounted() {
        await this.newChat(false);
        this.poller = setInterval(() => void this.pollEvents(), 600);
      },
      beforeDestroy() {
        if (this.poller) clearInterval(this.poller);
      },
      methods: {
        async newChat(notify = true) {
          const bridge = settings();
          if (!bridge) {
            this.connected = false;
            if (notify) configure();
            return;
          }
          try {
            this.sessionId = await createChatSession(bridge);
            this.events = [];
            this.messages = [];
            this.lastEventId = 0;
            this.working = false;
            this.connected = true;
          } catch (error) {
            this.connected = false;
            if (notify)
              Blockbench.showQuickMessage(
                error instanceof Error ? error.message : String(error),
                5000,
              );
          }
        },
        async pollEvents() {
          const bridge = settings();
          if (!bridge) {
            this.connected = false;
            return;
          }
          if (!this.sessionId) {
            if (this.reconnecting) return;
            this.reconnecting = true;
            try {
              await this.newChat(false);
            } finally {
              this.reconnecting = false;
            }
            return;
          }
          try {
            const incoming = await fetchChatEvents(
              bridge,
              this.sessionId,
              this.lastEventId,
            );
            for (const event of incoming) {
              this.events.push(event);
              this.lastEventId = Math.max(this.lastEventId, event.id);
              if (event.type === "assistant" && event.text)
                this.messages.push({ role: "codex", text: event.text });
              if (event.type === "done" || event.type === "error")
                this.working = false;
              if (event.type === "error" && event.text)
                this.messages.push({ role: "error", text: event.text });
            }
            this.connected = true;
          } catch {
            this.connected = false;
          }
        },
        async send() {
          const text = this.prompt.trim();
          const bridge = settings();
          if (!text || !bridge || this.working) return;
          if (!this.sessionId) await this.newChat(false);
          const context = [
            "EMBEDDED BLOCKBENCH MODE. The authenticated blockbench-codex-studio MCP server is the only authoritative source for the live model. Use its health, project, selection, outline, viewport, draft, validation, connectivity, and commit tools as needed. Never use desktop/computer control, shell commands, repository files, saved fixtures, or another Blockbench integration. If the MCP tools or live snapshot are unavailable, say that plainly and stop; do not invent or infer model contents from disk.",
            this.previewFirst
              ? "PREVIEW MODE: inspect the live MCP selection and scene, then describe the exact proposed edit. Do not begin, commit, or apply a draft until the user explicitly approves in a later message."
              : "APPLY MODE: make safe changes only through typed Blockbench MCP draft tools, validate before commit, and summarize the committed result.",
            this.viewportAttached
              ? "A fresh viewport capture is published and available through capture_viewport."
              : "",
            this.selection.length
              ? `Current selection: ${this.selection.map((item: BlockbenchNode) => item.name).join(", ")}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
          this.messages.push({ role: "you", text });
          this.prompt = "";
          this.working = true;
          localStorage.setItem(modelKey, this.model);
          try {
            await sendChatMessage(
              bridge,
              this.sessionId,
              `${context}\n\nUser request: ${text}`,
              this.model,
            );
          } catch (error) {
            this.working = false;
            this.messages.push({
              role: "error",
              text: error instanceof Error ? error.message : String(error),
            });
          }
        },
        async capture() {
          const bridge = settings();
          try {
            if (!bridge) throw new Error("Configure the bridge first.");
            const viewport = await captureViewport();
            const snapshot = captureSnapshot(viewport);
            if (!snapshot) throw new Error("Open a Blockbench project first.");
            await publishSnapshot(bridge, snapshot);
            this.viewportAttached = true;
          } catch (error) {
            Blockbench.showQuickMessage(
              error instanceof Error ? error.message : String(error),
              5000,
            );
          }
        },
        toggleViewport() {
          if (this.viewportAttached) {
            this.viewportAttached = false;
            Blockbench.showQuickMessage(
              "Viewport removed from the next message.",
              1600,
            );
          } else {
            void this.capture();
          }
        },
        async stop() {
          const bridge = settings();
          if (bridge && this.sessionId) await stopChat(bridge, this.sessionId);
        },
        undo() {
          Undo.undo();
          Blockbench.showQuickMessage("Undid the last Blockbench edit.", 1800);
        },
        async copyMessage(text: string) {
          try {
            await navigator.clipboard.writeText(text);
            Blockbench.showQuickMessage("Codex message copied.", 1400);
          } catch {
            const field = document.createElement("textarea");
            field.value = text;
            field.style.position = "fixed";
            field.style.opacity = "0";
            document.body.appendChild(field);
            field.select();
            document.execCommand("copy");
            field.remove();
            Blockbench.showQuickMessage("Codex message copied.", 1400);
          }
        },
        configure,
        eventLabel(event: ChatEvent) {
          const detail = event.detail as
            { item?: { type?: string; name?: string } } | undefined;
          return detail?.item?.name ?? detail?.item?.type ?? "MCP event";
        },
      },
      template: `
        <div class="bcs-shell">
          <header class="bcs-header"><div class="bcs-brand"><span class="material-icons">smart_toy</span><div><strong>Codex Studio</strong><small>{{ projectName }}</small></div></div><div class="bcs-header-actions"><button title="New conversation" @click="newChat"><span class="material-icons">add_comment</span></button><button title="Connection settings" @click="configure"><span class="material-icons">settings</span></button></div></header>
          <div class="bcs-status" :class="{offline:!connected}"><span></span>{{ connected ? (working ? 'Codex is working' : 'MCP connected') : 'Bridge offline' }}</div>
          <main class="bcs-timeline">
            <div v-if="!messages.length" class="bcs-welcome"><span class="material-icons">auto_awesome</span><h3>Design directly in Blockbench</h3><p>Describe a change, attach the viewport, or select model parts. Codex can inspect, draft, validate, and apply through the MCP bridge.</p><div><button @click="prompt='Inspect my selection and suggest improvements'">Inspect selection</button><button @click="prompt='Make these parts form a connected chain'">Connect selection</button><button @click="capture">Attach viewport</button></div></div>
            <article v-for="(message,index) in messages" :key="index" class="bcs-message" :class="message.role"><div class="bcs-message-heading"><b>{{ message.role==='you'?'You':message.role==='error'?'Error':'Codex' }}</b><button v-if="message.role==='codex'" title="Copy message" @click="copyMessage(message.text)"><span class="material-icons">content_copy</span></button></div><p>{{ message.text }}</p></article>
            <details v-if="toolEvents.length" class="bcs-events" :open="showDetails" @toggle="showDetails=$event.target.open"><summary><span class="material-icons">account_tree</span>{{ toolEvents.length }} MCP events</summary><div v-for="event in toolEvents" :key="event.id"><span>{{ eventLabel(event) }}</span><pre v-if="showDetails">{{ JSON.stringify(event.detail,null,2) }}</pre></div></details>
          </main>
          <section class="bcs-context"><div class="bcs-chips"><span v-for="item in selection.slice(0,4)" :key="item.uuid" class="bcs-chip"><span class="material-icons">check_box</span>{{ item.name }}</span><span v-if="selection.length>4" class="bcs-chip">+{{ selection.length-4 }}</span><span v-if="viewportAttached" class="bcs-chip accent"><span class="material-icons">photo_camera</span>Viewport</span></div><div class="bcs-toolbar"><label><input type="checkbox" v-model="previewFirst"> Preview first</label><select v-model="model" :disabled="working" @mousedown="modelMenuOpen=true" @change="modelMenuOpen=false" @blur="modelMenuOpen=false"><option value="gpt-5.6-sol">{{ modelMenuOpen ? 'Sol · Quality' : 'Sol' }}</option><option value="gpt-5.6-terra">{{ modelMenuOpen ? 'Terra · Balanced' : 'Terra' }}</option><option value="gpt-5.6-luna">{{ modelMenuOpen ? 'Luna · Fast' : 'Luna' }}</option></select></div></section>
          <footer class="bcs-composer"><textarea v-model="prompt" :disabled="working" @keydown.enter.exact.prevent="send" placeholder="Describe what to build or change…"></textarea><button class="bcs-attach" :class="{active:viewportAttached}" @click="toggleViewport" :disabled="working" :title="viewportAttached?'Remove attached viewport':'Attach current viewport'"><span class="material-icons">{{ viewportAttached ? 'close' : 'photo_camera' }}</span></button><button v-if="working" class="bcs-send stop" @click="stop" title="Stop"><span class="material-icons">stop</span></button><button v-else class="bcs-send" @click="send" :disabled="!prompt.trim()||!connected" title="Send"><span class="material-icons">arrow_upward</span></button><button class="bcs-undo" @click="undo"><span class="material-icons">undo</span> Undo</button></footer>
        </div>`,
    } as any,
  });
  const styles = Blockbench.addCSS(`
    .bcs-shell{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--color-ui);color:var(--color-text);font-size:12px}.bcs-header{display:flex;align-items:center;padding:10px 5px 7px 11px;border-bottom:1px solid var(--color-border)}.bcs-brand{display:flex;align-items:center;gap:8px;min-width:0}.bcs-brand>.material-icons{color:var(--color-accent);font-size:24px}.bcs-brand div{display:flex;flex-direction:column;min-width:0}.bcs-brand strong{font-size:14px}.bcs-brand small{opacity:.62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bcs-header-actions{display:flex;gap:0;margin-left:auto}.bcs-header-actions button{width:26px;height:28px}.bcs-header-actions button,.bcs-toolbar button{padding:0;border:0;background:transparent}.bcs-toolbar button{width:30px;height:30px}.bcs-header-actions button:hover,.bcs-toolbar button:hover{background:var(--color-button)}.bcs-header-actions .material-icons,.bcs-toolbar .material-icons{font-size:18px}.bcs-status{display:flex;align-items:center;gap:6px;padding:5px 12px;background:color-mix(in srgb,var(--color-accent) 9%,transparent);font-size:11px}.bcs-status>span{width:7px;height:7px;border-radius:50%;background:#5fd48b}.bcs-status.offline>span{background:#e06565}.bcs-timeline{flex:1;min-height:120px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}.bcs-welcome{margin:auto;max-width:340px;text-align:center}.bcs-welcome>.material-icons{font-size:34px;color:var(--color-accent)}.bcs-welcome h3{margin:5px}.bcs-welcome p{margin:0 0 12px;opacity:.7;line-height:1.45}.bcs-welcome div{display:flex;justify-content:center;flex-wrap:wrap;gap:5px}.bcs-welcome button{font-size:11px;border:1px solid var(--color-border);background:var(--color-back);border-radius:14px;padding:4px 8px}.bcs-message{max-width:92%;padding:8px 10px;border-radius:8px;background:var(--color-back);line-height:1.42}.bcs-message.you{align-self:flex-end;background:color-mix(in srgb,var(--color-accent) 22%,var(--color-back))}.bcs-message.error{border-left:3px solid #e06565}.bcs-message b{font-size:10px;text-transform:uppercase;opacity:.6}.bcs-message p{white-space:pre-wrap;margin:3px 0 0}.bcs-events{border:1px solid var(--color-border);border-radius:6px;padding:5px 7px;opacity:.78}.bcs-events summary{cursor:pointer}.bcs-events summary .material-icons{font-size:15px;vertical-align:-3px;margin-right:5px}.bcs-events>div{padding:4px 2px;border-top:1px solid var(--color-border)}.bcs-events pre{max-height:150px;overflow:auto;white-space:pre-wrap;font-size:9px}.bcs-context{border-top:1px solid var(--color-border);padding:7px 9px 5px;background:var(--color-back)}.bcs-chips{display:flex;gap:4px;overflow:hidden;margin-bottom:5px}.bcs-chip{display:inline-flex;align-items:center;gap:3px;min-width:0;max-width:130px;padding:2px 6px;border-radius:10px;background:var(--color-button);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}.bcs-chip .material-icons{font-size:12px}.bcs-chip.accent{color:var(--color-accent)}.bcs-toolbar{display:flex;align-items:center;gap:7px}.bcs-toolbar label{display:flex;align-items:center;gap:3px;white-space:nowrap}.bcs-toolbar select{margin-left:auto;max-width:130px;height:27px;font-size:11px}.bcs-composer{position:relative;padding:7px 9px 10px;background:var(--color-back)}.bcs-composer textarea{box-sizing:border-box;width:100%;min-height:72px;max-height:170px;resize:vertical;padding:9px 34px 25px 9px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-ui);color:var(--color-text)}.bcs-send{position:absolute;right:15px;top:17px;width:22px;height:22px;padding:0;border-radius:50%;background:var(--color-accent);color:var(--color-accent_text)}.bcs-send.stop{background:#d65e5e}.bcs-send .material-icons{font-size:14px}.bcs-undo{position:absolute;left:14px;bottom:13px;height:23px;padding:1px 6px;border:0;background:transparent;opacity:.72;font-size:10px}.bcs-undo .material-icons{font-size:13px;vertical-align:-3px}
    .bcs-welcome button{min-height:22px;height:22px;font-size:10px;line-height:20px;border-radius:11px;padding:0 9px}
    .bcs-shell .bcs-header-actions{gap:0!important}
    .bcs-shell .bcs-header-actions button{box-sizing:border-box!important;min-width:24px!important;width:24px!important;max-width:24px!important;height:26px!important;margin:0!important;padding:0!important}
    .bcs-shell .bcs-send{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;min-width:20px!important;width:20px!important;max-width:20px!important;min-height:20px!important;height:20px!important;margin:0!important;padding:0!important;border:0!important;border-radius:50%!important;box-shadow:none!important}
    .bcs-shell .bcs-send .material-icons{display:block;font-size:13px!important;line-height:1!important;margin:0!important}
    .bcs-shell .bcs-attach{position:absolute;right:40px;top:17px;box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;min-width:20px!important;width:20px!important;max-width:20px!important;min-height:20px!important;height:20px!important;margin:0!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;opacity:.58}
    .bcs-shell .bcs-attach:hover,.bcs-shell .bcs-attach.active{opacity:1;background:var(--color-button)!important}
    .bcs-shell .bcs-attach .material-icons{font-size:13px!important;line-height:1!important}
    .bcs-shell .bcs-composer textarea{padding-right:58px}
    .bcs-shell .bcs-status{align-self:flex-start;margin:4px 0 0 10px;padding:1px 4px!important;background:transparent!important;border:0!important;line-height:16px;opacity:.72}
    .bcs-shell .bcs-status>span{width:6px;height:6px;box-shadow:none}
    .bcs-shell>.bcs-header,.bcs-shell>.bcs-status,.bcs-shell>.bcs-context,.bcs-shell>.bcs-composer{flex:0 0 auto!important}
    .bcs-shell>.bcs-timeline{align-self:stretch!important;width:100%!important;flex-grow:1!important;flex-shrink:1!important}
    .bcs-shell>.bcs-composer{margin-top:auto}
    .bcs-shell .bcs-welcome{box-sizing:border-box;width:100%;padding:10px 4px}
    .bcs-shell{box-sizing:border-box!important;width:100%!important;height:100%!important;max-height:100%!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;scrollbar-gutter:stable}
    .bcs-shell .bcs-timeline{box-sizing:border-box!important;flex:1 1 180px!important;height:auto!important;min-height:56px!important;max-height:none!important;resize:none;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable}
    .bcs-shell .bcs-events{flex:none;max-width:100%;overflow:hidden}
    .bcs-shell .bcs-message{position:relative;user-select:text!important}
    .bcs-shell .bcs-message-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .bcs-shell .bcs-message-heading button{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;min-width:20px!important;width:20px!important;max-width:20px!important;height:20px!important;margin:-3px -4px -3px 0!important;padding:0!important;border:0!important;background:transparent!important;opacity:.45}
    .bcs-shell .bcs-message-heading button:hover{opacity:1}
    .bcs-shell .bcs-message-heading button .material-icons{font-size:13px!important}
  `);
  return { panel, styles };
}
