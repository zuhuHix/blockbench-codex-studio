interface BlockbenchNode {
  readonly uuid: string;
  readonly name: string;
  readonly type?: string;
  readonly children?: readonly BlockbenchNode[];
  readonly parent?: BlockbenchNode | "root";
  readonly from?: readonly [number, number, number];
  readonly to?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly visibility?: boolean;
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

declare const Plugin: {
  register(id: string, metadata: Record<string, unknown>): void;
};
declare const MenuBar: { addAction(action: Action, location: string): void };
declare const Blockbench: {
  showQuickMessage(message: string, duration?: number): void;
};
declare const Project:
  | {
      readonly uuid?: string;
      readonly name?: string;
      readonly format?: { readonly id?: string };
    }
  | undefined;
declare const Cube: { readonly all: readonly BlockbenchNode[] };
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
