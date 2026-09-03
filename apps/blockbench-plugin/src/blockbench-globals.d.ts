interface BlockbenchNode {
  readonly uuid: string;
  name: string;
  readonly type?: string;
  readonly children?: readonly BlockbenchNode[];
  readonly parent?: BlockbenchNode | "root";
  from?: number[];
  to?: number[];
  init?(): BlockbenchNode;
  addTo?(parent: BlockbenchNode | undefined): BlockbenchNode;
  remove?(): void;
  readonly rotation?: readonly [number, number, number];
  readonly visibility?: boolean;
  markAsSelected?(selectChildren?: boolean): BlockbenchNode;
  unselect?(unselectParent?: boolean): BlockbenchNode;
  readonly faces?: Record<
    string,
    {
      uv?: number[];
      texture?: string | number | false | null;
      rotation?: number;
      enabled?: boolean;
    }
  >;
}

declare class Action {
  constructor(
    id: string,
    options: {
      readonly name: string;
      readonly description?: string;
      readonly icon?: string;
      readonly click: () => void;
    },
  );
  delete(): void;
}

declare class Dialog {
  constructor(options: {
    readonly id: string;
    readonly title: string;
    readonly form: Record<string, unknown>;
    readonly onConfirm: (result: Record<string, unknown>) => void;
  });
  show(): void;
  hide(): void;
}
declare class Panel {
  constructor(id: string, options: Record<string, unknown>);
  delete(): void;
}

declare const Plugin: {
  register(id: string, metadata: Record<string, unknown>): void;
};
declare const MenuBar: {
  readonly menus: {
    readonly tools: { addAction(action: Action): void };
  };
};
declare const Blockbench: {
  readonly version?: string;
  showQuickMessage(message: string, duration?: number): void;
  addCSS(css: string): { delete(): void };
  pickDirectory?(options: {
    readonly title?: string;
    readonly startpath?: string;
    readonly resource_id?: string;
  }): string | undefined;
};
declare const Project:
  | {
      readonly uuid?: string;
      readonly name?: string;
      readonly format?: { readonly id?: string };
      readonly save_path?: string;
      readonly texture_width?: number;
      readonly texture_height?: number;
    }
  | undefined;
declare const Cube: {
  new (
    data: {
      readonly name?: string;
      readonly from?: readonly number[];
      readonly to?: readonly number[];
      readonly rotation?: readonly number[];
      readonly autouv?: 0 | 1 | 2;
    },
    uuid?: string,
  ): BlockbenchNode;
  readonly all: readonly BlockbenchNode[];
  readonly selected: readonly BlockbenchNode[];
};
declare const Group: {
  new (
    data: {
      readonly name?: string;
      readonly origin?: readonly number[];
    },
    uuid?: string,
  ): BlockbenchNode;
  readonly all: readonly BlockbenchNode[];
};
interface UndoScope {
  elements?: readonly BlockbenchNode[];
  textures?: readonly BlockbenchTexture[];
  outliner?: boolean;
  selection?: boolean;
  bitmap?: boolean;
}
declare const Undo: {
  initEdit(options: UndoScope): void;
  finishEdit(label: string, options: UndoScope): void;
  cancelEdit(revert?: boolean): void;
  undo(): void;
};
interface BlockbenchTexture {
  readonly uuid: string;
  readonly name: string;
  fromPath(path: string): BlockbenchTexture;
  add(undo?: boolean): BlockbenchTexture;
  fromDataURL(dataUrl: string): BlockbenchTexture;
  updateChangesAfterEdit?(): void;
  getBase64?(): string;
  readonly source?: string;
  readonly width?: number;
  readonly height?: number;
  readonly uv_width?: number;
  readonly uv_height?: number;
  select?(): BlockbenchTexture;
  remove?(): void;
}
declare const Texture: {
  new (options?: { readonly name?: string }): BlockbenchTexture;
  readonly all: readonly BlockbenchTexture[];
};
declare const Canvas: {
  updateView(options: {
    elements: readonly BlockbenchNode[];
    element_aspects: {
      geometry?: boolean;
      transform?: boolean;
      uv?: boolean;
      faces?: boolean;
    };
  }): void;
};
declare const Outliner: {
  readonly root: readonly BlockbenchNode[];
  readonly selected: BlockbenchNode[];
};
declare function updateSelection(): void;
interface BlockbenchVector3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}
interface BlockbenchPreview {
  screenshot(
    options: { width: number; height: number },
    callback: (dataUrl: string) => void,
  ): void;
  readonly camera?: {
    readonly position: BlockbenchVector3;
    lookAt?(target: BlockbenchVector3): void;
    updateProjectionMatrix?(): void;
  };
  readonly controls?: {
    readonly target: BlockbenchVector3;
    update?(): void;
  };
  readonly isOrtho?: boolean;
  setProjectionMode?(orthographic: boolean, from_preset?: boolean): unknown;
  loadAnglePreset?(preset: Record<string, unknown>): unknown;
  render?(): unknown;
}
declare const Preview: {
  readonly selected?: BlockbenchPreview;
};
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
declare const __STUDIO_SERVER_SCRIPT__: string;
declare function requireNativeModule(
  moduleName: string,
  options?: {
    readonly message?: string;
    readonly optional?: boolean;
  },
): unknown;
