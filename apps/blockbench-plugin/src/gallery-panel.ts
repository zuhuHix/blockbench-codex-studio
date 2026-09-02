/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// @ts-nocheck -- Blockbench supplies a global Vue 2 runtime whose component instance type is not published.
import {
  attachVariantAsReference,
  fetchImageReferences,
  fetchImageVariants,
  fetchVariantDataUrl,
  fetchTextureDestination,
  removeVariant,
  revealTextureDestination,
  saveVariant,
  setTextureDestination,
  setVariantFavorite,
  type BridgeSettings,
} from "./bridge-client.js";

const roles = ["shape", "palette", "layout", "style", "edit-target"] as const;
const minZoom = 0.25;
const maxZoom = 16;
/** The pixel grid only helps once a texel is comfortably larger than a pixel. */
const pixelGridMinimumScale = 6;

function shortTime(value: string): string {
  return new Date(value).toLocaleTimeString();
}

export function createGalleryPanel(
  settings: () => BridgeSettings | undefined,
): { panel: Panel; styles: { delete(): void } } {
  const panel = new Panel("blockbench_codex_gallery", {
    name: "Codex Images",
    icon: "image_search",
    growable: true,
    resizable: true,
    default_position: {
      slot: "right_bar",
      float_position: [120, 100],
      float_size: [470, 620],
      height: 480,
    },
    component: {
      data() {
        return {
          variants: [] as any[],
          references: [] as any[],
          images: {} as Record<string, string>,
          openId: "",
          compareId: "",
          compareMode: false,
          zoom: 1,
          panX: 0,
          panY: 0,
          dragging: false,
          dragOriginX: 0,
          dragOriginY: 0,
          checkerboard: true,
          pixelGrid: false,
          favoritesOnly: false,
          role: "style",
          destination: undefined as any,
          connected: false,
          poller: undefined as ReturnType<typeof setInterval> | undefined,
        };
      },
      computed: {
        shown(): any[] {
          return this.favoritesOnly
            ? this.variants.filter((variant: any) => variant.favorite)
            : this.variants;
        },
        open(): any {
          return this.variants.find(
            (variant: any) => variant.id === this.openId,
          );
        },
        compared(): any {
          return this.variants.find(
            (variant: any) => variant.id === this.compareId,
          );
        },
        gridVisible(): boolean {
          return this.pixelGrid && this.zoom >= pixelGridMinimumScale;
        },
        stageStyle(): Record<string, string> {
          return {
            transform: `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`,
          };
        },
      },
      mounted() {
        void this.refresh();
        this.poller = setInterval(() => void this.refresh(), 2000);
      },
      beforeDestroy() {
        if (this.poller) clearInterval(this.poller);
      },
      methods: {
        async refresh() {
          const bridge = settings();
          if (!bridge) {
            this.connected = false;
            return;
          }
          try {
            this.variants = [...(await fetchImageVariants(bridge))];
            this.references = [...(await fetchImageReferences(bridge))];
            try {
              this.destination = await fetchTextureDestination(bridge);
            } catch {
              // No project is published yet; the destination row stays hidden.
              this.destination = undefined;
            }
            this.connected = true;
            await this.loadMissingImages(bridge);
            if (this.openId && !this.open) this.close();
          } catch {
            this.connected = false;
          }
        },
        async loadMissingImages(bridge: BridgeSettings) {
          for (const variant of this.variants) {
            if (this.images[variant.id]) continue;
            try {
              this.$set(
                this.images,
                variant.id,
                await fetchVariantDataUrl(bridge, variant.id),
              );
            } catch {
              // A variant removed mid-refresh simply stays unrendered.
            }
          }
        },
        source(id: string): string {
          return this.images[id] ?? "";
        },
        show(variant: any) {
          if (this.compareMode && this.openId && variant.id !== this.openId) {
            this.compareId = variant.id;
            return;
          }
          this.openId = variant.id;
          this.resetView();
        },
        close() {
          this.openId = "";
          this.compareId = "";
          this.compareMode = false;
          this.resetView();
        },
        resetView() {
          this.zoom = 1;
          this.panX = 0;
          this.panY = 0;
        },
        zoomBy(factor: number) {
          this.zoom = Math.min(maxZoom, Math.max(minZoom, this.zoom * factor));
        },
        onWheel(event: WheelEvent) {
          this.zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2);
        },
        startDrag(event: MouseEvent) {
          this.dragging = true;
          this.dragOriginX = event.clientX - this.panX;
          this.dragOriginY = event.clientY - this.panY;
        },
        onDrag(event: MouseEvent) {
          if (!this.dragging) return;
          this.panX = event.clientX - this.dragOriginX;
          this.panY = event.clientY - this.dragOriginY;
        },
        endDrag() {
          this.dragging = false;
        },
        toggleCompare() {
          this.compareMode = !this.compareMode;
          if (!this.compareMode) this.compareId = "";
        },
        async toggleFavorite(variant: any) {
          const bridge = settings();
          if (!bridge) return;
          try {
            const updated = await setVariantFavorite(
              bridge,
              variant.id,
              !variant.favorite,
            );
            variant.favorite = updated.favorite;
          } catch (error) {
            this.report(error);
          }
        },
        async discard(variant: any) {
          const bridge = settings();
          if (!bridge) return;
          try {
            await removeVariant(bridge, variant.id);
            if (this.openId === variant.id) this.close();
            await this.refresh();
          } catch (error) {
            this.report(error);
          }
        },
        async useAsReference(variant: any) {
          const bridge = settings();
          if (!bridge) return;
          try {
            const reference = await attachVariantAsReference(
              bridge,
              variant.id,
              this.role,
            );
            await this.refresh();
            Blockbench.showQuickMessage(
              `Attached ${reference.name} as a ${reference.role} reference.`,
              2200,
            );
          } catch (error) {
            this.report(error);
          }
        },
        chooseFolder() {
          const bridge = settings();
          if (!bridge) return;
          const picked = Blockbench.pickDirectory?.({
            title: "Select texture folder",
            startpath:
              this.destination?.absolutePath ??
              this.destination?.suggestions?.[0],
            resource_id: "blockbench_codex_textures",
          });
          if (!picked) return;
          void setTextureDestination(bridge, picked, true)
            .then((destination: any) => {
              this.destination = destination;
            })
            .catch((error: unknown) => this.report(error));
        },
        reveal() {
          const bridge = settings();
          if (!bridge) return;
          void revealTextureDestination(bridge).catch((error: unknown) =>
            this.report(error),
          );
        },
        async save(variant: any) {
          const bridge = settings();
          if (!bridge) return;
          try {
            const saved = await saveVariant(bridge, variant.id);
            Blockbench.showQuickMessage(
              saved.renamed
                ? `Saved as ${saved.fileName}; the requested name was taken.`
                : `Saved ${saved.fileName}.`,
              3000,
            );
            await this.refresh();
          } catch (error) {
            this.report(error);
          }
        },
        report(error: unknown) {
          Blockbench.showQuickMessage(
            error instanceof Error ? error.message : String(error),
            4000,
          );
        },
        shortTime,
      },
      template: `
        <div class="bcg-shell">
          <header class="bcg-header">
            <div class="bcg-brand"><span class="material-icons">image_search</span><div><strong>Codex Images</strong><small>{{ variants.length }} variant(s) · nothing is imported automatically</small></div></div>
            <div class="bcg-header-actions">
              <button :class="{active:favoritesOnly}" title="Show favorites only" @click="favoritesOnly=!favoritesOnly"><span class="material-icons">{{ favoritesOnly ? 'star' : 'star_border' }}</span></button>
              <button title="Refresh" @click="refresh"><span class="material-icons">refresh</span></button>
            </div>
          </header>
          <div class="bcg-status" :class="{offline:!connected}"><span></span>{{ connected ? 'Gallery connected' : 'Bridge offline' }}</div>

          <div v-if="destination" class="bcg-dest" :class="{bad:!destination.writable}">
            <span class="material-icons">folder</span>
            <span class="bcg-dest-path" :title="destination.absolutePath || destination.detail">{{ destination.projectRelativePath || destination.absolutePath || 'No texture folder chosen' }}</span>
            <small>{{ destination.writable ? 'writable' : destination.detail }}</small>
            <button title="Select texture folder" @click="chooseFolder"><span class="material-icons">folder_open</span></button>
            <button v-if="destination.exists" title="Reveal in Explorer" @click="reveal"><span class="material-icons">open_in_new</span></button>
          </div>

          <div v-if="references.length" class="bcg-refs"><span v-for="reference in references" :key="reference.id" class="bcg-chip" :title="reference.source + ' · ' + reference.width + '×' + reference.height"><span class="material-icons">label</span>{{ reference.name }} · {{ reference.role }}</span></div>

          <main v-if="!openId" class="bcg-grid-wrap">
            <p v-if="!shown.length" class="bcg-empty">No generated variants yet. Ask the assistant to generate a texture; results appear here for review before anything is saved or imported.</p>
            <div class="bcg-grid">
              <figure v-for="variant in shown" :key="variant.id" class="bcg-thumb" @click="show(variant)">
                <img :src="source(variant.id)" :alt="variant.name" class="bcg-checker">
                <span v-if="variant.favorite" class="material-icons bcg-fav">star</span>
                <figcaption>{{ variant.name }}<small>{{ variant.width }}×{{ variant.height }}</small></figcaption>
              </figure>
            </div>
          </main>

          <main v-else class="bcg-viewer">
            <div class="bcg-viewer-bar">
              <button title="Back to grid" @click="close"><span class="material-icons">arrow_back</span></button>
              <strong>{{ open.name }}</strong>
              <div class="bcg-viewer-tools">
                <button title="Zoom out" @click="zoomBy(1/1.4)"><span class="material-icons">zoom_out</span></button>
                <span class="bcg-zoom">{{ Math.round(zoom*100) }}%</span>
                <button title="Zoom in" @click="zoomBy(1.4)"><span class="material-icons">zoom_in</span></button>
                <button title="Fit" @click="resetView"><span class="material-icons">fit_screen</span></button>
                <button :class="{active:checkerboard}" title="Transparency checkerboard" @click="checkerboard=!checkerboard"><span class="material-icons">grid_on</span></button>
                <button :class="{active:pixelGrid}" title="Pixel grid (from 600% zoom)" @click="pixelGrid=!pixelGrid"><span class="material-icons">border_all</span></button>
                <button :class="{active:compareMode}" title="Compare with another variant" @click="toggleCompare"><span class="material-icons">compare</span></button>
              </div>
            </div>
            <div class="bcg-stage-wrap" @wheel.prevent="onWheel" @mousedown="startDrag" @mousemove="onDrag" @mouseup="endDrag" @mouseleave="endDrag">
              <div class="bcg-stage" :class="{checker:checkerboard,grid:gridVisible}" :style="stageStyle"><img :src="source(open.id)" :alt="open.name"></div>
              <div v-if="compareMode && compared" class="bcg-stage bcg-stage-compare" :class="{checker:checkerboard,grid:gridVisible}" :style="stageStyle"><img :src="source(compared.id)" :alt="compared.name"></div>
            </div>
            <p v-if="compareMode && !compared" class="bcg-hint">Pick a second variant below to compare side by side.</p>
            <div v-if="compareMode" class="bcg-strip"><img v-for="variant in shown" :key="variant.id" :src="source(variant.id)" :alt="variant.name" :class="{active:variant.id===compareId}" @click="show(variant)"></div>
            <dl class="bcg-meta">
              <div><dt>Size</dt><dd>{{ open.width }}×{{ open.height }} · {{ open.mimeType }}</dd></div>
              <div><dt>Alpha</dt><dd>{{ open.hasAlphaChannel ? 'transparency channel present' : 'opaque' }}</dd></div>
              <div><dt>Provider</dt><dd>{{ open.providerId }}</dd></div>
              <div><dt>Mode</dt><dd>{{ open.mode }}</dd></div>
              <div v-if="open.seed !== undefined"><dt>Seed</dt><dd>{{ open.seed }}</dd></div>
              <div v-if="open.generationMs !== undefined"><dt>Generated in</dt><dd>{{ (open.generationMs/1000).toFixed(1) }}s</dd></div>
              <div><dt>Created</dt><dd>{{ shortTime(open.createdAt) }}</dd></div>
              <div class="bcg-prompt"><dt>Prompt</dt><dd>{{ open.prompt }}</dd></div>
            </dl>
            <footer class="bcg-actions">
              <button @click="toggleFavorite(open)"><span class="material-icons">{{ open.favorite ? 'star' : 'star_border' }}</span>{{ open.favorite ? 'Favorited' : 'Favorite' }}</button>
              <select v-model="role" title="Reference role"><option v-for="entry in ${JSON.stringify(roles)}" :key="entry" :value="entry">{{ entry }}</option></select>
              <button @click="useAsReference(open)"><span class="material-icons">add_photo_alternate</span>Use as reference</button>
              <button :disabled="!destination || !destination.writable" :title="destination &amp;&amp; destination.writable ? 'Save a PNG into the texture folder' : 'Choose a writable texture folder first'" @click="save(open)"><span class="material-icons">save_alt</span>Save PNG</button>
              <button class="danger" @click="discard(open)"><span class="material-icons">delete_outline</span>Discard</button>
            </footer>
          </main>
        </div>`,
    } as any,
  });

  const styles = Blockbench.addCSS(`
    .bcg-shell{box-sizing:border-box;height:100%;width:100%;min-height:0;display:flex;flex-direction:column;background:var(--color-ui);color:var(--color-text);font-size:12px;overflow:hidden}
    .bcg-header{display:flex;align-items:center;padding:9px 5px 7px 11px;border-bottom:1px solid var(--color-border);flex:0 0 auto}
    .bcg-brand{display:flex;align-items:center;gap:8px;min-width:0}.bcg-brand>.material-icons{color:var(--color-accent);font-size:22px}
    .bcg-brand div{display:flex;flex-direction:column;min-width:0}.bcg-brand strong{font-size:13px}.bcg-brand small{opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bcg-header-actions{display:flex;gap:0;margin-left:auto}
    .bcg-shell button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;background:transparent;color:inherit;cursor:pointer}
    .bcg-header-actions button{width:26px;height:26px;padding:0}
    .bcg-shell button:hover{background:var(--color-button)}
    .bcg-shell button.active{color:var(--color-accent)}
    .bcg-shell .material-icons{font-size:17px}
    .bcg-status{display:flex;align-items:center;gap:6px;padding:2px 12px;font-size:10px;opacity:.72;flex:0 0 auto}
    .bcg-status>span{width:6px;height:6px;border-radius:50%;background:#5fd48b}.bcg-status.offline>span{background:#e06565}
    .bcg-dest{display:flex;align-items:center;gap:5px;padding:3px 8px 3px 10px;font-size:10px;flex:0 0 auto;border-bottom:1px solid var(--color-border)}
    .bcg-dest>.material-icons{font-size:13px;opacity:.6}
    .bcg-dest-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
    .bcg-dest small{opacity:.55;white-space:nowrap}
    .bcg-dest.bad small{color:#e08a5f;opacity:.9}
    .bcg-dest button{width:22px;height:22px;padding:0}
    .bcg-dest button .material-icons{font-size:14px}
    .bcg-actions button:disabled{opacity:.45;cursor:default}
    .bcg-refs{display:flex;flex-wrap:wrap;gap:4px;padding:4px 10px;flex:0 0 auto}
    .bcg-chip{display:inline-flex;align-items:center;gap:3px;max-width:170px;padding:2px 6px;border-radius:10px;background:var(--color-button);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bcg-chip .material-icons{font-size:11px}
    .bcg-grid-wrap{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 10px 12px}
    .bcg-empty{margin:18px 6px;opacity:.66;line-height:1.5;text-align:center}
    .bcg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
    .bcg-thumb{position:relative;margin:0;border:1px solid var(--color-border);border-radius:6px;overflow:hidden;background:var(--color-back);cursor:pointer}
    .bcg-thumb:hover{border-color:var(--color-accent)}
    .bcg-thumb img{display:block;width:100%;aspect-ratio:1;object-fit:contain;image-rendering:pixelated}
    .bcg-fav{position:absolute;top:3px;right:3px;font-size:14px!important;color:#f2c14b;text-shadow:0 0 3px rgba(0,0,0,.6)}
    .bcg-thumb figcaption{display:flex;justify-content:space-between;gap:5px;padding:3px 5px;font-size:10px;background:var(--color-ui)}
    .bcg-thumb figcaption small{opacity:.6}
    .bcg-viewer{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
    .bcg-viewer-bar{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--color-border);flex:0 0 auto}
    .bcg-viewer-bar>button{width:24px;height:24px;padding:0}
    .bcg-viewer-bar strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
    .bcg-viewer-tools{display:flex;align-items:center;gap:1px}
    .bcg-viewer-tools button{width:24px;height:24px;padding:0}
    .bcg-zoom{font-size:10px;opacity:.7;min-width:34px;text-align:center}
    .bcg-stage-wrap{position:relative;flex:1 1 auto;min-height:120px;display:flex;align-items:center;justify-content:center;gap:10px;overflow:hidden;background:var(--color-dark);cursor:grab}
    .bcg-stage-wrap:active{cursor:grabbing}
    .bcg-stage{position:relative;transform-origin:center center;line-height:0}
    .bcg-stage img{display:block;max-width:220px;max-height:220px;image-rendering:pixelated;-webkit-user-drag:none}
    .bcg-stage.checker{background-image:linear-gradient(45deg,#8a8a8a 25%,transparent 25%),linear-gradient(-45deg,#8a8a8a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8a8a8a 75%),linear-gradient(-45deg,transparent 75%,#8a8a8a 75%);background-size:12px 12px;background-position:0 0,0 6px,6px -6px,-6px 0;background-color:#c9c9c9}
    .bcg-stage.grid::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(to right,rgba(0,0,0,.32) 1px,transparent 1px),linear-gradient(to bottom,rgba(0,0,0,.32) 1px,transparent 1px);background-size:1px 1px}
    .bcg-hint{margin:4px 10px;font-size:10px;opacity:.65;flex:0 0 auto}
    .bcg-strip{display:flex;gap:5px;padding:5px 8px;overflow-x:auto;flex:0 0 auto}
    .bcg-strip img{width:44px;height:44px;object-fit:contain;image-rendering:pixelated;border:1px solid var(--color-border);border-radius:4px;background:var(--color-back);cursor:pointer}
    .bcg-strip img.active{border-color:var(--color-accent)}
    .bcg-meta{margin:0;padding:6px 10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2px 10px;font-size:10px;flex:0 0 auto;max-height:120px;overflow-y:auto}
    .bcg-meta div{display:flex;gap:5px}.bcg-meta .bcg-prompt{grid-column:1/-1}
    .bcg-meta dt{opacity:.55;min-width:52px}.bcg-meta dd{margin:0;overflow-wrap:anywhere}
    .bcg-actions{display:flex;align-items:center;gap:5px;padding:6px 9px 9px;border-top:1px solid var(--color-border);flex:0 0 auto;flex-wrap:wrap}
    .bcg-actions button{height:22px;padding:0 8px;border-radius:11px;background:var(--color-button);font-size:10px}
    .bcg-actions button.danger:hover{background:#b95252;color:#fff}
    .bcg-actions select{height:22px;font-size:10px;padding:0 3px;width:auto;min-width:0}
  `);
  return { panel, styles };
}
