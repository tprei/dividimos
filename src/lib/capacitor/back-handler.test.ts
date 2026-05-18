import { describe, it, expect, beforeEach } from "vitest";
import {
  pushBackHandler,
  runBackHandlers,
  __resetBackHandlerStackForTests,
} from "./back-handler";

beforeEach(() => {
  __resetBackHandlerStackForTests();
});

describe("runBackHandlers", () => {
  it("returns false when the stack is empty", () => {
    expect(runBackHandlers()).toBe(false);
  });

  it("calls the most-recently-registered handler first", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    pushBackHandler(() => { order.push(2); });

    runBackHandlers();

    expect(order).toEqual([2, 1]);
  });

  it("handler returning true stops further propagation and returns true", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    pushBackHandler(() => { order.push(2); return true; });

    const claimed = runBackHandlers();

    expect(claimed).toBe(true);
    expect(order).toEqual([2]);
  });

  it("handler returning void lets next handler run and returns false when none claim", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    pushBackHandler(() => { order.push(2); });

    const claimed = runBackHandlers();

    expect(claimed).toBe(false);
    expect(order).toEqual([2, 1]);
  });

  it("handler returning false lets next handler run", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    pushBackHandler(() => { order.push(2); return false; });

    const claimed = runBackHandlers();

    expect(claimed).toBe(false);
    expect(order).toEqual([2, 1]);
  });
});

describe("pushBackHandler unregister", () => {
  it("LIFO: unregistering last handler leaves earlier ones intact", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    const unregister2 = pushBackHandler(() => { order.push(2); });

    unregister2();
    runBackHandlers();

    expect(order).toEqual([1]);
  });

  it("out-of-order unregister: removing middle entry works correctly", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    const unregister2 = pushBackHandler(() => { order.push(2); });
    pushBackHandler(() => { order.push(3); });

    unregister2();
    runBackHandlers();

    expect(order).toEqual([3, 1]);
  });

  it("calling unregister twice is safe", () => {
    const order: number[] = [];
    pushBackHandler(() => { order.push(1); });
    const unregister2 = pushBackHandler(() => { order.push(2); });

    unregister2();
    unregister2();
    runBackHandlers();

    expect(order).toEqual([1]);
  });
});
