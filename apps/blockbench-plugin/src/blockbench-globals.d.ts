interface BlockbenchNode {
  readonly uuid: string;
  readonly name: string;
  readonly type?: string;
  readonly children?: readonly BlockbenchNode[];
  readonly parent?: BlockbenchNode | "root";
  from?: number[];
  to?: number[];
  readonly rotation?: readonly [number, number, number];
  readonly visibility?: boolean;
  readonly faces?: Record<
    string,
    {
      uv?: number[];
      texture?: string | number | null;
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
  showQuickMessage(message: string, duration?: number): void;
  addCSS(css: string): { delete(): void };
};
declare const Project:
  | {
      readonly uuid?: string;
      readonly name?: string;
      readonly format?: { readonly id?: string };
      readonly texture_width?: number;
      readonly texture_height?: number;
    }
  | undefined;
declare const Cube: {
  readonly all: readonly BlockbenchNode[];
  readonly selected: readonly BlockbenchNode[];
};
declare const Undo: {
  initEdit(options: { elements: readonly BlockbenchNode[] }): void;
  finishEdit(
    label: string,
    options: { elements: readonly BlockbenchNode[] },
  ): void;
  cancelEdit(revert?: boolean): void;
  undo(): void;
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
  readonly selected: readonly BlockbenchNode[];
};
declare const Preview: {
  readonly selected?: {
    screenshot(
      options: { width: number; height: number },
      callback: (dataUrl: string) => void,
    ): void;
  };
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
