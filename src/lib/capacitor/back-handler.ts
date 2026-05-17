type HandlerEntry = {
  id: number;
  handler: () => void | boolean;
};

let nextId = 0;
const stack: HandlerEntry[] = [];

export function pushBackHandler(handler: () => void | boolean): () => void {
  const id = nextId++;
  stack.push({ id, handler });
  return () => {
    const index = stack.findIndex((entry) => entry.id === id);
    if (index !== -1) stack.splice(index, 1);
  };
}

export function runBackHandlers(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const result = stack[i].handler();
    if (result === true) return true;
  }
  return false;
}

export function __resetBackHandlerStackForTests(): void {
  stack.length = 0;
  nextId = 0;
}
